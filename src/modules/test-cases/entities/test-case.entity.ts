import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Repository } from '../../repositories/entities/repository.entity';
import { TestCaseFolder } from './test-case-folder.entity';

@Entity('test_cases')
export class TestCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @ManyToOne(() => Repository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: Repository;

  @Column({ name: 'folder_id', nullable: true, type: 'uuid' })
  folderId: string | null;

  @ManyToOne(() => TestCaseFolder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'folder_id' })
  folder: TestCaseFolder | null;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  steps: { order: number; description: string }[] | null;

  @Column({ name: 'expected_result', nullable: true, type: 'text' })
  expectedResult: string | null;

  @Column({ name: 'test_type', type: 'varchar', default: 'manual' })
  testType: string;

  @Column({ type: 'varchar', default: 'not_tested' })
  status: string;

  @Column({ type: 'varchar', default: 'medium' })
  priority: string;

  @Column({ name: 'is_ai_generated', type: 'boolean', default: false })
  isAiGenerated: boolean;

  @Column({ name: 'ai_generation_metadata', type: 'jsonb', nullable: true })
  aiGenerationMetadata: Record<string, unknown> | null;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ name: 'created_by', nullable: true, type: 'varchar' })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
