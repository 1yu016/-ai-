import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomDirector2026100600018 implements MigrationInterface {
  name = 'ClassroomDirector2026100600018';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_director_suggestion_v2" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "type" varchar CHECK("type" IN ('question','grouping','summary','transition','resource','reward','pacing')) NOT NULL,
      "title" varchar(100) NOT NULL,
      "original_content" text NOT NULL,
      "current_content" text NOT NULL,
      "rationale" text NOT NULL,
      "resource_id" integer,
      "command_operation" varchar(50),
      "command_parameters" text,
      "status" varchar CHECK("status" IN ('pending','confirmed','rejected')) NOT NULL DEFAULT ('pending'),
      "confirmed_request_id" varchar(100),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_director_v2_run" ON "classroom_director_suggestion_v2" ("classroom_run_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_director_v2_teacher" ON "classroom_director_suggestion_v2" ("teacher_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "classroom_director_suggestion_v2"');
  }
}
