import Database from 'better-sqlite3'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const source = resolve(process.env.BACKUP_SOURCE || join(process.cwd(), 'data', 'app.sqlite'))
const temporary = await mkdtemp(join(tmpdir(), 'kindergarten-ai-backup-'))
const restored = join(temporary, basename(source))

try {
  await copyFile(source, restored)
  const database = new Database(restored, { readonly: true, fileMustExist: true })
  const integrity = database.pragma('integrity_check', { simple: true })
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
  database.close()
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
  if (!tables.includes('teachers')) throw new Error('Restored database is missing teachers table')
  console.log(JSON.stringify({ source, restoredCopy: restored, integrity, tableCount: tables.length, tables }))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
