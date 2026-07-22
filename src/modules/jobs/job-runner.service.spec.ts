import { Test } from '@nestjs/testing';
import { JobRunnerService } from './job-runner.service';
import { JobsService } from './jobs.service';
import { JobHandlersService } from './job-handlers.service';

/**
 * JobRunnerService's public surface is just two OnModuleInit/OnModuleDestroy
 * lifecycle hooks that arm/disarm a `setInterval(..., 5000)` poller — there's
 * no useful return value or state to assert on directly, and letting the real
 * timer fire in a test would mean either waiting 5 real seconds or wrestling
 * with jest fake timers around an async, error-swallowing loop.
 *
 * Instead we test the actual unit of work — the private `tick()` method —
 * directly via `(service as any).tick()`, and cover onModuleInit/onModuleDestroy
 * separately just for their timer-arming/disarming side effects (using fake
 * timers so no test has to wait on a real 5s interval).
 */
describe('JobRunnerService', () => {
  let service: JobRunnerService;
  let jobs: {
    recoverStale: jest.Mock;
    purgeOldCompleted: jest.Mock;
    claimNext: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
  };
  let handlers: { run: jest.Mock };

  beforeEach(async () => {
    jobs = {
      recoverStale: jest.fn().mockResolvedValue(undefined),
      purgeOldCompleted: jest.fn().mockResolvedValue(undefined),
      claimNext: jest.fn().mockResolvedValue(null),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    handlers = { run: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        JobRunnerService,
        { provide: JobsService, useValue: jobs },
        { provide: JobHandlersService, useValue: handlers },
      ],
    }).compile();

    service = module.get(JobRunnerService);
  });

  // ── tick() — the pollable unit of work ──────────────────────────────────

  describe('tick', () => {
    it('recovers stale jobs on every tick', async () => {
      await (service as any).tick();
      expect(jobs.recoverStale).toHaveBeenCalledTimes(1);
    });

    it('claims and completes jobs until claimNext returns null', async () => {
      const job = { id: 'job-1', type: 'analyze_commit' };
      jobs.claimNext
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce({ id: 'job-2', type: 'analyze_commit' })
        .mockResolvedValueOnce(null);

      await (service as any).tick();

      expect(handlers.run).toHaveBeenCalledTimes(2);
      expect(jobs.complete).toHaveBeenCalledTimes(2);
      expect(jobs.complete).toHaveBeenCalledWith('job-1');
      expect(jobs.fail).not.toHaveBeenCalled();
    });

    it('processes at most 5 jobs per tick even if more are available', async () => {
      jobs.claimNext.mockResolvedValue({ id: 'job-x', type: 'analyze_commit' });

      await (service as any).tick();

      expect(jobs.claimNext).toHaveBeenCalledTimes(5);
      expect(handlers.run).toHaveBeenCalledTimes(5);
    });

    it('marks a job failed (not completed) when the handler throws', async () => {
      const job = { id: 'job-err', type: 'pr_review' };
      jobs.claimNext.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      handlers.run.mockRejectedValueOnce(new Error('handler exploded'));

      await (service as any).tick();

      expect(jobs.fail).toHaveBeenCalledWith('job-err', 'handler exploded', job);
      expect(jobs.complete).not.toHaveBeenCalled();
    });

    it('continues claiming subsequent jobs after one job fails', async () => {
      jobs.claimNext
        .mockResolvedValueOnce({ id: 'job-err', type: 'pr_review' })
        .mockResolvedValueOnce({ id: 'job-ok', type: 'analyze_commit' })
        .mockResolvedValueOnce(null);
      handlers.run.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

      await (service as any).tick();

      expect(jobs.fail).toHaveBeenCalledTimes(1);
      expect(jobs.complete).toHaveBeenCalledTimes(1);
      expect(jobs.complete).toHaveBeenCalledWith('job-ok');
    });

    it('does not run purgeOldCompleted except on the configured tick interval (every 720th tick)', async () => {
      await (service as any).tick();
      expect(jobs.purgeOldCompleted).not.toHaveBeenCalled();
    });

    it('runs purgeOldCompleted once the tick counter reaches 720', async () => {
      for (let i = 0; i < 720; i++) {
        await (service as any).tick();
      }
      expect(jobs.purgeOldCompleted).toHaveBeenCalledTimes(1);
    });

    it('re-entrancy guard: a tick already in flight skips a concurrent call', async () => {
      let resolveRecoverStale!: () => void;
      jobs.recoverStale.mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveRecoverStale = resolve)),
      );

      const firstTick = (service as any).tick();
      const secondTick = (service as any).tick(); // should return immediately (running === true)

      await secondTick;
      expect(jobs.claimNext).not.toHaveBeenCalled(); // neither tick has progressed past recoverStale yet

      resolveRecoverStale();
      await firstTick;

      // Only the first tick's recoverStale call actually happened.
      expect(jobs.recoverStale).toHaveBeenCalledTimes(1);
    });
  });

  // ── lifecycle hooks ──────────────────────────────────────────────────────

  describe('onModuleInit / onModuleDestroy', () => {
    const originalEnv = process.env.JOBS_ENABLED;

    afterEach(() => {
      process.env.JOBS_ENABLED = originalEnv;
      jest.useRealTimers();
    });

    it('arms a 5s interval by default', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      service.onModuleDestroy();
    });

    it('does not arm the interval when JOBS_ENABLED=false', () => {
      jest.useFakeTimers();
      process.env.JOBS_ENABLED = 'false';
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('onModuleDestroy clears the interval that onModuleInit armed', () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('onModuleDestroy is a no-op when the runner was never started', () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      process.env.JOBS_ENABLED = 'false';

      service.onModuleInit(); // disabled — no timer armed
      service.onModuleDestroy();

      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });
  });
});
