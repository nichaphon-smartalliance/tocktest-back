import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobsService } from './jobs.service';
import { BackgroundJob } from './entities/background-job.entity';

const mockJob = (overrides: Partial<BackgroundJob> = {}): BackgroundJob =>
  ({
    id: 'job-1',
    type: 'analyze_commit',
    status: 'pending',
    payload: { repoId: 'repo-1' },
    dedupeKey: null,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    scheduledAt: new Date('2024-01-01T00:00:00Z'),
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }) as BackgroundJob;

function makeQueryBuilder(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    delete: jest.fn(() => qb),
    execute: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return qb;
}

describe('JobsService', () => {
  let service: JobsService;
  let jobRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    jobRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => makeQueryBuilder()),
    };

    const module = await Test.createTestingModule({
      providers: [JobsService, { provide: getRepositoryToken(BackgroundJob), useValue: jobRepo }],
    }).compile();

    service = module.get(JobsService);
  });

  // ── enqueue / dedupe ─────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('creates and saves a new job when no dedupeKey is given', async () => {
      const result = await service.enqueue('analyze_commit', { repoId: 'r1' });
      expect(jobRepo.create).toHaveBeenCalledWith({
        type: 'analyze_commit',
        payload: { repoId: 'r1' },
        dedupeKey: null,
      });
      expect(jobRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ type: 'analyze_commit' });
    });

    it('returns the existing job instead of creating a new one when dedupeKey already exists', async () => {
      const existing = mockJob({ id: 'existing-job', dedupeKey: 'commit:sha123' });
      jobRepo.findOne.mockResolvedValue(existing);

      const result = await service.enqueue('analyze_commit', { repoId: 'r1' }, 'commit:sha123');

      expect(jobRepo.findOne).toHaveBeenCalledWith({ where: { dedupeKey: 'commit:sha123' } });
      expect(result).toBe(existing);
      expect(jobRepo.create).not.toHaveBeenCalled();
      expect(jobRepo.save).not.toHaveBeenCalled();
    });

    it('creates a new job when a dedupeKey is given but nothing matches it yet', async () => {
      jobRepo.findOne.mockResolvedValue(null);
      await service.enqueue('pr_review', { prNumber: 5 }, 'pr:5');
      expect(jobRepo.create).toHaveBeenCalledWith({
        type: 'pr_review',
        payload: { prNumber: 5 },
        dedupeKey: 'pr:5',
      });
    });
  });

  // ── claimNext — atomic claim via conditional update ─────────────────────

  describe('claimNext', () => {
    it('returns null when there is no pending job', async () => {
      jobRepo.findOne.mockResolvedValue(null);
      const result = await service.claimNext();
      expect(result).toBeNull();
      expect(jobRepo.update).not.toHaveBeenCalled();
    });

    it('claims a pending job: updates status to processing and increments attempts', async () => {
      const job = mockJob({ attempts: 0 });
      jobRepo.findOne.mockResolvedValue(job);
      jobRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.claimNext();

      expect(jobRepo.update).toHaveBeenCalledWith(
        { id: job.id, status: 'pending' },
        expect.objectContaining({ status: 'processing', attempts: 1 }),
      );
      expect(result?.status).toBe('processing');
      expect(result?.attempts).toBe(1);
    });

    it('retries when the conditional update loses the race (affected 0), then succeeds', async () => {
      const job = mockJob({ id: 'job-race' });
      jobRepo.findOne.mockResolvedValue(job);
      jobRepo.update
        .mockResolvedValueOnce({ affected: 0 }) // another worker claimed it first
        .mockResolvedValueOnce({ affected: 1 });

      const result = await service.claimNext();

      expect(jobRepo.update).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
    });

    it('gives up and returns null after 5 failed claim attempts', async () => {
      jobRepo.findOne.mockResolvedValue(mockJob());
      jobRepo.update.mockResolvedValue({ affected: 0 });

      const result = await service.claimNext();

      expect(jobRepo.update).toHaveBeenCalledTimes(5);
      expect(result).toBeNull();
    });

    it('only looks for jobs with status pending and scheduledAt due', async () => {
      jobRepo.findOne.mockResolvedValue(null);
      await service.claimNext();
      const call = jobRepo.findOne.mock.calls[0][0];
      expect(call.where.status).toBe('pending');
      expect(call.order).toEqual({ scheduledAt: 'ASC', createdAt: 'ASC' });
    });
  });

  // ── complete ─────────────────────────────────────────────────────────────

  describe('complete', () => {
    it('marks the job completed and clears lastError', async () => {
      await service.complete('job-1');
      expect(jobRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: 'completed', lastError: null }),
      );
    });
  });

  // ── fail — retry vs permanent failure / max-attempts ────────────────────

  describe('fail', () => {
    it('re-queues (status pending) with backoff when attempts have not reached maxAttempts', async () => {
      const job = mockJob({ attempts: 1, maxAttempts: 3 });
      await service.fail('job-1', 'boom', job);

      const update = jobRepo.update.mock.calls[0][1];
      expect(update.status).toBe('pending');
      expect(update.scheduledAt).toBeInstanceOf(Date);
      expect(update.scheduledAt.getTime()).toBeGreaterThan(Date.now());
      expect(update.completedAt).toBeUndefined();
    });

    it('marks the job permanently failed once attempts reach maxAttempts', async () => {
      const job = mockJob({ attempts: 3, maxAttempts: 3 });
      await service.fail('job-1', 'boom', job);

      const update = jobRepo.update.mock.calls[0][1];
      expect(update.status).toBe('failed');
      expect(update.completedAt).toBeInstanceOf(Date);
      // On permanent failure the schedule is left as-is (no further retry).
      expect(update.scheduledAt).toBe(job.scheduledAt);
    });

    it('truncates the stored error message to 2000 characters', async () => {
      const job = mockJob({ attempts: 1, maxAttempts: 3 });
      const longError = 'x'.repeat(3000);
      await service.fail('job-1', longError, job);

      const update = jobRepo.update.mock.calls[0][1];
      expect(update.lastError).toHaveLength(2000);
    });

    it('caps the retry backoff delay at 300,000ms (5 minutes)', async () => {
      const job = mockJob({ attempts: 100, maxAttempts: 1000 });
      const before = Date.now();
      await service.fail('job-1', 'boom', job);

      const update = jobRepo.update.mock.calls[0][1];
      const delay = update.scheduledAt.getTime() - before;
      expect(delay).toBeLessThanOrEqual(300_000 + 50); // small tolerance for test execution time
      expect(delay).toBeGreaterThan(295_000);
    });
  });

  // ── recoverStale — requeues jobs stuck in processing ────────────────────

  describe('recoverStale', () => {
    it('does nothing when there are no stale processing jobs', async () => {
      jobRepo.find.mockResolvedValue([]);
      await service.recoverStale();
      expect(jobRepo.update).not.toHaveBeenCalled();
    });

    it('requeues a processing job whose startedAt is older than maxAgeMs', async () => {
      const staleJob = mockJob({
        id: 'stale-1',
        status: 'processing',
        startedAt: new Date(Date.now() - 700_000),
        attempts: 0,
        maxAttempts: 3,
      });
      jobRepo.find.mockResolvedValue([staleJob]);

      await service.recoverStale(600_000);

      expect(jobRepo.find).toHaveBeenCalledWith({ where: { status: 'processing' } });
      expect(jobRepo.update).toHaveBeenCalledWith(
        'stale-1',
        expect.objectContaining({ status: 'pending' }), // still has attempts < maxAttempts, so it's re-queued
      );
    });

    it('leaves a processing job alone when it has not yet exceeded the stale cutoff', async () => {
      const freshJob = mockJob({
        id: 'fresh-1',
        status: 'processing',
        startedAt: new Date(), // just started
      });
      jobRepo.find.mockResolvedValue([freshJob]);

      await service.recoverStale(600_000);

      expect(jobRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('aggregates job counts by status', async () => {
      jobRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([
            { status: 'pending', count: '3' },
            { status: 'completed', count: '10' },
          ]),
        }),
      );

      const stats = await service.getStats();
      expect(stats).toEqual({ pending: 3, processing: 0, completed: 10, failed: 0 });
    });
  });

  // ── purgeOldCompleted ────────────────────────────────────────────────────

  describe('purgeOldCompleted', () => {
    it('issues a delete query filtered to completed jobs older than the cutoff', async () => {
      const qb = makeQueryBuilder();
      jobRepo.createQueryBuilder.mockReturnValue(qb);

      await service.purgeOldCompleted(14);

      expect(qb.delete).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith('status = :s', { s: 'completed' });
      expect(qb.andWhere).toHaveBeenCalledWith('completed_at < :cutoff', expect.objectContaining({ cutoff: expect.any(Date) }));
      expect(qb.execute).toHaveBeenCalled();
    });
  });
});
