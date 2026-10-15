import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomDirectorSuggestions2026092700010 implements MigrationInterface {
  name = 'ClassroomDirectorSuggestions2026092700010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_director_suggestion" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "run_version" integer NOT NULL,
      "current_step_index" integer NOT NULL,
      "status" varchar NOT NULL DEFAULT ('processing'),
      "suggestion_type" varchar,
      "teacher_message" text,
      "reason" text,
      "suggested_action" text,
      "resource_candidates" text NOT NULL DEFAULT ('[]'),
      "confidence" real,
      "requires_confirmation" boolean NOT NULL DEFAULT (1),
      "provider" varchar(100),
      "model" varchar(100),
      "input_summary" text NOT NULL,
      "output_json" text,
      "latency_ms" integer,
      "prompt_tokens" integer,
      "completion_tokens" integer,
      "total_tokens" integer,
      "decision" varchar,
      "edited_teacher_message" text,
      "edited_suggested_action" text,
      "executed" boolean,
      "execution_result" varchar(500),
      "decided_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
      UNIQUE("teacher_id", "request_id")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_director_run" ON "classroom_director_suggestion" ("classroom_run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_director_teacher" ON "classroom_director_suggestion" ("teacher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_director_status" ON "classroom_director_suggestion" ("status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "classroom_director_suggestion"`,
    );
  }
}
