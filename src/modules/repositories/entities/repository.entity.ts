import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('repositories')
export class Repository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'github_token_id', nullable: true, type: 'uuid' })
  githubTokenId: string | null;

  @Column({ name: 'github_repo_id', type: 'bigint' })
  githubRepoId: number;

  @Column({ name: 'full_name', type: 'varchar' })
  fullName: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ name: 'default_branch', type: 'varchar', default: 'main' })
  defaultBranch: string;

  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  @Column({ name: 'html_url', nullable: true, type: 'varchar' })
  htmlUrl: string | null;

  @Column({ name: 'clone_url', nullable: true, type: 'varchar' })
  cloneUrl: string | null;

  @Column({ name: 'owner_login', nullable: true, type: 'varchar' })
  ownerLogin: string | null;

  @Column({ name: 'last_synced_at', nullable: true, type: 'timestamptz' })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
