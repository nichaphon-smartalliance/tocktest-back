import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGithubOAuthAppSchema1737500003000 implements MigrationInterface {
  name = 'AddGithubOAuthAppSchema1737500003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "github_tokens" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(20) NOT NULL DEFAULT 'pat'`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_tokens" ADD COLUMN IF NOT EXISTS "github_login" VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "github_tokens" ADD COLUMN IF NOT EXISTS "github_user_id" BIGINT`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS github_installations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        installation_id BIGINT NOT NULL UNIQUE,
        account_login VARCHAR(255),
        account_type VARCHAR(50),
        repository_selection VARCHAR(50),
        suspended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_github_installations_user_id ON github_installations(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS github_installations`);
    await queryRunner.query(`ALTER TABLE "github_tokens" DROP COLUMN IF EXISTS "github_user_id"`);
    await queryRunner.query(`ALTER TABLE "github_tokens" DROP COLUMN IF EXISTS "github_login"`);
    await queryRunner.query(`ALTER TABLE "github_tokens" DROP COLUMN IF EXISTS "provider"`);
  }
}
