import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RewardGrowthHonor2026100600016 implements MigrationInterface {
  name = 'RewardGrowthHonor2026100600016';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('student_reward_record');
    const columns = new Set(table?.columns.map((column) => column.name) ?? []);
    const additions = [
      ['reward_category', `varchar NOT NULL DEFAULT 'progress'`],
      ['reward_forms', `text NOT NULL DEFAULT '["flower"]'`],
      ['points', `integer NOT NULL DEFAULT 1`],
      ['badge_code', `varchar(64)`],
      ['praise_template_id', `varchar(64)`],
      ['praise_text', `varchar(120)`],
      ['teacher_confirmed_praise', `boolean NOT NULL DEFAULT 0`],
      ['animation_key', `varchar(32)`],
    ] as const;
    for (const [name, definition] of additions) {
      if (!columns.has(name)) await queryRunner.query(`ALTER TABLE "student_reward_record" ADD COLUMN "${name}" ${definition}`);
    }
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "class_growth_goal" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "class_id" integer NOT NULL,
      "title" varchar(100) NOT NULL,
      "target_points" integer NOT NULL,
      "current_points" integer NOT NULL DEFAULT 0,
      "status" varchar NOT NULL DEFAULT 'active',
      "created_by_teacher_id" integer NOT NULL,
      "completed_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_class_growth_goal_class_status" ON "class_growth_goal" ("class_id", "status")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "class_collective_reward_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "goal_id" integer,
      "reward_category" varchar NOT NULL,
      "points" integer NOT NULL,
      "reason" varchar(200) NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "revoked_at" datetime,
      "revoked_by_teacher_id" integer,
      "revoke_request_id" varchar(100) UNIQUE,
      "revoke_reason" varchar(200),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id", "request_id")
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "class_collective_reward_record"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "class_growth_goal"`);
  }
}
