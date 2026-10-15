import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomMobileRealtime2026100700023 implements MigrationInterface {
  name = 'ClassroomMobileRealtime2026100700023';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_control_session" (
      "id" varchar PRIMARY KEY NOT NULL,
      "token_hash" varchar(64) NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "teacher_id" integer NOT NULL,
      "class_id" integer NOT NULL,
      "screen_device_id" integer NOT NULL,
      "expires_at" datetime NOT NULL,
      "last_heartbeat_at" datetime,
      "revoked_at" datetime,
      "revoke_reason" varchar(120),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_classroom_control_session_token" ON "classroom_control_session" ("token_hash")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_classroom_control_session_run_teacher" ON "classroom_control_session" ("classroom_run_id", "teacher_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "classroom_control_session"');
  }
}
