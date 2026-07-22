import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRepositoryInstallationSchema1737500006000 implements MigrationInterface {
  name = 'AddRepositoryInstallationSchema1737500006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "installation_id" BIGINT`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_repositories_installation_id ON repositories(installation_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_repositories_installation_id`);
    await queryRunner.query(`ALTER TABLE "repositories" DROP COLUMN IF EXISTS "installation_id"`);
  }
}
