import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentArtworkRecords2026100700022 implements MigrationInterface {
  name = 'StudentArtworkRecords2026100700022';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_artwork_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "student_id" integer,
      "class_id" integer NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "lesson_step_index" integer,
      "teacher_id" integer NOT NULL,
      "storage_key" varchar(255) NOT NULL,
      "mime_type" varchar(64) NOT NULL,
      "original_name" varchar(255) NOT NULL,
      "ai_draft" text,
      "teacher_comment" text,
      "confirmed_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_artwork_student" ON "student_artwork_record" ("student_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_artwork_class" ON "student_artwork_record" ("class_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_artwork_run" ON "student_artwork_record" ("classroom_run_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_artwork_teacher" ON "student_artwork_record" ("teacher_id")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "student_artwork_record"');
  }
}
