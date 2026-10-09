import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassroomBreakMode2026100600017 implements MigrationInterface {
  name = 'ClassroomBreakMode2026100600017';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('classroom_run');
    const columns = new Set(table?.columns.map((column) => column.name) ?? []);
    const additions = [
      ['break_content_type', 'varchar(32)'],
      ['break_duration_seconds', 'integer'],
      ['break_protection_at', 'datetime'],
      ['break_context', 'text'],
    ] as const;
    for (const [name, definition] of additions) {
      if (!columns.has(name))
        await queryRunner.query(
          `ALTER TABLE "classroom_run" ADD COLUMN "${name}" ${definition}`,
        );
    }
  }

  async down(): Promise<void> {
    // SQLite 删除列需要重建表；生产回滚由备份恢复，避免破坏课堂历史。
  }
}
