import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class StageOnePlatformFoundation2026092700001 implements MigrationInterface {
  name = 'StageOnePlatformFoundation2026092700001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "teachers" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "account" varchar(64) NOT NULL UNIQUE,
      "password_hash" varchar(255) NOT NULL, "name" varchar(100) NOT NULL,
      "role" varchar CHECK("role" IN ('teacher','admin')) NOT NULL DEFAULT ('teacher'),
      "status" varchar CHECK("status" IN ('active','disabled')) NOT NULL DEFAULT ('active'),
      "token_version" integer NOT NULL DEFAULT (0), "school_id" varchar(64), "last_login_at" datetime,
      "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await this.addTeacherColumn(
      queryRunner,
      new TableColumn({ name: 'status', type: 'varchar', default: "'active'" }),
    );
    await this.addTeacherColumn(
      queryRunner,
      new TableColumn({ name: 'token_version', type: 'integer', default: 0 }),
    );
    await this.addTeacherColumn(
      queryRunner,
      new TableColumn({
        name: 'school_id',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
    );
    await this.addTeacherColumn(
      queryRunner,
      new TableColumn({
        name: 'last_login_at',
        type: 'datetime',
        isNullable: true,
      }),
    );
    await this.addTeacherColumn(
      queryRunner,
      new TableColumn({
        name: 'updated_at',
        type: 'datetime',
        default: "(datetime('now'))",
      }),
    );

    const statements = [
      `CREATE TABLE IF NOT EXISTS "administrator" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "account" varchar(64) NOT NULL UNIQUE, "password_hash" varchar(255) NOT NULL, "name" varchar(100) NOT NULL, "status" varchar NOT NULL DEFAULT ('active'), "token_version" integer NOT NULL DEFAULT (0), "school_id" varchar(64), "last_login_at" datetime, "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "refresh_token_session" ("id" varchar(36) PRIMARY KEY NOT NULL, "user_type" varchar NOT NULL, "user_id" integer NOT NULL, "token_version" integer NOT NULL DEFAULT (0), "token_hash" varchar(64) NOT NULL UNIQUE, "expires_at" datetime NOT NULL, "revoked_at" datetime, "replaced_by_session_id" varchar(36), "device_info" varchar(255), "ip_address" varchar(64), "created_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "class" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "school_id" varchar(64), "name" varchar(100) NOT NULL, "grade" varchar(50), "age_range" varchar(50), "school_year" varchar(20) NOT NULL, "status" varchar NOT NULL DEFAULT ('active'), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("school_id","name","school_year"))`,
      `CREATE TABLE IF NOT EXISTS "teacher_class" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "teacher_id" integer NOT NULL, "class_id" integer NOT NULL, "role" varchar NOT NULL DEFAULT ('assistant'), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("teacher_id","class_id"), FOREIGN KEY("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE, FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "student" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "class_id" integer NOT NULL, "student_no" varchar(64) NOT NULL, "name" varchar(100) NOT NULL, "nickname" varchar(100), "gender" varchar(20), "birthday" date, "status" varchar NOT NULL DEFAULT ('active'), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("class_id","student_no"), FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS "classroom" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "school_id" varchar(64), "name" varchar(100) NOT NULL, "location" varchar(255), "status" varchar NOT NULL DEFAULT ('active'), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("school_id","name"))`,
      `CREATE TABLE IF NOT EXISTS "device" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "device_code" varchar(100) NOT NULL UNIQUE, "school_id" varchar(64), "name" varchar(100) NOT NULL, "type" varchar NOT NULL DEFAULT ('classroom_screen'), "status" varchar NOT NULL DEFAULT ('offline'), "last_online_at" datetime, "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "device_binding" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "device_id" integer NOT NULL, "classroom_id" integer NOT NULL, "class_id" integer NOT NULL, "bound_by_type" varchar NOT NULL, "bound_by" integer NOT NULL, "bound_at" datetime NOT NULL, "unbound_at" datetime, "status" varchar NOT NULL DEFAULT ('active'), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), FOREIGN KEY("device_id") REFERENCES "device"("id") ON DELETE RESTRICT, FOREIGN KEY("classroom_id") REFERENCES "classroom"("id") ON DELETE RESTRICT, FOREIGN KEY("class_id") REFERENCES "class"("id") ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS "classroom_ticket" ("id" varchar(36) PRIMARY KEY NOT NULL, "ticket_hash" varchar(64) NOT NULL UNIQUE, "class_id" integer NOT NULL, "device_id" integer NOT NULL, "classroom_id" integer NOT NULL, "lesson_run_id" integer, "expires_at" datetime NOT NULL, "used_at" datetime, "is_used" boolean NOT NULL DEFAULT (0), "created_by" integer NOT NULL, "created_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "guardian_consent" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "student_id" integer NOT NULL, "consent_type" varchar NOT NULL, "status" varchar NOT NULL DEFAULT ('pending'), "consented_at" datetime, "revoked_at" datetime, "note" varchar(500), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), UNIQUE("student_id","consent_type"), FOREIGN KEY("student_id") REFERENCES "student"("id") ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "audit_log" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "actor_type" varchar NOT NULL, "actor_id" integer NOT NULL, "action" varchar(100) NOT NULL, "target_type" varchar(100), "target_id" varchar(100), "result" varchar NOT NULL DEFAULT ('success'), "ip_address" varchar(64), "metadata" text, "created_at" datetime NOT NULL DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS "ai_call_log" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "actor_type" varchar, "actor_id" integer, "feature" varchar(100) NOT NULL, "provider" varchar(100), "model" varchar(100), "request_id" varchar(100), "status" varchar(30) NOT NULL, "latency_ms" integer, "error_code" varchar(100), "metadata" text, "created_at" datetime NOT NULL DEFAULT (datetime('now')))`,
    ];
    for (const statement of statements) await queryRunner.query(statement);

    const indexes = [
      `CREATE INDEX IF NOT EXISTS "IDX_teacher_school" ON "teachers" ("school_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_user" ON "refresh_token_session" ("user_type","user_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_teacher_class_teacher" ON "teacher_class" ("teacher_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_teacher_class_class" ON "teacher_class" ("class_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_student_class" ON "student" ("class_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_device_school" ON "device" ("school_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_device_binding_active" ON "device_binding" ("device_id","status")`,
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_device" ON "classroom_ticket" ("device_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_class" ON "classroom_ticket" ("class_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_consent_student" ON "guardian_consent" ("student_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_audit_actor" ON "audit_log" ("actor_type","actor_id")`,
      `CREATE INDEX IF NOT EXISTS "IDX_audit_action" ON "audit_log" ("action")`,
      `CREATE INDEX IF NOT EXISTS "IDX_ai_call_actor" ON "ai_call_log" ("actor_type","actor_id")`,
    ];
    for (const statement of indexes) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'ai_call_log',
      'audit_log',
      'guardian_consent',
      'classroom_ticket',
      'device_binding',
      'device',
      'classroom',
      'student',
      'teacher_class',
      'class',
      'refresh_token_session',
      'administrator',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    // SQLite 删除列需要重建 teachers 表；为避免破坏旧数据，回滚时保留新增兼容列。
  }

  private async addTeacherColumn(
    queryRunner: QueryRunner,
    column: TableColumn,
  ): Promise<void> {
    if (
      (await queryRunner.hasTable('teachers')) &&
      !(await queryRunner.hasColumn('teachers', column.name))
    ) {
      await queryRunner.addColumn('teachers', column);
    }
  }
}
