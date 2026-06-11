import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo, In } from 'typeorm';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Repository)
    private readonly repoRepo: TypeOrmRepo<Repository>,
    @InjectRepository(TestCase)
    private readonly tcRepo: TypeOrmRepo<TestCase>,
    private readonly githubTokensService: GithubTokensService,
  ) {}

  async getQaSummary(userId: string) {
    const emptyStatus = { pass: 0, fail: 0, blocked: 0, not_tested: 0 };

    const [totalRepos, allRepoIds, recentRepos, hasGithubToken] = await Promise.all([
      this.repoRepo.count({ where: { userId } }),
      this.repoRepo.find({ where: { userId }, select: ['id'] }).then((r) => r.map((x) => x.id)),
      this.repoRepo.find({
        where: { userId },
        order: { updatedAt: 'DESC' },
        take: 8,
      }),
      this.githubTokensService.hasActiveToken(userId),
    ]);

    if (allRepoIds.length === 0) {
      return {
        totalRepos,
        totalTestCases: 0,
        byStatus: emptyStatus,
        aiGeneratedCount: 0,
        failHighPriority: 0,
        passRate: 0,
        recentRepos: [],
        hasGithubToken,
      };
    }

    const recentRepoIds = recentRepos.map((r) => r.id);

    const [statusRows, aiGeneratedCount, failHighPriority, perRepoRows] = await Promise.all([
      this.tcRepo
        .createQueryBuilder('tc')
        .select('tc.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('tc.repo_id IN (:...ids)', { ids: allRepoIds })
        .groupBy('tc.status')
        .getRawMany<{ status: string; count: string }>(),
      this.tcRepo.count({ where: { repoId: In(allRepoIds), isAiGenerated: true } }),
      this.tcRepo
        .createQueryBuilder('tc')
        .where('tc.repo_id IN (:...ids)', { ids: allRepoIds })
        .andWhere('tc.status = :status', { status: 'fail' })
        .andWhere('tc.priority IN (:...priorities)', { priorities: ['high', 'critical'] })
        .getCount(),
      this.tcRepo
        .createQueryBuilder('tc')
        .select('tc.repo_id', 'repoId')
        .addSelect('COUNT(*)', 'total')
        .addSelect("SUM(CASE WHEN tc.status = 'fail' THEN 1 ELSE 0 END)", 'failCount')
        .addSelect("SUM(CASE WHEN tc.status = 'pass' THEN 1 ELSE 0 END)", 'passCount')
        .where('tc.repo_id IN (:...repoIds)', { repoIds: recentRepoIds })
        .groupBy('tc.repo_id')
        .getRawMany<{ repoId: string; total: string; failCount: string; passCount: string }>(),
    ]);

    const byStatus = { ...emptyStatus };
    let totalTestCases = 0;
    for (const row of statusRows) {
      const n = Number(row.count);
      totalTestCases += n;
      if (row.status in byStatus) {
        byStatus[row.status as keyof typeof byStatus] = n;
      }
    }

    const perRepoMap = new Map(
      perRepoRows.map((r) => [
        r.repoId,
        { total: Number(r.total), failCount: Number(r.failCount), passCount: Number(r.passCount) },
      ]),
    );

    const executed = byStatus.pass + byStatus.fail + byStatus.blocked;
    const passRate = executed > 0 ? Math.round((byStatus.pass / executed) * 100) : 0;

    return {
      totalRepos,
      totalTestCases,
      byStatus,
      aiGeneratedCount,
      failHighPriority,
      passRate,
      hasGithubToken,
      recentRepos: recentRepos.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        testCaseCount: perRepoMap.get(r.id)?.total ?? 0,
        failCount: perRepoMap.get(r.id)?.failCount ?? 0,
        passCount: perRepoMap.get(r.id)?.passCount ?? 0,
        lastSyncedAt: r.lastSyncedAt,
      })),
    };
  }
}
