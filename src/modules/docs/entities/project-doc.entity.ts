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

@Entity('project_docs')
export class ProjectDoc {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @ManyToOne(() => Repository, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repo_id' })
  repo: Repository;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'updated_by', nullable: true, type: 'varchar' })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
