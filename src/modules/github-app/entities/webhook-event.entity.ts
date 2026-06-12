import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('github_webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installation_id', nullable: true, type: 'bigint' })
  installationId: string | null;

  @Column({ type: 'varchar' })
  event: string;

  @Column({ nullable: true, type: 'varchar' })
  action: string | null;

  @Column({ name: 'repo_full_name', nullable: true, type: 'varchar' })
  repoFullName: string | null;

  @Column({ name: 'delivery_id', nullable: true, type: 'varchar' })
  deliveryId: string | null;

  @Column({ type: 'varchar', default: 'received' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: 'processed_at', nullable: true, type: 'timestamptz' })
  processedAt: Date | null;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
