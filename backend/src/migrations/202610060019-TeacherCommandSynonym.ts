import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherCommandSynonym2026100600019 implements MigrationInterface {
  name = 'TeacherCommandSynonym2026100600019';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "teacher_command_synonym" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "teacher_id" integer NOT NULL,
      "phrase" varchar(40) NOT NULL,
      "normalized_phrase" varchar(40) NOT NULL,
      "operation" varchar(50) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "UQ_teacher_command_synonym" UNIQUE ("teacher_id", "normalized_phrase")
    )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_teacher_command_synonym_teacher" ON "teacher_command_synonym" ("teacher_id")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "teacher_command_synonym"');
  }
}
