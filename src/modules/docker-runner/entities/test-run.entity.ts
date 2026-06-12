import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('test_runs')
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', default: 'cypress' })
  framework: string;

  @Column({ type: 'varchar', length: 120, default: 'Untitled run' })
  name: string;

  @Column({ name: 'file_content', type: 'text' })
  fileContent: string;

  @Column({ type: 'varchar', default: 'queued' })
  status: string; // queued | running | passed | failed | error

  @Column({ type: 'text', nullable: true })
  output: string | null;

  @Column({ name: 'exit_code', type: 'int', nullable: true })
  exitCode: number | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'test_results', type: 'jsonb', nullable: true })
  testResults: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
