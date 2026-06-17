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
    const webhookConfigured = !!this.config.get<string>('GITHUB_WEBHOOK_SECRET');
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
        key: 'webhook_automation',
        label: 'Webhook-triggered QA automation',
        status: webhookConfigured ? 'live' : 'missing',
        description: webhookConfigured
          ? 'Push and pull_request webhooks enqueue background jobs for commit analysis and PR review.'
          : 'There is no webhook listener configuration yet for push, pull_request, or merge events.',
      },
      {
        key: 'pr_reviewer',
        label: 'Pull request review bot',
        status: githubAppConfigured && webhookConfigured ? 'live' : githubAppConfigured ? 'partial' : 'missing',
        description:
          githubAppConfigured && webhookConfigured
            ? 'PR events post AI review comments and commit status checks back to GitHub via the background job runner.'
            : 'Install the GitHub App and configure webhooks to enable automated PR review writeback.',
      },
      {
        key: 'qa_chat',
        label: 'Interactive QA chat',
        status: 'live',
        description: 'Repository-aware QA chat is live. Ask test and code questions in the QA Chat tab.',
      },
      {
        key: 'sandbox_execution',
        label: 'Sandboxed test execution',
        status: 'live',
        description: 'Cypress test execution runs in isolated Docker containers via the Sandbox tab. Docker must be available on the server.',
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
