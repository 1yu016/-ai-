import { DataSource } from 'typeorm';
import { ResourceLibraryStageTwo2026092700004 } from '../src/migrations/202609270004-ResourceLibraryStageTwo';

describe('Stage two resource migration (e2e)', () => {
  it('preserves legacy resource rows while adding the stage-two schema', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    // Stage two runs after the stage-one identity migration in production.
    await dataSource.query(`CREATE TABLE "teachers" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL
    )`);
    await dataSource.query(`CREATE TABLE "teaching_resource" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "owner_type" varchar NOT NULL,
      "owner_id" varchar(128) NOT NULL,
      "title" varchar(200) NOT NULL,
      "aliases" text NOT NULL DEFAULT ('[]'),
      "description" text,
      "resource_type" varchar NOT NULL DEFAULT ('document'),
      "category" varchar(100) NOT NULL DEFAULT ('未分类'),
      "age_group" varchar NOT NULL DEFAULT ('all'),
      "tags" text NOT NULL DEFAULT ('[]'),
      "file_url" varchar(500) NOT NULL DEFAULT (''),
      "cover_url" varchar(500), "file_name" varchar(255) NOT NULL DEFAULT (''),
      "mime_type" varchar(100) NOT NULL DEFAULT ('application/octet-stream'),
      "file_size" integer NOT NULL DEFAULT (0), "duration" real,
      "review_status" varchar NOT NULL DEFAULT ('pending'),
      "type" varchar(50), "url" text,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await dataSource.query(`INSERT INTO "teaching_resource"(
      "owner_type","owner_id","title"
    ) VALUES ('teacher','7','旧资源')`);
    const runner = dataSource.createQueryRunner();
    await new ResourceLibraryStageTwo2026092700004().up(runner);
    const rows = (await dataSource.query(
      `SELECT "id","title","owner_id" FROM "teaching_resource"`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ id: 1, title: '旧资源', owner_id: '7' }]);
    for (const column of [
      'school_id',
      'category_id',
      'domain',
      'current_version_id',
      'deleted_at',
    ]) {
      await expect(runner.hasColumn('teaching_resource', column)).resolves.toBe(
        true,
      );
    }
    for (const table of [
      'resource_category',
      'resource_version',
      'resource_tag',
      'resource_tag_relation',
      'resource_favorite',
      'resource_reference',
      'resource_review',
      'upload_session',
      'upload_chunk',
    ]) {
      await expect(runner.hasTable(table)).resolves.toBe(true);
    }
    await runner.release();
    await dataSource.destroy();
  });
});
