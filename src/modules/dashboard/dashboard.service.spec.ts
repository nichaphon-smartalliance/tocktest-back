import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';

const mockRepoRow = (overrides = {}) => ({
  id: 'repo-1',
  userId: 'user-a',
  fullName: 'owner/my-repo',
  lastSyncedAt: new Date('2024-01-01'),
  ...overrides,
});

/**
 * Builds a chainable TypeORM QueryBuilder mock. `results` maps a call index
 * (0-based, in the order DashboardService issues its 4 createQueryBuilder()
 * calls: statusRows, aiGeneratedCount, failHighPriority, perRepoRows) to the
 * value returned by whichever terminal method (getRawMany/getCount) is used.
 */
function makeQueryBuilderRepo(results: unknown[]) {
  let call = -1;
  const createQueryBuilder = jest.fn(() => {
    call += 1;
    const value = results[call];
    const qb: any = {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      getRawMany: jest.fn().mockResolvedValue(value ?? []),
      getCount: jest.fn().mockResolvedValue(value ?? 0),
    };
    return qb;
  });
  return { createQueryBuilder };
}

describe('DashboardService', () => {
  let service: DashboardService;
  let repoRepo: { count: jest.Mock; find: jest.Mock };
  let tcRepo: ReturnType<typeof makeQueryBuilderRepo>;
  let githubTokensService: { hasActiveToken: jest.Mock };
  let config: { get: jest.Mock };

  async function build() {
    const module = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getRepositoryToken(Repository), useValue: repoRepo },
        { provide: getRepositoryToken(TestCase), useValue: tcRepo },
        { provide: GithubTokensService, useValue: githubTokensService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DashboardService);
  }

  beforeEach(() => {
    repoRepo = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) };
    tcRepo = makeQueryBuilderRepo([]);
    githubTokensService = { hasActiveToken: jest.fn().mockResolvedValue(false) };
    config = { get: jest.fn().mockReturnValue(undefined) };
  });

  // ── user scoping ─────────────────────────────────────────────────────────

  describe('getQaSummary — user scoping', () => {
    it('always scopes the repo count and repo list by userId', async () => {
      await build();
      await service.getQaSummary('user-a');
      expect(repoRepo.count).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
      expect(repoRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-a' }, order: { updatedAt: 'DESC' } });
    });

    it('checks the github token for the requesting user only', async () => {
      await build();
      await service.getQaSummary('user-a');
      expect(githubTokensService.hasActiveToken).toHaveBeenCalledWith('user-a');
    });

    it('a second user with no repos gets an independent, empty summary', async () => {
      await build();
      repoRepo.count.mockResolvedValue(0);
      repoRepo.find.mockResolvedValue([]);

      const result = await service.getQaSummary('user-b');

      expect(result.totalRepos).toBe(0);
      expect(result.recentRepos).toEqual([]);
      expect(result.totalTestCases).toBe(0);
    });

    it('only aggregates test-case query-builders over the requesting user\'s own repo ids', async () => {
      repoRepo.count.mockResolvedValue(1);
      repoRepo.find.mockResolvedValue([mockRepoRow({ id: 'repo-a', userId: 'user-a' })]);
      tcRepo = makeQueryBuilderRepo([
        [{ status: 'pass', count: '2' }], // statusRows
        1, // aiGeneratedCount
        0, // failHighPriority
        [{ repoId: 'repo-a', total: '2', passCount: '2', failCount: '0', blockedCount: '0', notTestedCount: '0' }], // perRepoRows
      ]);
      await build();

      await service.getQaSummary('user-a');

      // Every andWhere call across all 4 query builders should have been invoked
      // with an `ids`/`repoIds` param scoped to user-a's own repos only.
      const allQbCalls = tcRepo.createQueryBuilder.mock.results.map((r) => r.value);
      for (const qb of allQbCalls) {
        const whereCalls = [...qb.where.mock.calls, ...qb.andWhere.mock.calls];
        const repoScopedCall = whereCalls.find(
          ([, params]: any) => params && (params.ids || params.repoIds),
        );
        if (repoScopedCall) {
          const params = repoScopedCall[1];
          expect(params.ids ?? params.repoIds).toEqual(['repo-a']);
        }
      }
    });
  });

  // ── aggregation ──────────────────────────────────────────────────────────

  describe('getQaSummary — aggregation', () => {
    beforeEach(() => {
      repoRepo.count.mockResolvedValue(2);
      repoRepo.find.mockResolvedValue([
        mockRepoRow({ id: 'repo-a', fullName: 'owner/a' }),
        mockRepoRow({ id: 'repo-b', fullName: 'owner/b' }),
      ]);
    });

    it('sums status rows into byStatus and totalTestCases', async () => {
      tcRepo = makeQueryBuilderRepo([
        [
          { status: 'pass', count: '3' },
          { status: 'fail', count: '1' },
          { status: 'not_tested', count: '2' },
        ],
        0,
        0,
        [],
      ]);
      await build();

      const result = await service.getQaSummary('user-a');

      expect(result.byStatus).toEqual({ pass: 3, fail: 1, blocked: 0, not_tested: 2 });
      expect(result.totalTestCases).toBe(6);
    });

    it('computes passRate as a rounded percentage of executed test cases', async () => {
      tcRepo = makeQueryBuilderRepo([
        [
          { status: 'pass', count: '1' },
          { status: 'fail', count: '2' },
        ],
        0,
        0,
        [],
      ]);
      await build();

      const result = await service.getQaSummary('user-a');
      // executed = pass+fail+blocked = 3, passRate = round(1/3*100) = 33
      expect(result.passRate).toBe(33);
    });

    it('passRate is 0 when nothing has been executed yet', async () => {
      tcRepo = makeQueryBuilderRepo([[], 0, 0, []]);
      await build();
      const result = await service.getQaSummary('user-a');
      expect(result.passRate).toBe(0);
    });

    it('maps perRepoRows onto recentRepos, defaulting missing repos to zero counts', async () => {
      tcRepo = makeQueryBuilderRepo([
        [],
        0,
        0,
        [{ repoId: 'repo-a', total: '5', passCount: '3', failCount: '1', blockedCount: '1', notTestedCount: '0' }],
      ]);
      await build();

      const result = await service.getQaSummary('user-a');

      expect(result.recentRepos).toEqual([
        expect.objectContaining({ id: 'repo-a', testCaseCount: 5, passCount: 3, failCount: 1, blockedCount: 1 }),
        expect.objectContaining({ id: 'repo-b', testCaseCount: 0, passCount: 0, failCount: 0, blockedCount: 0 }),
      ]);
    });

    it('returns aiGeneratedCount and failHighPriority from their respective query builders', async () => {
      tcRepo = makeQueryBuilderRepo([[], 4, 2, []]);
      await build();

      const result = await service.getQaSummary('user-a');
      expect(result.aiGeneratedCount).toBe(4);
      expect(result.failHighPriority).toBe(2);
    });
  });

  // ── capabilities ─────────────────────────────────────────────────────────

  describe('getQaSummary — capabilities', () => {
    it('marks github_token_sync as missing with no token and no repos', async () => {
      await build();
      const result = await service.getQaSummary('user-a');
      const cap = result.capabilities.find((c) => c.key === 'github_token_sync');
      expect(cap?.status).toBe('missing');
    });

    it('marks github_token_sync as live once a token exists and repos are synced', async () => {
      githubTokensService.hasActiveToken.mockResolvedValue(true);
      repoRepo.count.mockResolvedValue(1);
      repoRepo.find.mockResolvedValue([mockRepoRow()]);
      tcRepo = makeQueryBuilderRepo([[], 0, 0, []]);
      await build();

      const result = await service.getQaSummary('user-a');
      const cap = result.capabilities.find((c) => c.key === 'github_token_sync');
      expect(cap?.status).toBe('live');
    });

    it('marks github_app as partial when GITHUB_APP_ID and private key are configured', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'GITHUB_APP_ID') return 'app-id';
        if (key === 'GITHUB_APP_PRIVATE_KEY') return 'private-key';
        return undefined;
      });
      await build();

      const result = await service.getQaSummary('user-a');
      const cap = result.capabilities.find((c) => c.key === 'github_app');
      expect(cap?.status).toBe('partial');
    });

    it('github_oauth and qa_chat are always live', async () => {
      await build();
      const result = await service.getQaSummary('user-a');
      expect(result.capabilities.find((c) => c.key === 'github_oauth')?.status).toBe('live');
      expect(result.capabilities.find((c) => c.key === 'qa_chat')?.status).toBe('live');
    });

    it('includes a github_app milestone step when github_app capability is missing', async () => {
      await build();
      const result = await service.getQaSummary('user-a');
      expect(result.nextMilestones.length).toBeGreaterThan(0);
      expect(result.nextMilestones[0]).toMatch(/GitHub App/i);
    });
  });
});
