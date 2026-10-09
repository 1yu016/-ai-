import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FormalAttendanceRollCall2026100600015 implements MigrationInterface {
  name = 'FormalAttendanceRollCall2026100600015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_attendance_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "status" varchar NOT NULL,
      "first_status" varchar NOT NULL,
      "first_marked_by_teacher_id" integer NOT NULL,
      "first_marked_at" datetime NOT NULL,
      "modified_by_teacher_id" integer NOT NULL,
      "modified_at" datetime NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id", "student_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_attendance_change" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "attendance_record_id" integer NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "previous_status" varchar,
      "next_status" varchar NOT NULL,
      "changed_by_teacher_id" integer NOT NULL,
      "source" varchar NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("attendance_record_id") REFERENCES "student_attendance_record"("id") ON DELETE CASCADE,
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_roll_call_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "request_id" varchar(100) NOT NULL UNIQUE,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "mode" varchar NOT NULL,
      "group_key" varchar(100),
      "eligible_count" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attendance_class_run" ON "student_attendance_record" ("class_id", "classroom_run_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attendance_change_run_student" ON "student_attendance_change" ("classroom_run_id", "student_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_roll_call_run_created" ON "classroom_roll_call_record" ("classroom_run_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_roll_call_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_attendance_change"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_attendance_record"`);
  }
}
