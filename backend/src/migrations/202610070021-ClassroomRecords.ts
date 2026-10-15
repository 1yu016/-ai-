import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomRecords2026100700021 implements MigrationInterface {
  name = 'ClassroomRecords2026100700021';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_summary_draft" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "classroom_summary" text NOT NULL,
      "participation" text NOT NULL,
      "interest_points" text NOT NULL DEFAULT '[]',
      "common_questions" text NOT NULL DEFAULT '[]',
      "teaching_strategies" text NOT NULL DEFAULT '[]',
      "source" varchar CHECK("source" IN ('ai','safe_rules')) NOT NULL,
      "status" varchar CHECK("status" IN ('pending','confirmed','discarded')) NOT NULL DEFAULT 'pending',
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_classroom_summary_draft_run" UNIQUE ("classroom_run_id")
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_summary" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "draft_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "classroom_summary" text NOT NULL,
      "participation" text NOT NULL,
      "interest_points" text NOT NULL DEFAULT '[]',
      "common_questions" text NOT NULL DEFAULT '[]',
      "teaching_strategies" text NOT NULL DEFAULT '[]',
      "confirmed_at" datetime NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_classroom_summary_run" UNIQUE ("classroom_run_id")
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "classroom_summary"');
    await queryRunner.query('DROP TABLE IF EXISTS "classroom_summary_draft"');
  }
}
