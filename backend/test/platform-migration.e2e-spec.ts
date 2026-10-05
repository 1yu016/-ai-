import { DataSource } from 'typeorm';
import { StageOnePlatformFoundation2026092700001 } from '../src/migrations/202609270001-StageOnePlatformFoundation';
import { ClassroomTicketForeignKeys2026092700003 } from '../src/migrations/202609270003-ClassroomTicketForeignKeys';

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
      'refresh_token_session',
      'class',
      'teacher_class',
      'student',
      'classroom',
      'device',
      'device_binding',
      'classroom_ticket',
      'guardian_consent',
      'audit_log',
      'ai_call_log',
    ]) {
      await expect(runner.hasTable(table)).resolves.toBe(true);
    }
    const ticketTable = await runner.getTable('classroom_ticket');
    expect(
      ticketTable?.foreignKeys.map((foreignKey) =>
        foreignKey.columnNames.join(','),
      ),
    ).toEqual(
      expect.arrayContaining(['class_id', 'device_id', 'classroom_id']),
    );
    await runner.release();
    await dataSource.destroy();
  });

  it('adds missing ticket foreign keys without losing existing tickets', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query(
      `CREATE TABLE "class" ("id" integer PRIMARY KEY NOT NULL)`,
    );
    await dataSource.query(
      `CREATE TABLE "device" ("id" integer PRIMARY KEY NOT NULL)`,
    );
    await dataSource.query(
      `CREATE TABLE "classroom" ("id" integer PRIMARY KEY NOT NULL)`,
    );
    await dataSource.query(`CREATE TABLE "classroom_ticket" (
      "id" varchar(36) PRIMARY KEY NOT NULL,
      "ticket_hash" varchar(64) NOT NULL UNIQUE,
      "class_id" integer NOT NULL,
      "device_id" integer NOT NULL,
      "classroom_id" integer NOT NULL,
      "lesson_run_id" integer,
      "expires_at" datetime NOT NULL,
      "used_at" datetime,
      "is_used" boolean NOT NULL DEFAULT (0),
      "created_by" integer NOT NULL,
      "created_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await dataSource.query(`INSERT INTO "class"("id") VALUES (1)`);
    await dataSource.query(`INSERT INTO "device"("id") VALUES (1)`);
    await dataSource.query(`INSERT INTO "classroom"("id") VALUES (1)`);
    await dataSource.query(`INSERT INTO "classroom_ticket"(
      "id","ticket_hash","class_id","device_id","classroom_id",
      "expires_at","created_by"
    ) VALUES ('legacy-ticket','hash',1,1,1,datetime('now','+1 hour'),1)`);

    const runner = dataSource.createQueryRunner();
    await new ClassroomTicketForeignKeys2026092700003().up(runner);

    const rows = (await dataSource.query(
      `SELECT "id","ticket_hash" FROM "classroom_ticket"`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ id: 'legacy-ticket', ticket_hash: 'hash' }]);
    const table = await runner.getTable('classroom_ticket');
    expect(
      table?.foreignKeys.map((foreignKey) => foreignKey.columnNames[0]),
    ).toEqual(
      expect.arrayContaining(['class_id', 'device_id', 'classroom_id']),
    );
    await runner.release();
    await dataSource.destroy();
  });
});
