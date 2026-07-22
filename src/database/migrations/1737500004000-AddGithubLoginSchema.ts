import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGithubLoginSchema1737500004000 implements MigrationInterface {
  name = 'AddGithubLoginSchema1737500004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "github_id" BIGINT`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "github_login" VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider" VARCHAR(20) NOT NULL DEFAULT 'local'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(500)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_github_id`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "avatar_url"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_provider"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "github_login"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "github_id"`);
    // Not reverting password_hash back to NOT NULL — GitHub-only accounts created
    // after this migration may have no password_hash, so that would fail/lose data.
  }
}
