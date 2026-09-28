import { DataSource } from 'typeorm';
import { ClassroomRunStateMachine2026092700006 } from '../src/migrations/202609270006-ClassroomRunStateMachine';
import { ClassroomSnapshotRecovery2026092700007 } from '../src/migrations/202609270007-ClassroomSnapshotRecovery';
import { AvatarCharacterAssets2026092700008 } from '../src/migrations/202609270008-AvatarCharacterAssets';

describe('avatar character and asset migration (e2e)', () => {
  it('adds avatar tables and nullable classroom references without losing runs', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query('PRAGMA foreign_keys = OFF');
    const runner = dataSource.createQueryRunner();
    await new ClassroomRunStateMachine2026092700006().up(runner);
    await new ClassroomSnapshotRecovery2026092700007().up(runner);
    await dataSource.query(
      `INSERT INTO "classroom_run"(
        "lesson_plan_id","lesson_plan_version","teacher_id","class_id",
        "classroom_id","device_id","title","status","current_step_index",
        "elapsed_seconds","version"
      ) VALUES (1,1,1,1,1,1,'迁移前课堂','paused',0,45,2)`,
    );
    await new AvatarCharacterAssets2026092700008().up(runner);

    for (const table of ['avatar_character', 'avatar_version', 'avatar_asset'])
      await expect(runner.hasTable(table)).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_run', 'avatar_version_id'),
    ).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_snapshot', 'avatar_version_id'),
    ).resolves.toBe(true);
    const runs = (await dataSource.query(
      `SELECT "title","status","elapsed_seconds","avatar_version_id" FROM "classroom_run"`,
    )) as Array<Record<string, unknown>>;
    expect(runs).toEqual([
      {
        title: '迁移前课堂',
        status: 'paused',
        elapsed_seconds: 45,
        avatar_version_id: null,
      },
    ]);
    await dataSource.query(
      `INSERT INTO "avatar_character"("name","category","owner_type","owner_id") VALUES ('测试角色','cartoon_animal','teacher',1)`,
    );
    await dataSource.query(
      `INSERT INTO "avatar_version"("character_id","version","engine_version","model_format") VALUES (1,1,'avatar-engine-1','glb')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "avatar_version"("character_id","version","engine_version","model_format") VALUES (1,1,'avatar-engine-1','glb')`,
      ),
    ).rejects.toThrow();
    await runner.release();
    await dataSource.destroy();
  });
});
