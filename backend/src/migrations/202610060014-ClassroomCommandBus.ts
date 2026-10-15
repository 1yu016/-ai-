import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomCommandBus2026100600014 implements MigrationInterface {
  name = 'ClassroomCommandBus2026100600014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "classroom_operation_record" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "request_id" varchar(100) NOT NULL,
        "classroom_run_id" integer NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "source" varchar NOT NULL,
        "operation" varchar NOT NULL,
        "operator_type" varchar NOT NULL,
        "operator_id" integer NOT NULL,
        "device_id" integer NOT NULL,
        "target_device_id" integer,
        "expected_version" integer NOT NULL,
        "parameters_summary" text,
        "status" varchar NOT NULL,
        "http_status" integer,
        "failure_reason" varchar(500),
        "response_payload" text,
        "executed_at" datetime,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_classroom_command_request" UNIQUE ("request_id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_operation_run_created" ON "classroom_operation_record" ("classroom_run_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_operation_operator" ON "classroom_operation_record" ("operator_type", "operator_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" ADD COLUMN "revoke_request_id" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" ADD COLUMN "revoked_at" datetime`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" ADD COLUMN "revoked_by_teacher_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" ADD COLUMN "revoke_reason" varchar(200)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_student_reward_revoke_request" ON "student_reward_record" ("revoke_request_id") WHERE "revoke_request_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "classroom_operation_record"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_student_reward_revoke_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" DROP COLUMN "revoke_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" DROP COLUMN "revoked_by_teacher_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" DROP COLUMN "revoked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_reward_record" DROP COLUMN "revoke_request_id"`,
    );
  }
}
