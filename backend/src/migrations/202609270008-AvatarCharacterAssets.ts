import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AvatarCharacterAssets2026092700008 implements MigrationInterface {
  name = 'AvatarCharacterAssets2026092700008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_character" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "name" varchar(120) NOT NULL,
      "category" varchar NOT NULL,
      "description" text,
      "owner_type" varchar NOT NULL,
      "owner_id" integer NOT NULL,
      "school_id" varchar(64),
      "status" varchar NOT NULL DEFAULT ('draft'),
      "current_version_id" integer,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_version" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "character_id" integer NOT NULL,
      "version" integer NOT NULL,
      "engine_version" varchar(100) NOT NULL,
      "model_format" varchar NOT NULL,
      "checksum" varchar(64),
      "status" varchar NOT NULL DEFAULT ('draft'),
      "compatibility" text NOT NULL DEFAULT ('{}'),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      UNIQUE("character_id","version"),
      FOREIGN KEY("character_id") REFERENCES "avatar_character"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "avatar_asset" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "version_id" integer NOT NULL,
      "asset_type" varchar NOT NULL,
      "action_name" varchar,
      "original_name" varchar(255) NOT NULL,
      "file_path" varchar(500) NOT NULL,
      "mime_type" varchar(150) NOT NULL,
      "file_size" integer NOT NULL,
      "checksum" varchar(64) NOT NULL,
      "metadata" text NOT NULL DEFAULT ('{}'),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("version_id") REFERENCES "avatar_version"("id") ON DELETE CASCADE
    )`);

    await this.addColumn(
      queryRunner,
      'classroom_run',
      new TableColumn({
        name: 'avatar_version_id',
        type: 'integer',
        isNullable: true,
      }),
    );
    await this.addColumn(
      queryRunner,
      'classroom_snapshot',
      new TableColumn({
        name: 'avatar_version_id',
        type: 'integer',
        isNullable: true,
      }),
    );

    await this.addForeignKey(
      queryRunner,
      'avatar_character',
      'current_version_id',
      'avatar_version',
      'FK_avatar_current_version',
      'SET NULL',
    );
    await this.addForeignKey(
      queryRunner,
      'classroom_run',
      'avatar_version_id',
      'avatar_version',
      'FK_classroom_run_avatar_version',
      'RESTRICT',
    );
    await this.addForeignKey(
      queryRunner,
      'classroom_snapshot',
      'avatar_version_id',
      'avatar_version',
      'FK_classroom_snapshot_avatar_version',
      'RESTRICT',
    );

    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_character_owner" ON "avatar_character" ("owner_type","owner_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_character_school_status" ON "avatar_character" ("school_id","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_version_character" ON "avatar_version" ("character_id","version")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_asset_version" ON "avatar_asset" ("version_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_avatar_asset_action" ON "avatar_asset" ("version_id","asset_type","action_name")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_run_avatar_version" ON "classroom_run" ("avatar_version_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_classroom_snapshot_avatar_version" ON "classroom_snapshot" ("avatar_version_id")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropForeignKey(
      queryRunner,
      'classroom_snapshot',
      'FK_classroom_snapshot_avatar_version',
    );
    await this.dropForeignKey(
      queryRunner,
      'classroom_run',
      'FK_classroom_run_avatar_version',
    );
    await this.dropForeignKey(
      queryRunner,
      'avatar_character',
      'FK_avatar_current_version',
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_asset"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "avatar_character"`);
    // 课堂表中的可空兼容列保留，避免 SQLite 重建旧表造成历史课堂数据风险。
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
    onDelete: 'SET NULL' | 'RESTRICT',
  ) {
    const table = await queryRunner.getTable(tableName);
    if (
      table?.foreignKeys.some(
        (foreignKey) =>
          foreignKey.columnNames.length === 1 &&
          foreignKey.columnNames[0] === columnName,
      )
    )
      return;
    await queryRunner.createForeignKey(
      tableName,
      new TableForeignKey({
        name,
        columnNames: [columnName],
        referencedTableName,
        referencedColumnNames: ['id'],
        onDelete,
      }),
    );
  }

  private async dropForeignKey(
    queryRunner: QueryRunner,
    tableName: string,
    name: string,
  ) {
    const table = await queryRunner.getTable(tableName);
    const foreignKey = table?.foreignKeys.find((item) => item.name === name);
    if (foreignKey) await queryRunner.dropForeignKey(tableName, foreignKey);
  }
}
