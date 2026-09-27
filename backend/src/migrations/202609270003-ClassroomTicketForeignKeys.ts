import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

export class ClassroomTicketForeignKeys2026092700003 implements MigrationInterface {
  name = 'ClassroomTicketForeignKeys2026092700003';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('classroom_ticket');
    if (!table) return;

    const definitions = [
      {
        name: 'FK_classroom_ticket_class',
        column: 'class_id',
        referencedTable: 'class',
      },
      {
        name: 'FK_classroom_ticket_device',
        column: 'device_id',
        referencedTable: 'device',
      },
      {
        name: 'FK_classroom_ticket_classroom',
        column: 'classroom_id',
        referencedTable: 'classroom',
      },
    ];

    for (const definition of definitions) {
      const current = await queryRunner.getTable('classroom_ticket');
      const exists = current?.foreignKeys.some(
        (foreignKey) =>
          foreignKey.columnNames.length === 1 &&
          foreignKey.columnNames[0] === definition.column &&
          foreignKey.referencedTableName === definition.referencedTable,
      );
      if (!exists) {
        await queryRunner.createForeignKey(
          'classroom_ticket',
          new TableForeignKey({
            name: definition.name,
            columnNames: [definition.column],
            referencedTableName: definition.referencedTable,
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          }),
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('classroom_ticket');
    if (!table) return;
    for (const foreignKey of table.foreignKeys.filter((candidate) =>
      candidate.name?.startsWith('FK_classroom_ticket_'),
    )) {
      await queryRunner.dropForeignKey('classroom_ticket', foreignKey);
    }
  }
}
