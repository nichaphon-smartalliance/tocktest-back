import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Repository } from '../../repositories/entities/repository.entity';

@Entity('repo_settings')
export class RepoSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid', unique: true })
  repoId: string;

  @OneToOne(() => Repository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: Repository;

  @Column({ name: 'default_branch', type: 'varchar', default: 'main' })
  defaultBranch: string;

  @Column({ name: 'ai_provider', nullable: true, type: 'varchar' })
  aiProvider: string | null;

  @Column({ name: 'ai_model', nullable: true, type: 'varchar' })
  aiModel: string | null;

  @Column({ name: 'auto_analyze_on_push', type: 'boolean', default: false })
  autoAnalyzeOnPush: boolean;

  @Column({ name: 'ai_offline_mode', type: 'boolean', default: false })
  aiOfflineMode: boolean;

  @Column({ name: 'docs_auto_sync', type: 'boolean', default: false })
  docsAutoSync: boolean;

  @Column({ name: 'docs_sync_status', type: 'varchar', default: 'idle' })
  docsSyncStatus: string;

  @Column({ name: 'docs_sync_message', nullable: true, type: 'text' })
  docsSyncMessage: string | null;

  @Column({ name: 'docs_last_generated_at', nullable: true, type: 'timestamptz' })
  docsLastGeneratedAt: Date | null;

  @Column({ name: 'docs_last_commit_sha', nullable: true, type: 'varchar', length: 64 })
  docsLastCommitSha: string | null;

  @Column({ name: 'docs_last_source_sha', nullable: true, type: 'varchar', length: 64 })
  docsLastSourceSha: string | null;

  @Column({ name: 'docs_source_cache', type: 'jsonb', nullable: true })
  docsSourceCache: Record<string, unknown> | null;

  @Column({ name: 'docs_deleted_by_email', nullable: true, type: 'varchar' })
  docsDeletedByEmail: string | null;

  @Column({ name: 'docs_deleted_at', nullable: true, type: 'timestamptz' })
  docsDeletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
