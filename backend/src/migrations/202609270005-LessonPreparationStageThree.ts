import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class LessonPreparationStageThree2026092700005 implements MigrationInterface {
  name = 'LessonPreparationStageThree2026092700005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lesson_plan" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "teacher_id" integer NOT NULL,
      "school_id" varchar(64),
      "title" varchar(200) NOT NULL,
      "theme" varchar(200) NOT NULL,
      "lesson_type" varchar NOT NULL DEFAULT ('normal'),
      "age_group" varchar NOT NULL,
      "domain" varchar(100),
      "objectives" text NOT NULL,
      "estimated_minutes" integer NOT NULL,
      "status" varchar NOT NULL DEFAULT ('draft'),
      "version" integer NOT NULL DEFAULT (1),
      "current_version_id" integer,
      "outline_json" text,
      "deleted_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lesson_step" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "lesson_plan_id" integer NOT NULL,
      "sort_order" integer NOT NULL,
      "title" varchar(200) NOT NULL,
      "step_type" varchar NOT NULL,
      "content" text,
      "instruction" text NOT NULL,
      "expected_response" text,
      "teacher_tip" text,
      "resource_id" integer,
      "duration_seconds" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE CASCADE,
      FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE RESTRICT
    )`);

    for (const column of [
      new TableColumn({
        name: 'school_id',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'lesson_type',
        type: 'varchar',
        default: "'normal'",
      }),
      new TableColumn({
        name: 'domain',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
      new TableColumn({
        name: 'current_version_id',
        type: 'integer',
        isNullable: true,
      }),
      new TableColumn({
        name: 'outline_json',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'deleted_at',
        type: 'datetime',
        isNullable: true,
      }),
    ])
      await this.addColumn(queryRunner, 'lesson_plan', column);
    await this.addColumn(
      queryRunner,
      'lesson_step',
      new TableColumn({ name: 'content', type: 'text', isNullable: true }),
    );
    await queryRunner.query(
      `UPDATE "lesson_step" SET "content" = "instruction" WHERE "content" IS NULL`,
    );

    for (const statement of [
      `CREATE TABLE IF NOT EXISTS "lesson_plan_version" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "lesson_plan_id" integer NOT NULL, "version_no" integer NOT NULL, "snapshot_json" text NOT NULL, "created_by" integer NOT NULL, "created_by_type" varchar NOT NULL, "change_summary" varchar(500) NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("lesson_plan_id","version_no"), FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "lesson_recovery_point" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "lesson_plan_id" integer NOT NULL, "step_id" integer NOT NULL UNIQUE, "name" varchar(100) NOT NULL, "trigger" varchar NOT NULL, "recovery_step_order" integer NOT NULL, "prompt" varchar(500), "enabled" boolean NOT NULL DEFAULT (1), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE CASCADE, FOREIGN KEY("step_id") REFERENCES "lesson_step"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "lesson_step_action" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "step_id" integer NOT NULL, "action_type" varchar NOT NULL, "action_name" varchar(50) NOT NULL, "content" varchar(500), "target_student_id" integer, "sort_order" integer NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), FOREIGN KEY("step_id") REFERENCES "lesson_step"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "lesson_ai_draft" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "teacher_id" integer NOT NULL, "school_id" varchar(64), "input_json" text NOT NULL, "output_json" text, "provider" varchar(100) NOT NULL, "model" varchar(100) NOT NULL, "status" varchar NOT NULL, "latency_ms" integer, "prompt_tokens" integer, "completion_tokens" integer, "total_tokens" integer, "error_message" varchar(500), "confirmed_by" integer, "confirmed_at" datetime, "lesson_plan_id" integer, "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT, FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE SET NULL)`,
    ])
      await queryRunner.query(statement);

    // SQLite cannot add a foreign key without rebuilding the parent table.
    // Rebuilding lesson_plan would trigger the legacy lesson_step CASCADE and
    // erase existing steps, so keep the scalar link there. Other databases
    // receive the database-level constraint as usual.
    if (!this.isSqlite(queryRunner))
      await this.addForeignKey(
        queryRunner,
        'lesson_plan',
        'current_version_id',
        'lesson_plan_version',
        'FK_lesson_plan_current_version',
        'SET NULL',
      );
    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_plan_teacher" ON "lesson_plan" ("teacher_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_plan_filter" ON "lesson_plan" ("lesson_type","age_group","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_step_plan" ON "lesson_step" ("lesson_plan_id","sort_order")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_version_plan" ON "lesson_plan_version" ("lesson_plan_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_recovery_plan" ON "lesson_recovery_point" ("lesson_plan_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_action_step" ON "lesson_step_action" ("step_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_lesson_ai_teacher" ON "lesson_ai_draft" ("teacher_id","status")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'lesson_ai_draft',
      'lesson_step_action',
      'lesson_recovery_point',
      'lesson_plan_version',
    ])
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    // 为避免破坏既有教案数据，兼容列在回滚时保留。
  }

  private async addColumn(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
  ): Promise<void> {
    if (await queryRunner.hasColumn(table, column.name)) return;
    if (this.isSqlite(queryRunner)) {
      const length = column.length ? `(${column.length})` : '';
      const nullable = column.isNullable ? '' : ' NOT NULL';
      const defaultValue =
        column.default === undefined ? '' : ` DEFAULT ${column.default}`;
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${column.type}${length}${nullable}${defaultValue}`,
      );
      return;
    }
    await queryRunner.addColumn(table, column);
  }

  private isSqlite(queryRunner: QueryRunner): boolean {
    return ['sqlite', 'better-sqlite3'].includes(
      queryRunner.connection.options.type,
    );
  }

  private async addForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    column: string,
    referencedTable: string,
    name: string,
    onDelete: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (
      table?.foreignKeys.some(
        (key) => key.columnNames.length === 1 && key.columnNames[0] === column,
      )
    )
      return;
    await queryRunner.createForeignKey(
      tableName,
      new TableForeignKey({
        name,
        columnNames: [column],
        referencedTableName: referencedTable,
        referencedColumnNames: ['id'],
        onDelete,
      }),
    );
  }
}
