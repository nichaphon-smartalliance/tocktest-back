import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository as TypeOrmRepo } from 'typeorm';
import { CommitAnalysis } from './entities/commit-analysis.entity';
import { AiService } from '../ai/ai.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { toPageResult } from '../../common/dto/pagination.dto';
import { normalizeRiskLevel } from '../../common/utils/normalize-ai';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(CommitAnalysis)
    private readonly commitRepo: TypeOrmRepo<CommitAnalysis>,
    private readonly aiService: AiService,
    private readonly repoService: RepositoriesService,
    private readonly githubTokensService: GithubTokensService,
  ) {}

  async getCommits(userId: string, repoId: string, params: {
    page?: number;
    pageSize?: number;
    fromDate?: string;
    toDate?: string;
    riskLevel?: string;
    branch?: string;
  }) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);

    // Sync latest commits from GitHub if token available
    const { page = 1, pageSize = 30, riskLevel, branch } = params;

    // If branch is provided, fetch commits directly from GitHub (no local filter by branch exists)
    if (pat && branch) {
      const rawCommits = await this.aiService.fetchCommits(repo.fullName, pat, {
        since: params.fromDate,
        until: params.toDate,
        per_page: pageSize + 1,
        page,
        branch,
      });
      const hasMore = rawCommits.length > pageSize;
      const commits = hasMore ? rawCommits.slice(0, pageSize) : rawCommits;

      const storedAnalyses = commits.length
        ? await this.commitRepo.find({
            where: { repoId, commitSha: In(commits.map((c: any) => c.sha)) },
          })
        : [];
      const analysisBySha = new Map(storedAnalyses.map((item) => [item.commitSha, item]));

      const items = commits.map((c: any) => {
        const stored = analysisBySha.get(c.sha);
        return {
          id: stored?.id ?? c.sha,
          repoId,
          commitSha: c.sha,
          commitMessage: c.commit?.message,
          authorName: c.commit?.author?.name,
          authorEmail: c.commit?.author?.email,
          committedAt: c.commit?.author?.date ? new Date(c.commit.author.date) : null,
          filesChanged: stored?.filesChanged ?? c.stats?.total ?? 0,
          additions: stored?.additions ?? c.stats?.additions ?? 0,
          deletions: stored?.deletions ?? c.stats?.deletions ?? 0,
          aiSummary: stored?.aiSummary ?? null,
          riskLevel: stored?.riskLevel ?? null,
          analyzedAt: stored?.analyzedAt ?? null,
        };
      });

      const total = (page - 1) * pageSize + items.length + (hasMore ? 1 : 0);
      return toPageResult(items, total, page, pageSize);
    }

    // Fallback: stored analyses (used when no branch selected or no PAT)
    const qb = this.commitRepo.createQueryBuilder('c').where('c.repoId = :repoId', { repoId });
    if (riskLevel) qb.andWhere('c.riskLevel = :riskLevel', { riskLevel });
    if (params.fromDate) qb.andWhere('c.committedAt >= :from', { from: new Date(params.fromDate) });
    if (params.toDate) qb.andWhere('c.committedAt <= :to', { to: new Date(params.toDate) });
    qb.orderBy('c.committedAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return toPageResult(items, total, page, pageSize);
  }

  async analyzeCommit(userId: string, repoId: string, commitSha: string) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token');

    const commitDetail = await this.aiService.fetchCommitDetail(repo.fullName, pat, commitSha);
    const commitData = JSON.stringify({
      sha: commitDetail.sha,
      message: commitDetail.commit?.message,
      author: commitDetail.commit?.author,
      stats: commitDetail.stats,
      files: commitDetail.files?.slice(0, 10).map((f: any) => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch?.slice(0, 500),
      })),
    });

    const analysis = await this.aiService.analyzeCommit(commitData);

    await this.saveCommitAnalysis({
      repoId,
      commitSha,
      commitMessage: commitDetail.commit?.message,
      authorName: commitDetail.commit?.author?.name,
      authorEmail: commitDetail.commit?.author?.email,
      committedAt: commitDetail.commit?.author?.date ? new Date(commitDetail.commit.author.date) : null,
      filesChanged: commitDetail.stats?.total ?? 0,
      additions: commitDetail.stats?.additions ?? 0,
      deletions: commitDetail.stats?.deletions ?? 0,
      aiSummary: analysis.summary,
      riskLevel: normalizeRiskLevel(analysis.riskLevel),
      analyzedAt: new Date(),
      rawData: JSON.parse(JSON.stringify(commitDetail)),
    });

    return analysis;
  }

  async getWhatToTest(userId: string, repoId: string, commitShas: string[]) {
    const repo = await this.repoService.findOneForUser(userId, repoId);

    const commits = await this.commitRepo.find({
      where: commitShas.map((sha) => ({ repoId, commitSha: sha })),
    });
    const commitBySha = new Map(commits.map((commit) => [commit.commitSha, commit]));

    const missingShas = commitShas.filter((sha) => !commitBySha.has(sha));
    const pat = missingShas.length ? await this.githubTokensService.getDecryptedToken(userId) : null;

    if (pat) {
      for (const sha of missingShas.slice(0, 10)) {
        try {
          const detail = await this.aiService.fetchCommitDetail(repo.fullName, pat, sha);
          commitBySha.set(sha, {
            repoId,
            commitSha: sha,
            commitMessage: detail.commit?.message ?? null,
            authorName: detail.commit?.author?.name ?? null,
            authorEmail: detail.commit?.author?.email ?? null,
            committedAt: detail.commit?.author?.date ? new Date(detail.commit.author.date) : null,
            filesChanged: detail.stats?.total ?? 0,
            additions: detail.stats?.additions ?? 0,
            deletions: detail.stats?.deletions ?? 0,
            aiSummary: null,
            riskLevel: null,
            analyzedAt: null,
            rawData: null,
          } as CommitAnalysis);
        } catch {
          commitBySha.set(sha, {
            repoId,
            commitSha: sha,
            commitMessage: null,
            aiSummary: null,
          } as CommitAnalysis);
        }
      }
    }

    const commitsData = commitShas
      .map((sha) => commitBySha.get(sha))
      .filter((commit): commit is CommitAnalysis => !!commit)
      .map((c) => `[${c.commitSha.slice(0, 7)}] ${c.commitMessage ?? '(no message)'}\nSummary: ${c.aiSummary ?? 'N/A'}`)
      .join('\n\n');

    if (!commitsData.trim()) {
      return {
        recommendations: [],
        priority: 'medium',
        reasoning: 'ไม่พบข้อมูล commit ที่เลือก กรุณาวิเคราะห์ commit ก่อนหรือตรวจสอบ GitHub Token',
      };
    }

    return this.aiService.getWhatToTest(commitsData);
  }

  async reviewPullRequest(userId: string, repoId: string, pullRequestNumber: number) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('à¹„à¸¡à¹ˆà¸žà¸š GitHub Token');

    const pullRequest = await this.aiService.fetchPullRequestDetail(repo.fullName, pat, pullRequestNumber);
    const reviewInput = JSON.stringify(
      {
        number: pullRequest.number,
        title: pullRequest.title,
        state: pullRequest.state,
        body: pullRequest.body,
        headRef: pullRequest.head?.ref,
        baseRef: pullRequest.base?.ref,
        changedFiles: pullRequest.changed_files,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        files: (pullRequest.files ?? []).slice(0, 15).map((file: any) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch?.slice(0, 1200) ?? null,
        })),
      },
      null,
      2,
    );

    return this.aiService.reviewPullRequest(reviewInput);
  }

  async syncCommitsFromGithub(userId: string, repoId: string, branch?: string) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token');
    return this.syncCommits(repo.fullName, repoId, pat, { branch });
  }

  private async syncCommits(fullName: string, repoId: string, pat: string, params: {
    fromDate?: string;
    toDate?: string;
    branch?: string;
  }): Promise<{ synced: number }> {
    try {
      const commits = await this.aiService.fetchCommits(fullName, pat, {
        since: params.fromDate,
        until: params.toDate,
        per_page: 30,
        page: 1,
        branch: params.branch,
      });

      for (const c of commits) {
        await this.saveCommitAnalysis({
          repoId,
          commitSha: c.sha,
          commitMessage: c.commit?.message,
          authorName: c.commit?.author?.name,
          authorEmail: c.commit?.author?.email,
          committedAt: c.commit?.author?.date ? new Date(c.commit.author.date) : null,
          filesChanged: c.stats?.total ?? 0,
          additions: c.stats?.additions ?? 0,
          deletions: c.stats?.deletions ?? 0,
        });
      }
      return { synced: commits.length };
    } catch {
      return { synced: 0 };
    }
  }

  private async saveCommitAnalysis(data: Partial<CommitAnalysis> & { repoId: string; commitSha: string }) {
    const existing = await this.commitRepo.findOne({
      where: { repoId: data.repoId, commitSha: data.commitSha },
    });
    if (existing) {
      Object.assign(existing, data);
      return this.commitRepo.save(existing);
    }
    return this.commitRepo.save(this.commitRepo.create(data));
  }
}
