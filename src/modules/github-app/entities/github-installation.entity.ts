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

@Entity('github_installations')
export class GithubInstallation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ name: 'account_login', nullable: true, type: 'varchar' })
  accountLogin: string | null;

  @Column({ name: 'account_type', nullable: true, type: 'varchar' })
  accountType: string | null;

  @Column({ name: 'repository_selection', nullable: true, type: 'varchar' })
  repositorySelection: string | null;

  @Column({ name: 'suspended_at', nullable: true, type: 'timestamptz' })
  suspendedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
