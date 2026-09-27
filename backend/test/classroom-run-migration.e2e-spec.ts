import { DataSource } from 'typeorm';
import { ClassroomRunStateMachine2026092700006 } from '../src/migrations/202609270006-ClassroomRunStateMachine';

describe('classroom run migration (e2e)', () => {
  it('adds task-four tables without changing existing lesson data', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query(
      `CREATE TABLE "lesson_plan" ("id" integer PRIMARY KEY, "title" varchar NOT NULL)`,
    );
    await dataSource.query(
      `INSERT INTO "lesson_plan"("id","title") VALUES (1,'已有教案')`,
    );
    const runner = dataSource.createQueryRunner();
    await new ClassroomRunStateMachine2026092700006().up(runner);
    for (const table of [
      'classroom_run',
      'classroom_run_step_snapshot',
      'classroom_event',
    ])
      await expect(runner.hasTable(table)).resolves.toBe(true);
    const rows = (await dataSource.query(
      `SELECT "id","title" FROM "lesson_plan"`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ id: 1, title: '已有教案' }]);
    const runTable = await runner.getTable('classroom_run');
    expect(runTable?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'lesson_plan_id',
        'lesson_plan_version',
        'teacher_id',
        'class_id',
        'classroom_id',
        'device_id',
        'status',
        'current_step_index',
        'elapsed_seconds',
        'version',
      ]),
    );
    const eventTable = await runner.getTable('classroom_event');
    expect(
      eventTable?.uniques.some((unique) =>
        ['operator_type', 'operator_id', 'request_id'].every((column) =>
          unique.columnNames.includes(column),
        ),
      ),
    ).toBe(true);
    await runner.release();
    await dataSource.destroy();
  });
});
