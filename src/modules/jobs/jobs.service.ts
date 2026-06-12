import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { BackgroundJob, JobType } from './entities/background-job.entity';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(BackgroundJob)
    private readonly jobRepo: Repository<BackgroundJob>,
  ) {}

  async enqueue(type: JobType, payload: Record<string, unknown>, dedupeKey?: string) {
    if (dedupeKey) {
      const existing = await this.jobRepo.findOne({ where: { dedupeKey } });
      if (existing) return existing;
    }
    const job = this.jobRepo.create({ type, payload, dedupeKey: dedupeKey ?? null });
    return this.jobRepo.save(job);
  }

  async claimNext(): Promise<BackgroundJob | null> {
    const now = new Date();
    const job = await this.jobRepo.findOne({
      where: { status: 'pending', scheduledAt: LessThanOrEqual(now) },
      order: { scheduledAt: 'ASC', createdAt: 'ASC' },
    });
    if (!job) return null;

    job.status = 'processing';
    job.startedAt = now;
    job.attempts += 1;
    await this.jobRepo.save(job);
    return job;
  }

  async complete(id: string) {
    await this.jobRepo.update(id, { status: 'completed', completedAt: new Date(), lastError: null });
  }

  async fail(id: string, error: string, job: BackgroundJob) {
    const retry = job.attempts < job.maxAttempts;
    const delayMs = Math.min(60_000 * job.attempts, 300_000);
    await this.jobRepo.update(id, {
      status: retry ? 'pending' : 'failed',
      lastError: error.slice(0, 2000),
      scheduledAt: retry ? new Date(Date.now() + delayMs) : job.scheduledAt,
      ...(retry ? {} : { completedAt: new Date() }),
    });
    if (!retry) this.logger.warn(`Job ${id} (${job.type}) failed permanently: ${error}`);
  }

  /** Recover jobs stuck in processing (worker crash). */
  async recoverStale(maxAgeMs = 600_000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await this.jobRepo.find({ where: { status: 'processing' } });
    for (const job of stale) {
      if (job.startedAt && job.startedAt < cutoff) {
        await this.fail(job.id, 'Stale processing timeout — requeued', job);
      }
    }
  }

  async getRecent(limit = 20) {
    return this.jobRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async getStats() {
    const rows = await this.jobRepo
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('j.status')
      .getRawMany<{ status: string; count: string }>();
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const r of rows) {
      if (r.status in stats) stats[r.status as keyof typeof stats] = Number(r.count);
    }
    return stats;
  }

  async purgeOldCompleted(days = 14) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    await this.jobRepo
      .createQueryBuilder()
      .delete()
      .where('status = :s', { s: 'completed' })
      .andWhere('completed_at < :cutoff', { cutoff })
      .execute();
  }
}
