import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentQuestionMap2026100600020 implements MigrationInterface {
  name = 'StudentQuestionMap2026100600020';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_question_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "student_id" integer,
      "class_id" integer NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "lesson_step_index" integer,
      "asr_raw_text" text NOT NULL,
      "teacher_corrected_text" text,
      "question_text" text NOT NULL,
      "topic" varchar(100),
      "domain" varchar(100),
      "is_anonymous" boolean NOT NULL DEFAULT (0),
      "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "request_hash" varchar(64) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_student_question_run_request" UNIQUE ("classroom_run_id", "request_id")
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_student_question_class_created" ON "student_question_record" ("class_id", "created_at")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_student_question_student_created" ON "student_question_record" ("class_id", "student_id", "created_at")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_student_question_run" ON "student_question_record" ("classroom_run_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_student_question_topic" ON "student_question_record" ("topic")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_student_question_domain" ON "student_question_record" ("domain")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "student_question_record"');
  }
}
