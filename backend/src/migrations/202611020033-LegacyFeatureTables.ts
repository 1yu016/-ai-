import { MigrationInterface, QueryRunner } from 'typeorm';

/** Existing I1 modules previously depended on synchronize. Existing tables and data are retained. */
export class LegacyFeatureTables2026110200033 implements MigrationInterface {
  name = 'LegacyFeatureTables2026110200033';
  async up(runner: QueryRunner): Promise<void> {
    const definitions: Record<string, string> = {
      "lesson_run": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"lesson_plan_id\" integer NOT NULL, \"teacher_id\" integer NOT NULL, \"status\" varchar CHECK(\"status\" IN ('running','paused','completed','cancelled')) NOT NULL DEFAULT ('running'), \"current_step_order\" integer NOT NULL, \"lesson_title\" varchar(200) NOT NULL, \"lesson_objectives\" text NOT NULL, \"age_group\" varchar(10) NOT NULL, \"steps_snapshot\" text NOT NULL, \"elapsed_seconds\" integer NOT NULL DEFAULT (0), \"resumed_at\" datetime, \"started_at\" datetime NOT NULL, \"ended_at\" datetime, \"created_at\" datetime NOT NULL DEFAULT (datetime('now')), \"updated_at\" datetime NOT NULL DEFAULT (datetime('now'))",
      "session": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"title\" varchar(120), \"last_active_at\" datetime NOT NULL, \"owner_type\" varchar CHECK(\"owner_type\" IN ('visitor','teacher','administrator')) NOT NULL, \"owner_id\" varchar(128) NOT NULL, \"created_at\" datetime NOT NULL DEFAULT (datetime('now')), \"updated_at\" datetime NOT NULL DEFAULT (datetime('now'))",
      "chat_message": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"session_id\" integer NOT NULL, \"role\" varchar CHECK(\"role\" IN ('user','assistant')) NOT NULL, \"content\" text NOT NULL, \"owner_type\" varchar CHECK(\"owner_type\" IN ('visitor','teacher','administrator')) NOT NULL, \"owner_id\" varchar(128) NOT NULL, \"created_at\" datetime NOT NULL DEFAULT (datetime('now'))",
      "check_in": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"check_in_at\" datetime NOT NULL, \"owner_type\" varchar CHECK(\"owner_type\" IN ('visitor','teacher','administrator')) NOT NULL, \"owner_id\" varchar(128) NOT NULL, \"created_at\" datetime NOT NULL DEFAULT (datetime('now'))",
      "emotion_event": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"session_id\" integer, \"emotion\" varchar(50) NOT NULL, \"intensity\" integer, \"owner_type\" varchar CHECK(\"owner_type\" IN ('visitor','teacher','administrator')) NOT NULL, \"owner_id\" varchar(128) NOT NULL, \"created_at\" datetime NOT NULL DEFAULT (datetime('now'))",
      "visitor_migration": "\"id\" integer PRIMARY KEY AUTOINCREMENT NOT NULL, \"visitor_id\" varchar(128) NOT NULL UNIQUE, \"teacher_id\" varchar(128) NOT NULL, \"created_at\" datetime NOT NULL DEFAULT (datetime('now'))"
};
    for (const [name, definition] of Object.entries(definitions))
      if (!(await runner.hasTable(name))) await runner.query('CREATE TABLE "' + name + '" (' + definition + ')');
    for (const name of ['session', 'chat_message', 'check_in', 'emotion_event']) {
      const table = await runner.getTable(name);
      if (!table?.findColumnByName('owner_type') || !table.findColumnByName('owner_id'))
        throw new Error('Unexpected existing legacy table shape: ' + name);
      for (const column of ['owner_type', 'owner_id'])
        if (!table.indices.some((index) => index.columnNames.length === 1 && index.columnNames[0] === column))
          await runner.query('CREATE INDEX IF NOT EXISTS "IDX_' + name + '_' + column + '" ON "' + name + '" ("' + column + '")');
    }
    for (const name of ['chat_message', 'emotion_event']) {
      const table = await runner.getTable(name);
      if (!table?.findColumnByName('session_id')) throw new Error('Missing session reference in ' + name);
      if (!table.indices.some((index) => index.columnNames.length === 1 && index.columnNames[0] === 'session_id'))
        await runner.query('CREATE INDEX IF NOT EXISTS "IDX_' + name + '_session_id" ON "' + name + '" ("session_id")');
    }
  }
  async down(): Promise<void> {
    throw new Error('Forward-only migration: retain legacy feature data and restore a verified backup if required.');
  }
}
