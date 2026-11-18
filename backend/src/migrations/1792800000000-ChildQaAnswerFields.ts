import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
export class ChildQaAnswerFields1792800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('student_question_record'))) return;
    for (const column of [
      new TableColumn({ name: 'answer_text', type: 'text', isNullable: true }),
      new TableColumn({ name: 'answer_status', type: 'varchar', length: '30', isNullable: true }),
      new TableColumn({ name: 'answer_source', type: 'varchar', length: '100', isNullable: true }),
      new TableColumn({ name: 'qa_session_id', type: 'varchar', length: '100', isNullable: true }),
    ]) {
      if (!(await queryRunner.hasColumn('student_question_record', column.name)))
        await queryRunner.addColumn('student_question_record', column);
    }
  }
  async down(): Promise<void> { throw new Error('Preserve recorded answers; destructive downgrade requires explicit review.'); }
}
