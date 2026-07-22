import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGithubTokenExpiresAt1737500001000 implements MigrationInterface {
  name = 'AddGithubTokenExpiresAt1737500001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "github_tokens" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "github_tokens" DROP COLUMN IF EXISTS "expires_at"`);
  }
}
