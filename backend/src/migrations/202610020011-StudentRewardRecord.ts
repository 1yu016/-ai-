import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentRewardRecord2026100200011 implements MigrationInterface {
  name = 'StudentRewardRecord2026100200011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_reward_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "student_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "reward_type" varchar(32) NOT NULL DEFAULT ('flower'),
      "stars" integer NOT NULL DEFAULT (1),
      "reason" varchar(200),
      "request_id" varchar(100) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id","request_id"),
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_student" ON "student_reward_record" ("student_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_class" ON "student_reward_record" ("class_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_run" ON "student_reward_record" ("classroom_run_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_reward_record_teacher" ON "student_reward_record" ("teacher_id")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "student_reward_record"`);
  }
}
