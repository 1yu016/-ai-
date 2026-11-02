import { MigrationInterface, QueryRunner } from 'typeorm';
export class ChildQaLessonConfig1792800001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('lesson_step_action');
    const previous = table?.findColumnByName('action_type') ?? table?.findColumnByName('actionType');
    if (!previous) throw new Error('Lesson step action schema not found');
    const knownValues = previous.enum?.length
      ? previous.enum
      : ['avatar_action', 'voice_instruction', 'reward', 'roll_call'];
    if (knownValues.includes('child_qa')) return;
    const next = previous.clone();
    next.enum = [...new Set([...knownValues, 'child_qa'])];
    await queryRunner.changeColumn('lesson_step_action', previous, next);
  }
  async down(): Promise<void> { throw new Error('Review stored lesson configuration before downgrade.'); }
}
