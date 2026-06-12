import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('visual_comparisons')
export class VisualComparison {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'baseline_id', type: 'uuid' })
  baselineId: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'screenshot_data', type: 'text' })
  screenshotData: string; // base64 PNG candidate

  @Column({ name: 'diff_data', type: 'text', nullable: true })
  diffData: string | null; // base64 PNG diff

  @Column({ name: 'diff_score', type: 'float', nullable: true })
  diffScore: number | null; // 0–1 fraction of changed pixels

  @Column({ name: 'diff_pixels', type: 'int', nullable: true })
  diffPixels: number | null;

  @Column({ name: 'total_pixels', type: 'int', nullable: true })
  totalPixels: number | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: string; // pending | pass | fail | error

  @Column({ name: 'threshold', type: 'float', default: 0.01 })
  threshold: number;

  @Column({ name: 'ai_analysis', type: 'text', nullable: true })
  aiAnalysis: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
