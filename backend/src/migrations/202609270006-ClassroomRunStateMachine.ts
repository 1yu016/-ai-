import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomRunStateMachine2026092700006 implements MigrationInterface {
  name = 'ClassroomRunStateMachine2026092700006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_run" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "lesson_plan_id" integer NOT NULL,
      "lesson_plan_version" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "classroom_id" integer NOT NULL,
      "device_id" integer NOT NULL,
      "title" varchar(200) NOT NULL,
      "status" varchar NOT NULL DEFAULT ('prepared') CHECK ("status" IN ('prepared','running','paused','completed','cancelled','failed')),
      "current_step_index" integer NOT NULL DEFAULT (0),
      "started_at" datetime,
      "paused_at" datetime,
      "resumed_at" datetime,
      "ended_at" datetime,
      "elapsed_seconds" integer NOT NULL DEFAULT (0),
      "version" integer NOT NULL DEFAULT (1),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("classroom_id") REFERENCES "classroom"("id") ON DELETE RESTRICT,
      FOREIGN KEY("device_id") REFERENCES "device"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_run_step_snapshot" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "original_step_id" integer NOT NULL,
      "step_index" integer NOT NULL,
      "title" varchar(200) NOT NULL,
      "type" varchar NOT NULL,
      "content" text NOT NULL,
      "duration_seconds" integer NOT NULL,
      "resource_id" integer,
      "action_config" text,
      "recovery_point_config" text,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id","step_index"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_event" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "event_type" varchar NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "operator_type" varchar NOT NULL,
      "operator_id" integer NOT NULL,
      "device_id" integer,
      "payload" text,
      "result" varchar NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("operator_type","operator_id","request_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("device_id") REFERENCES "device"("id") ON DELETE SET NULL
    )`);
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_run_teacher_status" ON "classroom_run" ("teacher_id","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_run_lesson_plan" ON "classroom_run" ("lesson_plan_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_run_classroom" ON "classroom_run" ("classroom_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_classroom_run_active_class" ON "classroom_run" ("class_id") WHERE "status" IN ('prepared','running','paused')`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_classroom_run_active_device" ON "classroom_run" ("device_id") WHERE "status" IN ('prepared','running','paused')`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_snapshot_run" ON "classroom_run_step_snapshot" ("classroom_run_id","step_index")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_event_run" ON "classroom_event" ("classroom_run_id","created_at")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_event"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "classroom_run_step_snapshot"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_run"`);
  }
}
