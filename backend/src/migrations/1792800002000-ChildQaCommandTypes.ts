import { MigrationInterface, QueryRunner } from 'typeorm';
export class ChildQaCommandTypes1792800002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('classroom_operation_record');
    const previous = table?.findColumnByName('operation');
    if (!previous) throw new Error('Classroom command operation schema not found');
    // Historical migrations and synchronize-created SQLite databases both use
    // an unconstrained varchar here. It already accepts the new command names.
    if (!previous.enum?.length) return;
    const additions = ['child_qa_start', 'child_qa_stop', 'child_qa_approve', 'child_qa_reject'];
    if (additions.every((value) => previous.enum!.includes(value))) return;
    const next = previous.clone();
    next.enum = [...new Set([...previous.enum, ...additions])];
    await queryRunner.changeColumn('classroom_operation_record', previous, next);
  }
  async down(): Promise<void> { throw new Error('Preserve formal command receipts; review before downgrade.'); }
}
