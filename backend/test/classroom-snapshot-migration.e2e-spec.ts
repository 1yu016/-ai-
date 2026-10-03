import { DataSource } from 'typeorm';
import { ClassroomRunStateMachine2026092700006 } from '../src/migrations/202609270006-ClassroomRunStateMachine';
import { ClassroomSnapshotRecovery2026092700007 } from '../src/migrations/202609270007-ClassroomSnapshotRecovery';

describe('classroom snapshot migration (e2e)', () => {
  it('adds snapshot and transfer tables without changing existing runs', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    // The fixture intentionally represents only the task-4 slice of an older
    // database. Disable FK enforcement while seeding its existing run because
    // the referenced platform/lesson tables are outside this migration test.
    await dataSource.query('PRAGMA foreign_keys = OFF');
    const runner = dataSource.createQueryRunner();
    await new ClassroomRunStateMachine2026092700006().up(runner);
    await dataSource.query(
      `INSERT INTO "classroom_run"(
        "lesson_plan_id","lesson_plan_version","teacher_id","class_id",
        "classroom_id","device_id","title","status","current_step_index",
        "elapsed_seconds","version"
      ) VALUES (1,2,3,4,5,6,'已有课堂','paused',1,30,2)`,
    );
    await new ClassroomSnapshotRecovery2026092700007().up(runner);
    await expect(runner.hasTable('classroom_snapshot')).resolves.toBe(true);
    await expect(runner.hasTable('classroom_device_transfer')).resolves.toBe(
      true,
    );
    const run = (await dataSource.query(
      `SELECT "title","status","elapsed_seconds" FROM "classroom_run"`,
    )) as Array<Record<string, unknown>>;
    expect(run).toEqual([
      { title: '已有课堂', status: 'paused', elapsed_seconds: 30 },
    ]);
    const snapshotTable = await runner.getTable('classroom_snapshot');
    expect(snapshotTable?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'snapshot_version',
        'run_status',
        'current_step_index',
        'played_resource_ids',
        'player_state',
        'checksum',
      ]),
    );
    expect(
      snapshotTable?.uniques.some((unique) =>
        ['classroom_run_id', 'snapshot_version'].every((column) =>
          unique.columnNames.includes(column),
        ),
      ),
    ).toBe(true);
    await runner.release();
    await dataSource.destroy();
  });
});
