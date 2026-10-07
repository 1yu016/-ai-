import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomParticipation2026092800013 implements MigrationInterface {
  name = 'ClassroomParticipation2026092800013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "attendance_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "status" varchar NOT NULL CHECK ("status" IN ('present','absent','late','leave')),
      "note" varchar(300),
      "updated_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id", "student_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("updated_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "attendance_change_log" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "attendance_record_id" integer NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "previous_status" varchar CHECK ("previous_status" IN ('present','absent','late','leave')),
      "new_status" varchar NOT NULL CHECK ("new_status" IN ('present','absent','late','leave')),
      "source" varchar NOT NULL CHECK ("source" IN ('manual','batch','voice_confirmed')),
      "actor_type" varchar NOT NULL,
      "actor_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "confirmation_token_hash" varchar(64),
      "reason" varchar(300),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id", "student_id", "request_id"),
      UNIQUE("confirmation_token_hash"),
      FOREIGN KEY("attendance_record_id") REFERENCES "attendance_record"("id") ON DELETE RESTRICT,
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_group" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "name" varchar(100) NOT NULL,
      "description" varchar(300),
      "sort_order" integer NOT NULL DEFAULT (0),
      "membership_snapshot" text NOT NULL DEFAULT ('[]'),
      "batch_request_id" varchar(100),
      "created_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      "deleted_at" datetime,
      UNIQUE("classroom_run_id", "name"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("created_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_group_member" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "group_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "active" boolean NOT NULL DEFAULT (1),
      "added_by" integer NOT NULL,
      "added_at" datetime NOT NULL,
      "removed_at" datetime,
      UNIQUE("group_id", "student_id"),
      FOREIGN KEY("group_id") REFERENCES "student_group"("id") ON DELETE CASCADE,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("added_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "roll_call_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "mode" varchar NOT NULL CHECK ("mode" IN ('all','range','group','teacher_specified')),
      "group_id" integer,
      "selected_student_id" integer NOT NULL,
      "algorithm_version" varchar(30) NOT NULL,
      "cooldown_count" integer NOT NULL DEFAULT (2),
      "source" varchar(30) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id", "request_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT,
      FOREIGN KEY("group_id") REFERENCES "student_group"("id") ON DELETE SET NULL,
      FOREIGN KEY("selected_student_id") REFERENCES "student"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "roll_call_candidate_snapshot" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "roll_call_record_id" integer NOT NULL,
      "student_id" integer NOT NULL,
      "eligible" boolean NOT NULL,
      "exclusion_reason" varchar(50),
      "recent_call_count" integer NOT NULL DEFAULT (0),
      "total_call_count" integer NOT NULL DEFAULT (0),
      "last_called_at" datetime,
      "selected" boolean NOT NULL DEFAULT (0),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("roll_call_record_id", "student_id"),
      FOREIGN KEY("roll_call_record_id") REFERENCES "roll_call_record"("id") ON DELETE CASCADE,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT
    )`);
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_run" ON "attendance_record" ("classroom_run_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_student" ON "attendance_record" ("student_id", "updated_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_log_run" ON "attendance_change_log" ("classroom_run_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_group_run" ON "student_group" ("classroom_run_id", "sort_order")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_group_batch" ON "student_group" ("classroom_run_id", "batch_request_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_group_member_group" ON "student_group_member" ("group_id", "active")`,
      `CREATE INDEX IF NOT EXISTS "IDX_roll_call_run" ON "roll_call_record" ("classroom_run_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_roll_call_selected" ON "roll_call_record" ("selected_student_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_roll_call_candidate_record" ON "roll_call_candidate_snapshot" ("roll_call_record_id")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roll_call_candidate_snapshot"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roll_call_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_group_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_group"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_change_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_record"`);
  }
}
