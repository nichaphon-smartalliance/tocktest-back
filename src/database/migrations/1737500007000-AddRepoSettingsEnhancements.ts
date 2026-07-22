import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRepoSettingsEnhancements1737500007000 implements MigrationInterface {
  name = 'AddRepoSettingsEnhancements1737500007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "ai_offline_mode" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_auto_sync" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_sync_status" VARCHAR(20) NOT NULL DEFAULT 'idle'`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_sync_message" TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_last_generated_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_last_commit_sha" VARCHAR(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_last_source_sha" VARCHAR(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_source_cache" JSONB`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_deleted_by_email" VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" ADD COLUMN IF NOT EXISTS "docs_deleted_at" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_deleted_at"`);
    await queryRunner.query(
      `ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_deleted_by_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_source_cache"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_last_source_sha"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_last_commit_sha"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_last_generated_at"`,
    );
    await queryRunner.query(`ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_sync_message"`);
    await queryRunner.query(`ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_sync_status"`);
    await queryRunner.query(`ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "docs_auto_sync"`);
    await queryRunner.query(`ALTER TABLE "repo_settings" DROP COLUMN IF EXISTS "ai_offline_mode"`);
  }
}
