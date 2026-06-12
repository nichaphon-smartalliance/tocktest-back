import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobHandlersService } from './job-handlers.service';

@Injectable()
export class JobRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;

  constructor(
    private readonly jobs: JobsService,
    private readonly handlers: JobHandlersService,
  ) {}

  onModuleInit() {
    if (process.env.JOBS_ENABLED === 'false') {
      this.logger.warn('Background job runner disabled (JOBS_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), 5000);
    this.logger.log('Background job runner started (5s interval)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.jobs.recoverStale();
      if (++this.ticks % 720 === 0) await this.jobs.purgeOldCompleted();
      for (let i = 0; i < 5; i++) {
        const job = await this.jobs.claimNext();
        if (!job) break;
        try {
          await this.handlers.run(job);
          await this.jobs.complete(job.id);
        } catch (err: any) {
          await this.jobs.fail(job.id, err?.message ?? String(err), job);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
