import { MigrationInterface, QueryRunner } from 'typeorm';

/** Add the indexed lookups declared by StudentQuestionRecord without touching records. */
export class StudentQuestionIndexes2026101200031 implements MigrationInterface {
  name = 'StudentQuestionIndexes2026101200031';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('student_question_record')))
      throw new Error('Student question record schema not found');
    for (const [name, column] of [
      ['IDX_student_question_student', 'student_id'],
      ['IDX_student_question_class', 'class_id'],
      ['IDX_student_question_teacher', 'teacher_id'],
    ])
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "${name}" ON "student_question_record" ("${column}")`);
  }

  async down(): Promise<void> {
    throw new Error('Question lookup indexes are retained to preserve deployed schema compatibility.');
  }
}
