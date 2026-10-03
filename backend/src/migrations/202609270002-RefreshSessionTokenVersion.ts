import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class RefreshSessionTokenVersion2026092700002 implements MigrationInterface {
  name = 'RefreshSessionTokenVersion2026092700002';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('refresh_token_session')) &&
      !(await queryRunner.hasColumn('refresh_token_session', 'token_version'))
    ) {
      await queryRunner.addColumn(
        'refresh_token_session',
        new TableColumn({ name: 'token_version', type: 'integer', default: 0 }),
      );
    }
  }

  async down(): Promise<void> {
    // SQLite 删除列需要重建表；保留兼容列，避免破坏已存在的登录会话数据。
  }
}
