import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomEngagement2026093000014 implements MigrationInterface {
  name = 'ClassroomEngagement2026093000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "badge_definition" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "school_id" varchar(64), "code" varchar(64) NOT NULL, "name" varchar(100) NOT NULL,
      "reward_type" varchar NOT NULL, "description" varchar(300), "icon_key" varchar(100),
      "active" boolean NOT NULL DEFAULT (1), "created_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("school_id","code"), FOREIGN KEY("created_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "reward_rule" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "school_id" varchar(64), "name" varchar(100) NOT NULL, "reward_type" varchar NOT NULL,
      "points_value" integer NOT NULL DEFAULT (0), "flower_count" integer NOT NULL DEFAULT (0),
      "class_growth_value" integer NOT NULL DEFAULT (0), "badge_definition_id" integer,
      "active" boolean NOT NULL DEFAULT (1), "created_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("school_id","name"),
      FOREIGN KEY("badge_definition_id") REFERENCES "badge_definition"("id") ON DELETE SET NULL,
      FOREIGN KEY("created_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "reward_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL, "class_id" integer NOT NULL, "student_id" integer,
      "teacher_id" integer NOT NULL, "rule_id" integer, "reward_type" varchar NOT NULL,
      "points" integer NOT NULL DEFAULT (0), "flower_count" integer NOT NULL DEFAULT (0),
      "class_growth_value" integer NOT NULL DEFAULT (0), "badge_definition_id" integer,
      "reason" varchar(300) NOT NULL, "status" varchar NOT NULL DEFAULT ('active'),
      "request_id" varchar(100) NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("teacher_id","request_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT,
      FOREIGN KEY("rule_id") REFERENCES "reward_rule"("id") ON DELETE SET NULL,
      FOREIGN KEY("badge_definition_id") REFERENCES "badge_definition"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "reward_reversal" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "reward_record_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL, "teacher_id" integer NOT NULL, "reason" varchar(300) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("reward_record_id"), UNIQUE("teacher_id","request_id"),
      FOREIGN KEY("reward_record_id") REFERENCES "reward_record"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "student_badge" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "student_id" integer NOT NULL,
      "badge_definition_id" integer NOT NULL, "reward_record_id" integer NOT NULL,
      "active" boolean NOT NULL DEFAULT (1), "awarded_at" datetime NOT NULL DEFAULT (datetime('now')), "reversed_at" datetime,
      UNIQUE("reward_record_id"),
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("badge_definition_id") REFERENCES "badge_definition"("id") ON DELETE RESTRICT,
      FOREIGN KEY("reward_record_id") REFERENCES "reward_record"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "collective_goal" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "class_id" integer NOT NULL,
      "title" varchar(120) NOT NULL, "description" varchar(500), "target_value" integer NOT NULL,
      "current_value" integer NOT NULL DEFAULT (0), "status" varchar NOT NULL DEFAULT ('active'),
      "teacher_id" integer NOT NULL, "completed_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "class_growth_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "class_id" integer NOT NULL,
      "classroom_run_id" integer, "reward_record_id" integer, "goal_id" integer,
      "delta" integer NOT NULL, "balance_after" integer NOT NULL, "event_type" varchar NOT NULL,
      "reason" varchar(300) NOT NULL, "teacher_id" integer NOT NULL, "request_id" varchar(100) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("class_id","request_id"),
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE SET NULL,
      FOREIGN KEY("reward_record_id") REFERENCES "reward_record"("id") ON DELETE SET NULL,
      FOREIGN KEY("goal_id") REFERENCES "collective_goal"("id") ON DELETE SET NULL,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "honor_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL, "student_id" integer, "type" varchar NOT NULL,
      "title" varchar(120) NOT NULL, "dimensions" text NOT NULL DEFAULT ('{}'), "status" varchar NOT NULL DEFAULT ('draft'),
      "teacher_id" integer NOT NULL, "request_id" varchar(100) NOT NULL, "confirmed_by" integer,
      "confirmed_at" datetime, "cooldown_until" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("teacher_id","request_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE RESTRICT,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT,
      FOREIGN KEY("confirmed_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "break_config" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "class_id" integer NOT NULL,
      "type" varchar NOT NULL, "name" varchar(100) NOT NULL, "duration_seconds" integer NOT NULL,
      "instructions" varchar(500), "enabled" boolean NOT NULL DEFAULT (1), "created_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE CASCADE,
      FOREIGN KEY("created_by") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "break_run" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL, "config_id" integer, "type" varchar NOT NULL, "title" varchar(100) NOT NULL,
      "duration_seconds" integer NOT NULL, "status" varchar NOT NULL DEFAULT ('running'),
      "saved_run_status" varchar(30) NOT NULL, "saved_step_index" integer NOT NULL, "saved_run_version" integer NOT NULL,
      "elapsed_seconds" integer NOT NULL DEFAULT (0), "started_at" datetime NOT NULL, "resumed_at" datetime,
      "paused_at" datetime, "ended_at" datetime, "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL, "version" integer NOT NULL DEFAULT (1),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("teacher_id","request_id"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT,
      FOREIGN KEY("config_id") REFERENCES "break_config"("id") ON DELETE SET NULL,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_reward_record_run" ON "reward_record" ("classroom_run_id","created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_reward_record_student" ON "reward_record" ("student_id","reward_type")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_badge_student" ON "student_badge" ("student_id","active")`,
      `CREATE INDEX IF NOT EXISTS "IDX_growth_class" ON "class_growth_record" ("class_id","created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_goal_class_status" ON "collective_goal" ("class_id","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_honor_class_type" ON "honor_record" ("class_id","type","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_break_config_class" ON "break_config" ("class_id","enabled")`,
      `CREATE INDEX IF NOT EXISTS "IDX_break_run_classroom" ON "break_run" ("classroom_run_id","status")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_break_run_active_classroom" ON "break_run" ("classroom_run_id") WHERE "status" IN ('running','paused')`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'break_run',
      'break_config',
      'honor_record',
      'class_growth_record',
      'collective_goal',
      'student_badge',
      'reward_reversal',
      'reward_record',
      'reward_rule',
      'badge_definition',
    ])
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
  }
}
