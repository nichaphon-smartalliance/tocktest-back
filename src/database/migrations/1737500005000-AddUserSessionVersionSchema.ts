import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSessionVersionSchema1737500005000 implements MigrationInterface {
  name = 'AddUserSessionVersionSchema1737500005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" INTEGER NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "session_version"`);
  }
}
