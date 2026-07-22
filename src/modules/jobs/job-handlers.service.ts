import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { BackgroundJob } from './entities/background-job.entity';
import { GithubAppService } from '../github-app/github-app.service';
import { AiService } from '../ai/ai.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { Repository } from '../repositories/entities/repository.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';
import { normalizeRiskLevel } from '../../common/utils/normalize-ai';
import { buildPrReviewInput, formatPrReviewComment, reviewToCommitStatus } from '../../common/utils/pr-review.util';

@Injectable()
export class JobHandlersService {
  private readonly logger = new Logger(JobHandlersService.name);

  constructor(
    private readonly githubApp: GithubAppService,
    private readonly aiService: AiService,
    private readonly githubTokens: GithubTokensService,
    @InjectRepository(Repository) private readonly repoRepo: TypeOrmRepo<Repository>,
    @InjectRepository(CommitAnalysis) private readonly commitRepo: TypeOrmRepo<CommitAnalysis>,
  ) {}

  async run(job: BackgroundJob) {
    switch (job.type) {
      case 'analyze_commit':
        return this.handleAnalyzeCommit(job.payload);
      case 'pr_review':
        return this.handlePrReview(job.payload);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async handleAnalyzeCommit(payload: Record<string, unknown>) {
    const repoId = String(payload.repoId ?? '');
    const commitSha = String(payload.commitSha ?? '');
    const installationId = payload.installationId ? String(payload.installationId) : null;

    const repo = await this.repoRepo.findOne({ where: { id: repoId } });
    if (!repo) throw new Error(`Repository ${repoId} not found`);

    const token = installationId
      ? await this.githubApp.getInstallationToken(installationId)
      : await this.githubTokens.getDecryptedToken(repo.userId);

    if (!token) throw new Error('No GitHub token available for commit analysis');

    const detail = await this.aiService.fetchCommitDetail(repo.fullName, token, commitSha);
    const commitData = JSON.stringify({
      sha: detail.sha,
      message: detail.commit?.message,
      stats: detail.stats,
      files: detail.files?.slice(0, 10).map((f) => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });

    const analysis = await this.aiService.analyzeCommit(commitData, { repoId });

    await this.commitRepo.upsert(
      {
        repoId,
        commitSha,
        commitMessage: detail.commit?.message ?? null,
        authorName: detail.commit?.author?.name ?? null,
        authorEmail: detail.commit?.author?.email ?? null,
        committedAt: detail.commit?.author?.date ? new Date(detail.commit.author.date) : null,
        filesChanged: detail.stats?.total ?? 0,
        additions: detail.stats?.additions ?? 0,
        deletions: detail.stats?.deletions ?? 0,
        aiSummary: analysis.summary,
        riskLevel: normalizeRiskLevel(analysis.riskLevel),
        analyzedAt: new Date(),
      },
      { conflictPaths: ['repoId', 'commitSha'] },
    );

    this.logger.log(`Analyzed commit ${commitSha.slice(0, 7)} for ${repo.fullName}`);
  }

  private async handlePrReview(payload: Record<string, unknown>) {
    const installationId = String(payload.installationId ?? '');
    const repoFullName = String(payload.repoFullName ?? '');
    const prNumber = Number(payload.prNumber);
    const headSha = String(payload.headSha ?? '');

    if (!installationId || !repoFullName || !prNumber || !headSha) {
      throw new Error('pr_review job missing required fields');
    }

    await this.githubApp.postCommitStatus(
      installationId,
      repoFullName,
      headSha,
      'pending',
      'TockTest AI review in progress',
      'tocktest/ai-review',
    );

    try {
      const token = await this.githubApp.getInstallationToken(installationId);
      const pullRequest = await this.aiService.fetchPullRequestDetail(repoFullName, token, prNumber);
      const repo = await this.repoRepo.findOne({ where: { fullName: repoFullName } });
      const review = await this.aiService.reviewPullRequest(buildPrReviewInput(pullRequest), { repoId: repo?.id });

      await this.githubApp.postIssueComment(
        installationId,
        repoFullName,
        prNumber,
        formatPrReviewComment(review),
      );
      await this.githubApp.postCommitStatus(
        installationId,
        repoFullName,
        headSha,
        reviewToCommitStatus(review),
        review.summary || 'TockTest AI review completed',
        'tocktest/ai-review',
      );
    } catch (err) {
      await this.githubApp.postCommitStatus(
        installationId,
        repoFullName,
        headSha,
        'error',
        'TockTest AI review failed',
        'tocktest/ai-review',
      );
      throw err;
    }

    this.logger.log(`PR review posted for ${repoFullName}#${prNumber}`);
  }
}
