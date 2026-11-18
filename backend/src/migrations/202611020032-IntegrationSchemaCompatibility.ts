import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Append-only repair of known I1 / unified schema drift. Historical migrations remain immutable. */
export class IntegrationSchemaCompatibility2026110200032 implements MigrationInterface {
  name = 'IntegrationSchemaCompatibility2026110200032';
  async up(runner: QueryRunner): Promise<void> {
    const additions: Record<string, TableColumn[]> = {
      classroom_run: [
        new TableColumn({ name: 'break_started_at', type: 'datetime', isNullable: true }),
        new TableColumn({ name: 'break_ends_at', type: 'datetime', isNullable: true }),
      ],
      student_reward_record: [
        new TableColumn({ name: 'revoke_request_id', type: 'varchar', length: '100', isNullable: true }),
        new TableColumn({ name: 'revoked_at', type: 'datetime', isNullable: true }),
        new TableColumn({ name: 'revoked_by_teacher_id', type: 'integer', isNullable: true }),
        new TableColumn({ name: 'revoke_reason', type: 'varchar', length: '200', isNullable: true }),
      ],
    };
    for (const [table, columns] of Object.entries(additions)) {
      if (!(await runner.hasTable(table))) throw new Error('Missing historical table: ' + table);
      for (const column of columns)
        if (!(await runner.hasColumn(table, column.name))) await runner.addColumn(table, column);
    }
    // Existing duplicates cause a transactional failure, never silent deletion.
    await runner.query('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_student_reward_revoke_request" ON "student_reward_record" ("revoke_request_id") WHERE "revoke_request_id" IS NOT NULL');
  }
  async down(): Promise<void> {
    throw new Error('Forward-only compatibility migration. Restore a verified backup; do not drop classroom data.');
  }
}
