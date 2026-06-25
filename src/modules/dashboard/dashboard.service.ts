import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
  ) {}

  async getQaSummary(userId: string) {
    const emptyStatus = { pass: 0, fail: 0, blocked: 0, not_tested: 0 };

    const [totalRepos, ownRepos, hasGithubToken] = await Promise.all([
      this.repoRepo.count({ where: { userId } }),
      this.repoRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } }),
      this.githubTokensService.hasActiveToken(userId),
    ]);

    const recentRepos = ownRepos;
    const ownFullNames = ownRepos.map((r) => r.fullName);

    // Expand to all accounts' copies of the same GitHub repos (matched by full_name)
    const allSharedRepos = ownFullNames.length > 0
      ? await this.repoRepo.find({ where: { fullName: In(ownFullNames) }, select: ['id', 'fullName'] })
      : [];
    const allRepoIds = allSharedRepos.map((r) => r.id);

    // Map own repo fullName → all sibling repo IDs (for per-repo stats aggregation)
    const siblingMap = new Map<string, string[]>(ownRepos.map((r) => [r.fullName, []]));
    for (const r of allSharedRepos) {
      siblingMap.get(r.fullName)?.push(r.id);
    }

    if (ownRepos.length === 0) {
      const capabilities = this.buildCapabilities({
        totalRepos,
        totalTestCases: 0,
        aiGeneratedCount: 0,
        hasGithubToken,
      });

      return {
        totalRepos,
        totalTestCases: 0,
        byStatus: emptyStatus,
        aiGeneratedCount: 0,
        failHighPriority: 0,
        passRate: 0,
        recentRepos: [],
        hasGithubToken,
        capabilities,
        nextMilestones: this.buildNextMilestones(capabilities),
      };
    }

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
        .addSelect("SUM(CASE WHEN tc.status = 'pass' THEN 1 ELSE 0 END)", 'passCount')
        .addSelect("SUM(CASE WHEN tc.status = 'fail' THEN 1 ELSE 0 END)", 'failCount')
        .addSelect("SUM(CASE WHEN tc.status = 'blocked' THEN 1 ELSE 0 END)", 'blockedCount')
        .addSelect("SUM(CASE WHEN tc.status = 'not_tested' THEN 1 ELSE 0 END)", 'notTestedCount')
        .where('tc.repo_id IN (:...repoIds)', { repoIds: allRepoIds })
        .groupBy('tc.repo_id')
        .getRawMany<{ repoId: string; total: string; passCount: string; failCount: string; blockedCount: string; notTestedCount: string }>(),
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

    const perRepoById = new Map(
      perRepoRows.map((r) => [
        r.repoId,
        {
          total: Number(r.total),
          passCount: Number(r.passCount),
          failCount: Number(r.failCount),
          blockedCount: Number(r.blockedCount),
          notTestedCount: Number(r.notTestedCount),
        },
      ]),
    );

    // Aggregate sibling stats under each own repo's fullName
    const statsForFullName = new Map<string, { total: number; passCount: number; failCount: number; blockedCount: number; notTestedCount: number }>();
    for (const [fullName, siblingIds] of siblingMap) {
      let total = 0, passCount = 0, failCount = 0, blockedCount = 0, notTestedCount = 0;
      for (const id of siblingIds) {
        const s = perRepoById.get(id);
        if (s) { total += s.total; passCount += s.passCount; failCount += s.failCount; blockedCount += s.blockedCount; notTestedCount += s.notTestedCount; }
      }
      statsForFullName.set(fullName, { total, passCount, failCount, blockedCount, notTestedCount });
    }

    const executed = byStatus.pass + byStatus.fail + byStatus.blocked;
    const passRate = executed > 0 ? Math.round((byStatus.pass / executed) * 100) : 0;
    const capabilities = this.buildCapabilities({
      totalRepos,
      totalTestCases,
      aiGeneratedCount,
      hasGithubToken,
    });

    return {
      totalRepos,
      totalTestCases,
      byStatus,
      aiGeneratedCount,
      failHighPriority,
      passRate,
      hasGithubToken,
      capabilities,
      nextMilestones: this.buildNextMilestones(capabilities),
      recentRepos: recentRepos.map((r) => {
        const stats = statsForFullName.get(r.fullName);
        return {
          id: r.id,
          fullName: r.fullName,
          testCaseCount: stats?.total ?? 0,
          passCount: stats?.passCount ?? 0,
          failCount: stats?.failCount ?? 0,
          blockedCount: stats?.blockedCount ?? 0,
          notTestedCount: stats?.notTestedCount ?? 0,
          lastSyncedAt: r.lastSyncedAt,
        };
      }),
    };
  }

  private buildCapabilities(input: {
    totalRepos: number;
    totalTestCases: number;
    aiGeneratedCount: number;
    hasGithubToken: boolean;
  }) {
    const hasRepos = input.totalRepos > 0;
    const hasGeneratedTests = input.aiGeneratedCount > 0;
    const githubAppConfigured =
      !!this.config.get<string>('GITHUB_APP_ID') &&
      !!this.config.get<string>('GITHUB_APP_PRIVATE_KEY');
    const installUrlConfigured =
      !!this.config.get<string>('GITHUB_APP_INSTALL_URL') || !!this.config.get<string>('GITHUB_APP_NAME');

    return [
      {
        key: 'github_token_sync',
        label: 'GitHub token + repo import',
        status: input.hasGithubToken && hasRepos ? 'live' : input.hasGithubToken ? 'partial' : 'missing',
        description: input.hasGithubToken
          ? hasRepos
            ? 'Personal access token is connected and repositories have been imported.'
            : 'Personal access token is connected, but repositories still need to be synced.'
          : 'Users still need to connect GitHub with a token before repositories can be imported.',
      },
      {
        key: 'commit_analysis',
        label: 'AI commit analysis',
        status: input.hasGithubToken && hasRepos ? 'live' : 'missing',
        description: input.hasGithubToken && hasRepos
          ? 'Commit fetching and AI-powered change analysis are available from the repo analysis screen.'
          : 'Commit analysis depends on a connected GitHub token and at least one synced repository.',
      },
      {
        key: 'test_generation',
        label: 'AI test generation',
        status: hasGeneratedTests ? 'live' : input.hasGithubToken && hasRepos ? 'partial' : 'missing',
        description: hasGeneratedTests
          ? 'The platform is already generating AI-created test cases for at least one repository.'
          : input.hasGithubToken && hasRepos
            ? 'Test generation flow exists, but no AI-generated test cases have been saved yet.'
            : 'Test generation cannot run until GitHub is connected and repositories are available.',
      },
      {
        key: 'github_oauth',
        label: 'GitHub OAuth sign-in',
        status: 'live',
        description: 'GitHub OAuth sign-in is implemented. Users can authenticate via GitHub through the login page.',
      },
      {
        key: 'github_app',
        label: 'GitHub App install',
        status: githubAppConfigured || installUrlConfigured ? 'partial' : 'missing',
        description: githubAppConfigured || installUrlConfigured
          ? 'GitHub App setup has started, but installation callbacks, PR checks, and review-comment writeback are not finished yet.'
          : 'GitHub App permissions, installation flow, PR status checks, and review-comment writeback are still missing.',
      },
      {
        key: 'pr_reviewer',
        label: 'Pull request review bot',
        status: githubAppConfigured ? 'partial' : 'missing',
        description: githubAppConfigured
          ? 'GitHub App is configured. PR review writeback can be triggered via the background job runner.'
          : 'Install the GitHub App to enable automated PR review writeback.',
      },
      {
        key: 'qa_chat',
        label: 'Interactive QA chat',
        status: 'live',
        description: 'Repository-aware QA chat is live. Ask test and code questions in the QA Chat tab.',
      },
    ] as const;
  }

  private buildNextMilestones(
    capabilities: ReadonlyArray<{ key: string; status: 'live' | 'partial' | 'missing' }>,
  ) {
    const isMissing = (key: string) => capabilities.some((item) => item.key === key && item.status === 'missing');
    const steps: string[] = [];

    if (isMissing('github_app')) {
      steps.push('Create a GitHub App installation flow to enable PR comments, checks, and repository-scoped permissions.');
    }
    if (isMissing('pr_reviewer')) {
      steps.push('Finish GitHub App install so PR reviews can post comments and status checks automatically.');
    }
    return steps.slice(0, 5);
  }
}
