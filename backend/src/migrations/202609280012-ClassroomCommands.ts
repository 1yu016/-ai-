import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomCommands2026092800012 implements MigrationInterface {
  name = 'ClassroomCommands2026092800012';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_command_record" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "request_id" varchar(100) NOT NULL,
      "text_hash" varchar(64) NOT NULL,
      "locale" varchar(10) NOT NULL,
      "source" varchar NOT NULL,
      "intent" varchar NOT NULL,
      "parameters" text NOT NULL DEFAULT ('{}'),
      "confidence" real NOT NULL,
      "candidates" text NOT NULL DEFAULT ('[]'),
      "requires_confirmation" boolean NOT NULL DEFAULT (1),
      "execution_token_hash" varchar(64),
      "execution_token_expires_at" datetime,
      "execution_token_used_at" datetime,
      "confirmed_at" datetime,
      "status" varchar NOT NULL DEFAULT ('processing'),
      "message" varchar(300) NOT NULL,
      "execution_result" text,
      "error_code" varchar(100),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
      UNIQUE("teacher_id", "request_id"),
      UNIQUE("execution_token_hash")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_run" ON "classroom_command_record" ("classroom_run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_teacher" ON "classroom_command_record" ("teacher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_status" ON "classroom_command_record" ("status")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_command_rule" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "teacher_id" integer NOT NULL,
      "locale" varchar(10) NOT NULL,
      "phrase" varchar(100) NOT NULL,
      "normalized_phrase" varchar(100) NOT NULL,
      "intent" varchar NOT NULL,
      "parameter_template" text NOT NULL DEFAULT ('{}'),
      "priority" integer NOT NULL DEFAULT (200),
      "version" integer NOT NULL DEFAULT (1),
      "active" boolean NOT NULL DEFAULT (1),
      "valid_until" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
      UNIQUE("teacher_id", "locale", "normalized_phrase")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_rule_teacher" ON "classroom_command_rule" ("teacher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_rule_active" ON "classroom_command_rule" ("active")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_command_offline_log" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "local_event_id" varchar(100) NOT NULL,
      "text_hash" varchar(64) NOT NULL,
      "intent" varchar NOT NULL,
      "parameters" text NOT NULL DEFAULT ('{}'),
      "rule_version" integer NOT NULL,
      "result" varchar NOT NULL,
      "error_code" varchar(100),
      "executed_at" datetime NOT NULL,
      "uploaded_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE,
      UNIQUE("teacher_id", "local_event_id")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_offline_run" ON "classroom_command_offline_log" ("classroom_run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_command_offline_teacher" ON "classroom_command_offline_log" ("teacher_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "classroom_command_offline_log"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_command_rule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_command_record"`);
  }
}
