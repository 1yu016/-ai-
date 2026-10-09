// Rehearse migrations against a SQLite online backup; never migrate the source.
const Database = require('better-sqlite3');
const { mkdtemp } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

async function main() {
  const source = resolve(process.env.INTEGRATION_SOURCE || 'data/app.sqlite');
  const folder = await mkdtemp(join(tmpdir(), 'classroom-integration-'));
  const target = join(folder, 'rehearsal.sqlite');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations'").all().map(r => r.name);
  const counts = Object.fromEntries(tableNames.map(name => [name, db.prepare('SELECT COUNT(*) AS count FROM "' + name.replaceAll('"', '""') + '"').get().count]));
  await db.backup(target);
  db.close();
  process.env.DATABASE_PATH = target;
  process.env.DB_SYNCHRONIZE = 'false';
  process.env.DB_MIGRATIONS_RUN = 'true';
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'], abortOnError: false });
  await app.close();
  const migrated = new Database(target, { readonly: true });
  for (const [name, count] of Object.entries(counts)) {
    const after = migrated.prepare('SELECT COUNT(*) AS count FROM "' + name.replaceAll('"', '""') + '"').get().count;
    if (after < count) throw new Error('Migration lost rows in ' + name);
  }
  if (migrated.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Integrity check failed');
  const directorColumns = migrated.pragma('table_info(classroom_director_suggestion_v2)').map(r => r.name);
  if (!directorColumns.includes('current_content')) throw new Error('V2 director table missing');
  migrated.close();
  console.log(JSON.stringify({ ok: true, originalUntouched: true, checkedTables: tableNames.length, rehearsalDatabase: target }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
