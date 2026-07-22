import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBackgroundJobsTable1737500002000 implements MigrationInterface {
  name = 'AddBackgroundJobsTable1737500002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'pending',
        payload jsonb NOT NULL,
        dedupe_key varchar UNIQUE,
        attempts int NOT NULL DEFAULT 0,
        max_attempts int NOT NULL DEFAULT 3,
        last_error text,
        scheduled_at timestamptz NOT NULL DEFAULT NOW(),
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_background_jobs_status_scheduled ON background_jobs (status, scheduled_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS background_jobs`);
  }
}
