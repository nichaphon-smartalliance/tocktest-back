import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type JobType = 'analyze_commit' | 'pr_review';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Entity('background_jobs')
@Index(['status', 'scheduledAt'])
@Index(['dedupeKey'], { unique: true, where: '"dedupe_key" IS NOT NULL' })
export class BackgroundJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  type: JobType;

  @Column({ type: 'varchar', default: 'pending' })
  status: JobStatus;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'dedupe_key', nullable: true, type: 'varchar' })
  dedupeKey: string | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', default: 3 })
  maxAttempts: number;

  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', default: () => 'NOW()' })
  scheduledAt: Date;

  @Column({ name: 'started_at', nullable: true, type: 'timestamptz' })
  startedAt: Date | null;

  @Column({ name: 'completed_at', nullable: true, type: 'timestamptz' })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
