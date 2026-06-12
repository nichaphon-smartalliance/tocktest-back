import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('visual_baselines')
export class VisualBaseline {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repo_id', type: 'uuid' })
  repoId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 500 })
  name: string;

  @Column({ type: 'varchar', length: 2000 })
  url: string;

  @Column({ type: 'varchar', default: '1280x720' })
  viewport: string;

  @Column({ name: 'screenshot_data', type: 'text' })
  screenshotData: string; // base64 PNG

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
