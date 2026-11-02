import 'reflect-metadata';
import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { UNIFIED_MIGRATIONS } from '../src/migrations/unified-migrations';

async function main() {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (!configuredPath || !isAbsolute(configuredPath))
    throw new Error('请先将 DATABASE_PATH 设置为 SQLite 数据库的绝对路径');

  const databasePath = resolve(configuredPath);
  await mkdir(dirname(databasePath), { recursive: true });

  let backupPath: string | null = null;
  if (existsSync(databasePath)) {
    const source = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
    try {
      const integrity = source.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`迁移前 SQLite 完整性检查失败：${integrity}`);
      const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      if (tables.some((table) => table.name !== 'migrations')) {
        if (!tables.some((table) => table.name === 'migrations'))
          throw new Error('Existing schema has no migration ledger. Stop and establish a reviewed baseline on a backup; no migration history will be fabricated.');
        const ledger = new Set((source.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((row) => row.name));
        const historicallyExecuted = ['ClassroomRunBreakFields2026100200013', 'ClassroomCommandBus2026100600014'];
        for (const name of historicallyExecuted) {
          const tableName = name.startsWith('ClassroomRunBreak') ? 'classroom_run' : 'student_reward_record';
          const columnName = name.startsWith('ClassroomRunBreak') ? 'break_started_at' : 'revoke_request_id';
          if (tables.some((table) => table.name === tableName)) {
            const columns = source.prepare('PRAGMA table_info("' + tableName + '")').all() as Array<{ name: string }>;
            if (columns.some((column) => column.name === columnName) && !ledger.has(name))
              throw new Error('Schema/ledger mismatch for ' + name + '; review a backup before proceeding.');
          }
        }
      }
      backupPath = `${databasePath}.pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
      if (existsSync(backupPath)) throw new Error(`迁移备份已存在，拒绝覆盖：${backupPath}`);
      await source.backup(backupPath);
    } finally {
      source.close();
    }
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = backup.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`迁移备份验证失败：${integrity}`);
    } finally {
      backup.close();
    }
  }

  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: databasePath,
    synchronize: false,
    migrationsRun: false,
    migrations: UNIFIED_MIGRATIONS,
  });

  let applied: string[] = [];
  try {
    await dataSource.initialize();
    applied = (await dataSource.runMigrations({ transaction: 'all' })).map((item) => item.name);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`数据库迁移失败；原库未被脚本清空，迁移前备份保留在 ${backupPath ?? '（全新数据库，无旧库备份）'}。原因：${detail}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }

  const verified = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = verified.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`迁移后 SQLite 完整性检查失败：${integrity}`);
    const migrationCount = verified.prepare('SELECT COUNT(*) AS count FROM migrations').get() as { count: number };
    console.log(JSON.stringify({ ok: true, databasePath, backupPath, applied, migrationCount: migrationCount.count, integrity }, null, 2));
  } finally {
    verified.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
