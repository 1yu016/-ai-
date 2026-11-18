import { MigrationInterface, QueryRunner } from 'typeorm';

/** Align answer field lengths for databases where the earlier varchar columns were unbounded. */
export class ChildQaAnswerColumnLengths2026101200030 implements MigrationInterface {
  name = 'ChildQaAnswerColumnLengths2026101200030';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('student_question_record');
    if (!table) throw new Error('Student question record schema not found');
    for (const [name, length] of [['answer_status', '30'], ['answer_source', '100'], ['qa_session_id', '100']]) {
      const previous = table.findColumnByName(name);
      if (!previous) throw new Error(`Student question answer field ${name} is missing`);
      if (previous.type.toLowerCase() === 'varchar' && previous.length === length) continue;
      const next = previous.clone();
      next.type = 'varchar';
      next.length = length;
      await queryRunner.changeColumn('student_question_record', previous, next);
    }
  }

  async down(): Promise<void> {
    throw new Error('Review answer field data before downgrading the question schema.');
  }
}
