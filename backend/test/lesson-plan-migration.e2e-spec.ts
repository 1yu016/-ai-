import { DataSource } from 'typeorm';
import { LessonPreparationStageThree2026092700005 } from '../src/migrations/202609270005-LessonPreparationStageThree';

describe('Stage three lesson preparation migration (e2e)', () => {
  it('preserves legacy lesson plans and steps while adding stage-three tables', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query(
      `CREATE TABLE "teachers" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`,
    );
    await dataSource.query(`CREATE TABLE "lesson_plan" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "teacher_id" integer NOT NULL,
      "title" varchar(200) NOT NULL,
      "theme" varchar(200) NOT NULL,
      "age_group" varchar NOT NULL,
      "objectives" text NOT NULL,
      "estimated_minutes" integer NOT NULL,
      "status" varchar NOT NULL DEFAULT ('draft'),
      "version" integer NOT NULL DEFAULT (1),
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await dataSource.query(`CREATE TABLE "lesson_step" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "lesson_plan_id" integer NOT NULL,
      "sort_order" integer NOT NULL,
      "title" varchar(200) NOT NULL,
      "step_type" varchar NOT NULL,
      "instruction" text NOT NULL,
      "expected_response" text,
      "teacher_tip" text,
      "resource_id" integer,
      "duration_seconds" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')),
      "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY("lesson_plan_id") REFERENCES "lesson_plan"("id") ON DELETE CASCADE
    )`);
    await dataSource.query(`INSERT INTO "teachers"("id") VALUES (7)`);
    await dataSource.query(`INSERT INTO "lesson_plan"(
      "teacher_id","title","theme","age_group","objectives","estimated_minutes"
    ) VALUES (7,'旧教案','春天','4-5','观察颜色',20)`);
    await dataSource.query(`INSERT INTO "lesson_step"(
      "lesson_plan_id","sort_order","title","step_type","instruction","duration_seconds"
    ) VALUES (1,1,'观察','introduction','看看图片',60)`);
    const runner = dataSource.createQueryRunner();
    await new LessonPreparationStageThree2026092700005().up(runner);

    const plans = (await dataSource.query(
      `SELECT "id","title","lesson_type" FROM "lesson_plan"`,
    )) as Array<Record<string, unknown>>;
    expect(plans).toEqual([{ id: 1, title: '旧教案', lesson_type: 'normal' }]);
    const steps = (await dataSource.query(
      `SELECT "instruction","content" FROM "lesson_step"`,
    )) as Array<Record<string, unknown>>;
    expect(steps).toEqual([{ instruction: '看看图片', content: '看看图片' }]);
    for (const table of [
      'lesson_plan_version',
      'lesson_recovery_point',
      'lesson_ai_draft',
      'lesson_step_action',
    ])
      await expect(runner.hasTable(table)).resolves.toBe(true);
    for (const column of [
      'lesson_type',
      'domain',
      'current_version_id',
      'outline_json',
      'deleted_at',
    ])
      await expect(runner.hasColumn('lesson_plan', column)).resolves.toBe(true);
    const versionTable = await runner.getTable('lesson_plan_version');
    expect(
      versionTable?.uniques.some(
        (unique) =>
          unique.columnNames.includes('lesson_plan_id') &&
          unique.columnNames.includes('version_no'),
      ),
    ).toBe(true);
    await runner.release();
    await dataSource.destroy();
  });
});
