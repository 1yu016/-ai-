import { MigrationInterface, QueryRunner } from 'typeorm';

export class HeuristicAssistantDrafts2026092700011 implements MigrationInterface {
  name = 'HeuristicAssistantDrafts2026092700011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "heuristic_assistant_draft" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "run_version" integer NOT NULL,
      "current_step_index" integer NOT NULL,
      "attempt_count" integer NOT NULL,
      "input_summary" text NOT NULL,
      "response_text" text,
      "hint_level" integer,
      "safety_status" varchar,
      "follow_up_type" varchar,
      "recommended_resource_id" integer,
      "requires_teacher_confirmation" boolean NOT NULL DEFAULT (1),
      "status" varchar NOT NULL DEFAULT ('processing'),
      "edited_response_text" text,
      "decided_at" datetime,
      "tts_played_at" datetime,
      "provider" varchar(100),
      "model" varchar(100),
      "latency_ms" integer,
      "prompt_tokens" integer,
      "completion_tokens" integer,
      "total_tokens" integer,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
      FOREIGN KEY("recommended_resource_id") REFERENCES "teaching_resources"("id") ON DELETE SET NULL,
      UNIQUE("teacher_id", "request_id")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_heuristic_draft_run" ON "heuristic_assistant_draft" ("classroom_run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_heuristic_draft_teacher" ON "heuristic_assistant_draft" ("teacher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_heuristic_draft_status" ON "heuristic_assistant_draft" ("status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "heuristic_assistant_draft"`);
  }
}
