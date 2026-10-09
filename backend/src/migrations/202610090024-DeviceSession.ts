import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceSession2026100900024 implements MigrationInterface {
  name = 'DeviceSession2026100900024';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "device_session" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "device_id" integer NOT NULL,
      "token_hash" varchar(64) NOT NULL,
      "school_id" varchar(64),
      "class_id" integer,
      "expires_at" datetime NOT NULL,
      "last_heartbeat_at" datetime,
      "revoked_at" datetime,
      "revoke_reason" varchar(120),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_device_session_token" ON "device_session" ("token_hash")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_device_session_device" ON "device_session" ("device_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "device_session"');
  }
}