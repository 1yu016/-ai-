import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class ResourceLibraryStageTwo2026092700004 implements MigrationInterface {
  name = 'ResourceLibraryStageTwo2026092700004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "teaching_resource" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "owner_type" varchar NOT NULL,
      "owner_id" varchar(128) NOT NULL,
      "title" varchar(200) NOT NULL,
      "aliases" text NOT NULL DEFAULT ('[]'),
      "description" text,
      "school_id" varchar(64),
      "resource_type" varchar NOT NULL DEFAULT ('document'),
      "category" varchar(100) NOT NULL DEFAULT ('未分类'),
      "category_id" integer,
      "age_group" varchar NOT NULL DEFAULT ('all'),
      "domain" varchar(100),
      "tags" text NOT NULL DEFAULT ('[]'),
      "file_url" varchar(500) NOT NULL DEFAULT (''),
      "cover_url" varchar(500),
      "file_name" varchar(255) NOT NULL DEFAULT (''),
      "mime_type" varchar(150) NOT NULL DEFAULT ('application/octet-stream'),
      "file_size" integer NOT NULL DEFAULT (0),
      "duration" real,
      "current_version_id" integer,
      "ai_teaching_goals" text,
      "ai_activity_suggestions" text,
      "review_status" varchar NOT NULL DEFAULT ('draft'),
      "deleted_at" datetime,
      "type" varchar(50), "url" text,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);

    for (const column of [
      new TableColumn({
        name: 'school_id',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'category_id',
        type: 'integer',
        isNullable: true,
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
        name: 'ai_teaching_goals',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'ai_activity_suggestions',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'deleted_at',
        type: 'datetime',
        isNullable: true,
      }),
    ])
      await this.addColumn(queryRunner, 'teaching_resource', column);

    const statements = [
      `CREATE TABLE IF NOT EXISTS "resource_category" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parent_id" integer, "name" varchar(100) NOT NULL, "sort" integer NOT NULL DEFAULT (0), "enabled" boolean NOT NULL DEFAULT (1), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("parent_id","name"), FOREIGN KEY("parent_id") REFERENCES "resource_category"("id") ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS "resource_version" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "resource_id" integer NOT NULL, "version_no" integer NOT NULL, "original_name" varchar(255) NOT NULL, "storage_name" varchar(100) NOT NULL, "storage_path" varchar(500) NOT NULL, "sha256" varchar(64) NOT NULL, "mime_type" varchar(150) NOT NULL, "file_size" integer NOT NULL, "duration" real, "created_by" integer NOT NULL, "created_by_type" varchar NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("resource_id","version_no"), FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "resource_tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar(100) NOT NULL UNIQUE, "created_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "resource_tag_relation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "resource_id" integer NOT NULL, "tag_id" integer NOT NULL, UNIQUE("resource_id","tag_id"), FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE CASCADE, FOREIGN KEY("tag_id") REFERENCES "resource_tag"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "resource_favorite" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "teacher_id" integer NOT NULL, "resource_id" integer NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("teacher_id","resource_id"), FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE, FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "resource_reference" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "resource_id" integer NOT NULL, "reference_type" varchar(50) NOT NULL, "reference_id" varchar(100) NOT NULL, "created_by" integer NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("resource_id","reference_type","reference_id"), FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS "resource_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "resource_id" integer NOT NULL, "reviewer_id" integer NOT NULL, "status" varchar NOT NULL, "comment" varchar(1000), "reviewed_at" datetime NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), FOREIGN KEY("resource_id") REFERENCES "teaching_resource"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "upload_session" ("id" varchar(36) PRIMARY KEY NOT NULL, "user_id" integer NOT NULL, "user_type" varchar NOT NULL, "school_id" varchar(64), "title" varchar(200) NOT NULL, "original_name" varchar(255) NOT NULL, "declared_mime" varchar(150) NOT NULL, "resource_type" varchar NOT NULL, "category" varchar(100) NOT NULL, "age_group" varchar NOT NULL, "total_size" integer NOT NULL, "chunk_size" integer NOT NULL, "total_chunks" integer NOT NULL, "expected_sha256" varchar(64), "status" varchar NOT NULL DEFAULT ('active'), "expires_at" datetime NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "upload_chunk" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "session_id" varchar(36) NOT NULL, "chunk_no" integer NOT NULL, "file_size" integer NOT NULL, "sha256" varchar(64) NOT NULL, "storage_path" varchar(500) NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("session_id","chunk_no"), FOREIGN KEY("session_id") REFERENCES "upload_session"("id") ON DELETE CASCADE)`,
    ];
    for (const statement of statements) await queryRunner.query(statement);

    await this.addForeignKey(
      queryRunner,
      'category_id',
      'resource_category',
      'FK_resource_category',
    );
    await this.addForeignKey(
      queryRunner,
      'current_version_id',
      'resource_version',
      'FK_resource_current_version',
    );

    for (const statement of [
      `CREATE INDEX IF NOT EXISTS "IDX_resource_owner" ON "teaching_resource" ("owner_type","owner_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_school" ON "teaching_resource" ("school_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_filter" ON "teaching_resource" ("resource_type","age_group","review_status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_version_resource" ON "resource_version" ("resource_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_version_sha" ON "resource_version" ("sha256")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_reference_resource" ON "resource_reference" ("resource_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_resource_review_resource" ON "resource_review" ("resource_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_upload_session_user" ON "upload_session" ("user_type","user_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_upload_chunk_session" ON "upload_chunk" ("session_id")`,
    ])
      await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'upload_chunk',
      'upload_session',
      'resource_review',
      'resource_reference',
      'resource_favorite',
      'resource_tag_relation',
      'resource_tag',
      'resource_version',
      'resource_category',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    // 为避免破坏旧资源数据，回滚时保留 teaching_resource 新增兼容列。
  }

  private async addColumn(
    queryRunner: QueryRunner,
    table: string,
    column: TableColumn,
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(table, column.name)))
      await queryRunner.addColumn(table, column);
  }

  private async addForeignKey(
    queryRunner: QueryRunner,
    column: string,
    referencedTable: string,
    name: string,
  ): Promise<void> {
    const table = await queryRunner.getTable('teaching_resource');
    if (
      table?.foreignKeys.some(
        (foreignKey) =>
          foreignKey.columnNames.length === 1 &&
          foreignKey.columnNames[0] === column,
      )
    )
      return;
    await queryRunner.createForeignKey(
      'teaching_resource',
      new TableForeignKey({
        name,
        columnNames: [column],
        referencedTableName: referencedTable,
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }
}
