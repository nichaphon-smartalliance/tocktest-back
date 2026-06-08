import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { CommitAnalysis } from './entities/commit-analysis.entity';
import { AiService } from '../ai/ai.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { toPageResult } from '../../common/dto/pagination.dto';

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
  }) {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);

    // Sync latest commits from GitHub if token available
    if (pat) {
      await this.syncCommits(repo.fullName, repoId, pat, params);
    }

    const { page = 1, pageSize = 30, riskLevel } = params;
    const qb = this.commitRepo.createQueryBuilder('c').where('c.repoId = :repoId', { repoId });
    if (riskLevel) qb.andWhere('c.riskLevel = :riskLevel', { riskLevel });
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

    const upsertData: any = {
      repoId,
      commitSha,
      commitMessage: commitDetail.commit?.message,
      authorName: commitDetail.commit?.author?.name,
      authorEmail: commitDetail.commit?.author?.email,
      committedAt: new Date(commitDetail.commit?.author?.date),
      filesChanged: commitDetail.stats?.total ?? 0,
      additions: commitDetail.stats?.additions ?? 0,
      deletions: commitDetail.stats?.deletions ?? 0,
      aiSummary: analysis.summary,
      riskLevel: analysis.riskLevel,
      analyzedAt: new Date(),
      rawData: JSON.parse(JSON.stringify(commitDetail)),
    };
    await this.commitRepo.upsert(upsertData, { conflictPaths: ['repoId', 'commitSha'] });

    return analysis;
  }

  async getWhatToTest(userId: string, repoId: string, commitShas: string[]) {
    await this.repoService.findOneForUser(userId, repoId);

    const commits = await this.commitRepo.find({
      where: commitShas.map((sha) => ({ repoId, commitSha: sha })),
    });

    const commitsData = commits
      .map((c) => `[${c.commitSha.slice(0, 7)}] ${c.commitMessage}\nSummary: ${c.aiSummary ?? 'N/A'}`)
      .join('\n\n');

    return this.aiService.getWhatToTest(commitsData);
  }

  private async syncCommits(fullName: string, repoId: string, pat: string, params: {
    fromDate?: string;
    toDate?: string;
    page?: number;
  }) {
    try {
      const commits = await this.aiService.fetchCommits(fullName, pat, {
        since: params.fromDate,
        until: params.toDate,
        per_page: 30,
        page: params.page ?? 1,
      });

      for (const c of commits) {
        await this.commitRepo.upsert(
          {
            repoId,
            commitSha: c.sha,
            commitMessage: c.commit?.message,
            authorName: c.commit?.author?.name,
            authorEmail: c.commit?.author?.email,
            committedAt: new Date(c.commit?.author?.date),
            filesChanged: c.stats?.total ?? 0,
            additions: c.stats?.additions ?? 0,
            deletions: c.stats?.deletions ?? 0,
          },
          { conflictPaths: ['repoId', 'commitSha'] },
        );
      }
    } catch { /* silent fail — return cached data */ }
  }
}
