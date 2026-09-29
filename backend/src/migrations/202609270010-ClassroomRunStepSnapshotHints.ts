import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomRunStepSnapshotHints2026092700010
  implements MigrationInterface
{
  name = 'ClassroomRunStepSnapshotHints2026092700010';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (
      !(await queryRunner.hasColumn(
        'classroom_run_step_snapshot',
        'expected_response',
      ))
    )
      await queryRunner.query(
        `ALTER TABLE "classroom_run_step_snapshot" ADD COLUMN "expected_response" text`,
      );
    if (
      !(await queryRunner.hasColumn(
        'classroom_run_step_snapshot',
        'teacher_tip',
      ))
    )
      await queryRunner.query(
        `ALTER TABLE "classroom_run_step_snapshot" ADD COLUMN "teacher_tip" text`,
      );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (
      await queryRunner.hasColumn(
        'classroom_run_step_snapshot',
        'teacher_tip',
      )
    )
      await queryRunner.query(
        `ALTER TABLE "classroom_run_step_snapshot" DROP COLUMN "teacher_tip"`,
      );
    if (
      await queryRunner.hasColumn(
        'classroom_run_step_snapshot',
        'expected_response',
      )
    )
      await queryRunner.query(
        `ALTER TABLE "classroom_run_step_snapshot" DROP COLUMN "expected_response"`,
      );
  }
}