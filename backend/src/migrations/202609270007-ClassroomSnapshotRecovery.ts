import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomSnapshotRecovery2026092700007 implements MigrationInterface {
  name = 'ClassroomSnapshotRecovery2026092700007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_snapshot" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "snapshot_version" integer NOT NULL,
      "run_version" integer NOT NULL,
      "run_status" varchar NOT NULL,
      "current_step_index" integer NOT NULL,
      "elapsed_seconds" integer NOT NULL,
      "played_resource_ids" text NOT NULL DEFAULT ('[]'),
      "attendance_state" text NOT NULL DEFAULT ('{}'),
      "roll_call_state" text NOT NULL DEFAULT ('{}'),
      "reward_state" text NOT NULL DEFAULT ('{}'),
      "interaction_state" text NOT NULL DEFAULT ('{}'),
      "player_state" text NOT NULL DEFAULT ('{}'),
      "device_id" integer NOT NULL,
      "reason" varchar NOT NULL,
      "is_key" boolean NOT NULL DEFAULT (0),
      "checksum" varchar(64) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("classroom_run_id","snapshot_version"),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("device_id") REFERENCES "device"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "classroom_device_transfer" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer NOT NULL,
      "old_device_id" integer NOT NULL,
      "new_device_id" integer NOT NULL,
      "operator_id" integer NOT NULL,
      "reason" varchar(500) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE CASCADE,
      FOREIGN KEY("old_device_id") REFERENCES "device"("id") ON DELETE RESTRICT,
      FOREIGN KEY("new_device_id") REFERENCES "device"("id") ON DELETE RESTRICT,
      FOREIGN KEY("operator_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_snapshot_run_version" ON "classroom_snapshot" ("classroom_run_id","snapshot_version")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_snapshot_created" ON "classroom_snapshot" ("classroom_run_id","created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_transfer_run" ON "classroom_device_transfer" ("classroom_run_id","created_at")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_device_transfer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_snapshot"`);
  }
}
