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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
