import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { Repository } from '../../repositories/entities/repository.entity';

@Entity('commit_analysis')
@Unique(['repoId', 'commitSha'])
export class CommitAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @ManyToOne(() => Repository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: Repository;

  @Column({ name: 'commit_sha', type: 'varchar', length: 40 })
  commitSha: string;

  @Column({ name: 'commit_message', nullable: true, type: 'text' })
  commitMessage: string | null;

  @Column({ name: 'author_name', nullable: true, type: 'varchar' })
  authorName: string | null;

  @Column({ name: 'author_email', nullable: true, type: 'varchar' })
  authorEmail: string | null;

  @Column({ name: 'committed_at', nullable: true, type: 'timestamptz' })
  committedAt: Date | null;

  @Column({ name: 'ai_summary', nullable: true, type: 'text' })
  aiSummary: string | null;

  @Column({ name: 'risk_level', nullable: true, type: 'varchar' })
  riskLevel: string | null;

  @Column({ name: 'files_changed', type: 'int', default: 0 })
  filesChanged: number;

  @Column({ type: 'int', default: 0 })
  additions: number;

  @Column({ type: 'int', default: 0 })
  deletions: number;

  @Column({ name: 'analyzed_at', nullable: true, type: 'timestamptz' })
  analyzedAt: Date | null;

  @Column({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
