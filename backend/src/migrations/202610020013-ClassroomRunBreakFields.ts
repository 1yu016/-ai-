import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 7.4：课堂「课间休息」子状态字段。
 * break 不改动 status（保持 running），仅用 break_started_at / break_ends_at 承载课间窗口。
 */
export class ClassroomRunBreakFields2026100200013
  implements MigrationInterface
{
  name = 'ClassroomRunBreakFields2026100200013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "classroom_run" ADD COLUMN "break_started_at" datetime`,
    );
    await queryRunner.query(
      `ALTER TABLE "classroom_run" ADD COLUMN "break_ends_at" datetime`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "classroom_run" DROP COLUMN "break_ends_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "classroom_run" DROP COLUMN "break_started_at"`,
    );
  }
}
