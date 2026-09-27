import { DataSource } from 'typeorm';
import { StageOnePlatformFoundation2026092700001 } from '../src/migrations/202609270001-StageOnePlatformFoundation';

describe('Stage one database migration (e2e)', () => {
  it('upgrades the legacy teachers table without deleting existing data', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE teachers (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      account varchar(64) NOT NULL UNIQUE,
      password_hash varchar(255) NOT NULL,
      name varchar(100) NOT NULL,
      role varchar NOT NULL DEFAULT ('teacher'),
      created_at datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await dataSource.query(
      `INSERT INTO teachers(account,password_hash,name,role) VALUES ('legacy_teacher','hash','旧教师','teacher')`,
    );

    const runner = dataSource.createQueryRunner();
    await new StageOnePlatformFoundation2026092700001().up(runner);

    const rows = (await dataSource.query(
      `SELECT account,name,status,token_version FROM teachers WHERE account='legacy_teacher'`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        account: 'legacy_teacher',
        name: '旧教师',
        status: 'active',
        token_version: 0,
      },
    ]);
    for (const table of [
      'administrator',
      'class',
      'teacher_class',
      'student',
      'device',
      'device_binding',
      'classroom_ticket',
      'guardian_consent',
      'audit_log',
      'ai_call_log',
    ]) {
      await expect(runner.hasTable(table)).resolves.toBe(true);
    }
    await runner.release();
    await dataSource.destroy();
  });
});
