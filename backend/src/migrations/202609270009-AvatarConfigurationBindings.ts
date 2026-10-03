import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AvatarConfigurationBindings2026092700009 implements MigrationInterface {
  name = 'AvatarConfigurationBindings2026092700009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_voice_profile" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "character_id" integer NOT NULL UNIQUE,
      "provider" varchar(80) NOT NULL,
      "voice_id" varchar(160) NOT NULL,
      "language" varchar(32) NOT NULL,
      "speed" real NOT NULL DEFAULT (1),
      "volume" real NOT NULL DEFAULT (1),
      "pitch" real NOT NULL DEFAULT (0),
      "status" varchar NOT NULL DEFAULT ('active'),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("character_id") REFERENCES "avatar_character"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_personality" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "character_id" integer NOT NULL UNIQUE,
      "style" varchar(80) NOT NULL,
      "catchphrases" text NOT NULL DEFAULT ('[]'),
      "greeting" varchar(500) NOT NULL,
      "encouragement_style" varchar(500) NOT NULL,
      "goodbye_text" varchar(500) NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("character_id") REFERENCES "avatar_character"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_binding" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "scope_type" varchar NOT NULL,
      "scope_id" integer NOT NULL DEFAULT (0),
      "character_id" integer NOT NULL,
      "version_id" integer NOT NULL,
      "created_by" integer NOT NULL,
      "status" varchar NOT NULL DEFAULT ('active'),
      "cancelled_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("character_id") REFERENCES "avatar_character"("id") ON DELETE RESTRICT,
      FOREIGN KEY("version_id") REFERENCES "avatar_version"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_config_history" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "character_id" integer,
      "scope_type" varchar,
      "scope_id" integer,
      "operator_type" varchar NOT NULL,
      "operator_id" integer NOT NULL,
      "before_summary" text,
      "after_summary" text,
      "reason" varchar(500) NOT NULL,
      "class_id" integer,
      "lesson_plan_id" integer,
      "classroom_run_id" integer,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("character_id") REFERENCES "avatar_character"("id") ON DELETE SET NULL,
      FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE SET NULL,
      FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE SET NULL,
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_usage_log" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "classroom_run_id" integer,
      "teacher_id" integer,
      "source_scope" varchar,
      "requested_character_id" integer,
      "effective_character_id" integer,
      "effective_version_id" integer,
      "requested_action" varchar,
      "effective_action" varchar,
      "fallback_level" varchar NOT NULL DEFAULT ('none'),
      "reason" text,
      "detail" text NOT NULL DEFAULT ('{}'),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("classroom_run_id") REFERENCES "classroom_run"("id") ON DELETE SET NULL,
      FOREIGN KEY("effective_character_id") REFERENCES "avatar_character"("id") ON DELETE SET NULL,
      FOREIGN KEY("effective_version_id") REFERENCES "avatar_version"("id") ON DELETE SET NULL
    )`);

    await this.addColumn(
      queryRunner,
      'classroom_run',
      new TableColumn({
        name: 'avatar_character_id',
        type: 'integer',
        isNullable: true,
      }),
    );
    await this.addColumn(
      queryRunner,
      'classroom_snapshot',
      new TableColumn({
        name: 'avatar_character_id',
        type: 'integer',
        isNullable: true,
      }),
    );
    await this.addForeignKey(
      queryRunner,
      'classroom_run',
      'avatar_character_id',
      'avatar_character',
      'FK_classroom_run_avatar_character',
    );
    await this.addForeignKey(
      queryRunner,
      'classroom_snapshot',
      'avatar_character_id',
      'avatar_character',
      'FK_classroom_snapshot_avatar_character',
    );

    for (const statement of [
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_avatar_binding_active_scope" ON "avatar_binding" ("scope_type","scope_id") WHERE "status" = 'active'`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_binding_character" ON "avatar_binding" ("character_id","version_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_config_history_class" ON "avatar_config_history" ("class_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_config_history_lesson" ON "avatar_config_history" ("lesson_plan_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_config_history_run" ON "avatar_config_history" ("classroom_run_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_usage_run" ON "avatar_usage_log" ("classroom_run_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_run_avatar_character" ON "classroom_run" ("avatar_character_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_snapshot_avatar_character" ON "classroom_snapshot" ("avatar_character_id")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropForeignKey(
      queryRunner,
      'classroom_snapshot',
      'FK_classroom_snapshot_avatar_character',
    );
    await this.dropForeignKey(
      queryRunner,
      'classroom_run',
      'FK_classroom_run_avatar_character',
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_usage_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_config_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_binding"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_personality"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_voice_profile"`);
    // 兼容列保留，避免 SQLite 重建课堂历史表造成数据风险。
  }

  private async addColumn(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
  ) {
    if (!(await queryRunner.hasColumn(table, column.name)))
      await queryRunner.addColumn(table, column);
  }

  private async addForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
    referencedTableName: string,
    name: string,
  ) {
    const table = await queryRunner.getTable(tableName);
    if (
      table?.foreignKeys.some((item) => item.columnNames.includes(columnName))
    )
      return;
    await queryRunner.createForeignKey(
      tableName,
      new TableForeignKey({
        name,
        columnNames: [columnName],
        referencedTableName,
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );
  }

  private async dropForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    name: string,
  ) {
    const table = await queryRunner.getTable(tableName);
    const key = table?.foreignKeys.find((item) => item.name === name);
    if (key) await queryRunner.dropForeignKey(tableName, key);
  }
}
