import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentRewardRecordIndexes2026100200012
  implements MigrationInterface
{
  name = 'StudentRewardRecordIndexes2026100200012';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_class_created"
       ON "student_reward_record" ("class_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_class_student_created"
       ON "student_reward_record" ("class_id", "student_id", "created_at")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_student_reward_record_class_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_student_reward_record_class_student_created"`,
    );
  }
}
