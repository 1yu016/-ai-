import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ResourceUploadSessionMetadata2026101100025
  implements MigrationInterface
{
  name = 'ResourceUploadSessionMetadata2026101100025';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('upload_session'))) return;
    for (const column of [
      new TableColumn({ name: 'aliases', type: 'text', default: "'[]'" }),
      new TableColumn({ name: 'description', type: 'text', isNullable: true }),
      new TableColumn({
        name: 'category_id',
        type: 'integer',
        isNullable: true,
      }),
      new TableColumn({
        name: 'domain',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
      new TableColumn({ name: 'tags', type: 'text', default: "'[]'" }),
      new TableColumn({ name: 'duration', type: 'real', isNullable: true }),
    ]) {
      if (!(await queryRunner.hasColumn('upload_session', column.name)))
        await queryRunner.addColumn('upload_session', column);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('upload_session'))) return;
    for (const column of [
      'duration',
      'tags',
      'domain',
      'category_id',
      'description',
      'aliases',
    ]) {
      if (await queryRunner.hasColumn('upload_session', column))
        await queryRunner.dropColumn('upload_session', column);
    }
  }
}
