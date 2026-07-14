import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ name: 'password_hash', select: false, nullable: true, type: 'varchar' })
  passwordHash: string | null;

  @Column({ name: 'github_id', nullable: true, type: 'bigint' })
  githubId: number | null;

  @Column({ name: 'github_login', nullable: true, type: 'varchar' })
  githubLogin: string | null;

  @Column({ name: 'auth_provider', default: 'local' })
  authProvider: string;

  @Column({ name: 'avatar_url', nullable: true, type: 'varchar' })
  avatarUrl: string | null;

  @Column({ default: 'user' })
  role: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'session_version', type: 'int', default: 0 })
  sessionVersion: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
