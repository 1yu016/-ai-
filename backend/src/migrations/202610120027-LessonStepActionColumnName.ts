import { MigrationInterface, QueryRunner } from 'typeorm';

/** Normalize migration-created snake-case schema to the existing entity column name. */
export class LessonStepActionColumnName2026101200027 implements MigrationInterface {
  name = 'LessonStepActionColumnName2026101200027';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('lesson_step_action');
    if (!table) return;
    const migrationColumn = table.findColumnByName('action_type');
    const entityColumn = table.findColumnByName('actionType');
    if (migrationColumn && !entityColumn)
      await queryRunner.renameColumn('lesson_step_action', migrationColumn, 'actionType');
    else if (migrationColumn && entityColumn) {
      const conflicts = await queryRunner.query('SELECT id FROM "lesson_step_action" WHERE "action_type" IS NOT NULL AND "actionType" IS NOT NULL AND "action_type" <> "actionType" LIMIT 1') as unknown[];
      if (conflicts.length) throw new Error('Conflicting lesson step action columns; review values before migration.');
      await queryRunner.query('UPDATE "lesson_step_action" SET "actionType" = "action_type" WHERE "action_type" IS NOT NULL AND "actionType" IS NULL');
    }
  }

  async down(): Promise<void> {
    throw new Error('Review lesson-step actions before reverting the column-name compatibility migration.');
  }
}
