import { jest } from '@jest/globals';
import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { writeTestEvidence as writeFile } from './helpers/test-evidence';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PlatformAccessService } from '../src/platform/platform-access.service';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { AuditLog } from '../src/platform/entities/audit-log.entity';
import * as bcrypt from 'bcrypt';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { ClassroomEngagementModule } from '../src/classroom-engagement/classroom-engagement.module';
import { CLASSROOM_ENGAGEMENT_ENTITIES } from '../src/classroom-engagement/entities';
import { ClassroomParticipationModule } from '../src/classroom-participation/classroom-participation.module';
import { CLASSROOM_PARTICIPATION_ENTITIES } from '../src/classroom-participation/entities';
import { ClassroomRunModule, CLASSROOM_RUN_ENTITIES } from '../src/classroom-runs/classroom-run.module';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { LessonPlanModule, LESSON_PLAN_ENTITIES } from '../src/lesson-plans/lesson-plan.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonAgeGroup, LessonPlanStatus } from '../src/lesson-plans/lesson-plan.types';
import { PlatformModule, PLATFORM_ENTITIES } from '../src/platform/platform.module';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { Device } from '../src/platform/entities/device.entity';
import { DeviceStatus, DeviceType, RecordStatus, TeacherClassRole } from '../src/platform/platform.types';
import { ResourceModule, RESOURCE_ENTITIES } from '../src/resources/resource.module';

const tables = [
  'attendance_record', 'attendance_change_log', 'roll_call_record', 'roll_call_candidate_snapshot',
  'reward_record', 'reward_reversal', 'student_badge', 'class_growth_record', 'honor_record',
  'student_reward_record', 'class_collective_reward_record', 'student_attendance_record',
  'student_attendance_change', 'classroom_roll_call_record', 'classroom_event', 'classroom_snapshot',
  'classroom_run', 'collective_goal', 'class_growth_goal', 'teacher_class', 'audit_log',
];

async function rows(db: DataSource) {
  return Promise.all(tables.map(async table => {
    const data = await db.query(`SELECT * FROM "${table}" ORDER BY id`);
    return { table, count: data.length, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data };
  }));
}

async function openTestApplication(database: string, initializeSchema: boolean) {
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({
      JWT_ACCESS_SECRET: 'legacy-restart-isolated-secret-long-enough', JWT_ACCESS_EXPIRES_IN: '2h',
      JWT_REFRESH_EXPIRES_IN: '30d', TEST_TEACHER_ACCOUNT: 'legacy_restart_teacher',
      TEST_TEACHER_PASSWORD: 'Teacher123!', TEST_TEACHER_NAME: '隔离验收教师',
      ARK_API_KEY: 'isolated-no-model-key', ARK_ENDPOINT_ID: 'isolated-no-model',
      CLASSROOM_SUMMARY_AI_ENABLED: 'false',
    })] }),
    TypeOrmModule.forRoot({ type: 'better-sqlite3', database, synchronize: initializeSchema,
      migrationsRun: false,
      entities: [Teacher, Administrator, RefreshTokenSession, TeachingResource, ...PLATFORM_ENTITIES,
        ...RESOURCE_ENTITIES, ...LESSON_PLAN_ENTITIES, ...CLASSROOM_RUN_ENTITIES, ...AVATAR_ENTITIES,
        ...CLASSROOM_PARTICIPATION_ENTITIES, ...CLASSROOM_ENGAGEMENT_ENTITIES] }),
    AuthModule, PlatformModule, ResourceModule, LessonPlanModule, ClassroomRunModule,
    ClassroomParticipationModule, ClassroomEngagementModule,
  ] }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}








describe('A-14 bindTeacher isolated commit and audit', () => {
  it.each(['normal', 'audit-insert-failure', 'cross-request-rollback', 'role-update',
    'role-audit-failure', 'commit-failure', 'unauthorized-teacher', 'cross-school-admin',
    'target-cross-school', 'bind-first-unbind', 'unbind-first-bind', 'bind-first-goal-failure',
    'uncoordinated-active'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'a14-bind-http-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
    try {
      app = await openTestApplication(database, true);
      const db = app.get(DataSource);
      expect(db.options.database).toBe(database);
      const teacher = await db.getRepository(Teacher).findOneByOrFail({ account: 'legacy_restart_teacher' });
      await db.getRepository(Teacher).update(teacher.id, { schoolId: 'isolated-restart' });
      const cls = await db.getRepository(SchoolClass).save({ schoolId: 'isolated-restart', name: '隔离班',
        grade: '小班', ageRange: '3-4', schoolYear: '2026', status: RecordStatus.Active });
      await db.getRepository(TeacherClass).save({ teacherId: teacher.id, classId: cls.id, role: TeacherClassRole.Lead });
      const _students = await db.getRepository(Student).save([
        { classId: cls.id, studentNo: 'ISOLATED-1', name: '隔离一', status: RecordStatus.Active },
        { classId: cls.id, studentNo: 'ISOLATED-2', name: '隔离二', status: RecordStatus.Active },
      ]);
      const classroom = await db.getRepository(Classroom).save({ schoolId: 'isolated-restart', name: '隔离教室', status: RecordStatus.Active });
      const device = await db.getRepository(Device).save({ deviceCode: 'ISOLATED-RECEIPT-SCREEN', schoolId: 'isolated-restart',
        name: '隔离大屏', type: DeviceType.ClassroomScreen, status: DeviceStatus.Offline });
      const plan = await db.getRepository(LessonPlan).save({ teacherId: teacher.id, schoolId: 'isolated-restart',
        title: '隔离持久回执', theme: '事务验收', ageGroup: LessonAgeGroup.ThreeToFour,
        objectives: '只测试，不调用AI', estimatedMinutes: 10, status: LessonPlanStatus.Draft, version: 1 });
      // Isolated fixture only. Classroom lifecycle APIs are regression-tested elsewhere.
      const run = await db.getRepository(ClassroomRun).save({ lessonPlanId: plan.id, lessonPlanVersion: 1,
        teacherId: teacher.id, classId: cls.id, classroomId: classroom.id, deviceId: device.id,
        title: plan.title, status: ClassroomRunStatus.Running, startedAt: new Date(), currentStepIndex: 0, version: 1 });

        const token = (await request(app.getHttpServer()).post('/auth/login')
          .send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token;
        const auth = { Authorization: `Bearer ${token}` };
      await enterTeachingFixture(app, run.id);





      const passwordHash = await bcrypt.hash('SyntheticAdmin123!', 4);
      const admin = await db.getRepository(Administrator).save({ account: 'a13_admin',
        passwordHash, name: '合成绑定管理员', schoolId: 'isolated-restart' });
      const target = await db.getRepository(Teacher).save({ account: 'a13_target_teacher',
        passwordHash, name: '合成待绑定教师', schoolId: 'isolated-restart' });
      const login = await request(app.getHttpServer()).post('/auth/admin/login')
        .send({ account: admin.account, password: 'SyntheticAdmin123!' }).expect(200);
      const adminAuth = { Authorization: 'Bearer ' + login.body.access_token };
      const bindPath = '/classes/' + cls.id + '/teachers';
      const bindBody = { teacherId: target.id, role: scenario.startsWith('role-') ? 'lead' : 'assistant' };
      const goalPath = '/classes/' + cls.id + '/collective-goals';
      const goalBody = { title: '合成被回滚目标', targetValue: 20 };
      await request(app.getHttpServer()).post(goalPath).set(auth)
        .send({ title: '原有目标保持不变', targetValue: 20 }).expect(201);
      if (scenario.startsWith('role-') || scenario === 'unbind-first-bind')
        await request(app.getHttpServer()).post(bindPath).set(adminAuth)
          .send({ teacherId: target.id, role: 'assistant' }).expect(201);
      if (scenario === 'target-cross-school')
        await db.getRepository(Teacher).update(target.id, { schoolId: 'different-synthetic-school' });
      let chosenAuth = scenario === 'unauthorized-teacher' ? auth : adminAuth;
      if (scenario === 'cross-school-admin') {
        const outsider = await db.getRepository(Administrator).save({ account: 'a14_other_admin',
          passwordHash, name: '合成外园管理员', schoolId: 'different-synthetic-school' });
        const otherLogin = await request(app.getHttpServer()).post('/auth/admin/login')
          .send({ account: outsider.account, password: 'SyntheticAdmin123!' }).expect(200);
        chosenAuth = { Authorization: 'Bearer ' + otherLogin.body.access_token };
      }
      const before = await rows(db);
      const transactions: { stage: string; sql: string; active: boolean; depth: number }[] = [];
      const runner = db.createQueryRunner();
      const originalSql = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (...args: any[]) => {
        const sql = String(args[0]).replace(/\s+/g, ' ').trim();
        const relevant = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(sql) ||
          /INSERT INTO "(teacher_class|audit_log|collective_goal)"/i.test(sql);
        const event = (stage: string) => transactions.push({ stage, sql,
          active: runner.isTransactionActive, depth: (runner as any).transactionDepth });
        if (relevant) event('before');
        if (['audit-insert-failure', 'role-audit-failure'].includes(scenario) && sql.includes('INSERT INTO "audit_log"') &&
            (args[1] as unknown[] | undefined)?.includes('teacher_class.bind')) {
          event('injected-failure-before-audit-sql');
          throw new Error('A13 actual bind audit INSERT dispatch failed');
        }
        const result = await (originalSql as any)(...args);
        if (relevant) event('after');
        return result;
      });
      let binding: { status: number; body: any } | undefined;
      let goal: { status: number; body: any } | undefined;
      let during: Awaited<ReturnType<typeof rows>> | undefined;
      let transactionActiveAtBindingResponse: boolean | undefined;
      let bindingFinished = false;
      let pendingBinding: Promise<{ status: number; body: any }> | undefined;
      let unbinding: { status: number; body: any } | undefined;
      const writeManagers: EntityManager[] = [];
      const originalSave = Repository.prototype.save;
      jest.spyOn(Repository.prototype, 'save').mockImplementation(async function(this: Repository<any>, ...args: any[]) {
        if (this.metadata.target === TeacherClass && args[0].teacherId === target.id) {
          expect(this.manager.queryRunner?.isTransactionActive).toBe(true);
          expect((this.manager.queryRunner as any).transactionDepth).toBe(1);
          writeManagers.push(this.manager);
        }
        if (this.metadata.target === AuditLog && args[0].action === 'teacher_class.bind')
          expect(this.manager).toBe(writeManagers.at(-1)); // Audit actually uses the supplied manager's repository.
        return (originalSave as any).apply(this, args);
      });
      const bind = async () => {
        const response = await request(app!.getHttpServer()).post(bindPath).set(chosenAuth).send(bindBody);
        transactionActiveAtBindingResponse = runner.isTransactionActive;
        bindingFinished = true;
        return { status: response.status, body: response.body };
      };
      if (scenario === 'commit-failure')
        jest.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
          throw new Error('A14 BEFORE bind commit');
        });
      const revoke = async () => {
        const response = await request(app!.getHttpServer())
          .delete('/classes/' + cls.id + '/teachers/' + target.id).set(adminAuth);
        return { status: response.status, body: response.body };
      };
      if (scenario === 'cross-request-rollback') {
        const originalQuery = EntityManager.prototype.query;
        jest.spyOn(EntityManager.prototype, 'query').mockImplementation(async function(this: EntityManager, ...args: any[]) {
          const result = await (originalQuery as any).apply(this, args);
          if (String(args[0]).includes('INSERT INTO "collective_goal"')) {
            expect(this.queryRunner).toBe(runner);
            expect(runner.isTransactionActive).toBe(true);
            let admitted!: () => void;
            const ready = new Promise<void>(resolve => { admitted = resolve; });
            const access = app!.get(PlatformAccessService);
            const originalAccess = access.requireClassAccess.bind(access);
            jest.spyOn(access, 'requireClassAccess').mockImplementation(async (...parameters) => {
              const checked = await originalAccess(...parameters);
              if (parameters[0].userType === 'administrator' && !parameters[2]) admitted();
              return checked;
            });
            pendingBinding = bind();
            await ready;
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(bindingFinished).toBe(false); // No successful response from the other request's transaction.
            during = await rows(db);
            expect(during.find(t => t.table === 'teacher_class')!.data.some((r: any) => r.teacher_id === target.id)).toBe(false);
            throw new Error('A14 rollback goal before queued bind can execute');
          }
          return result;
        });
        const response = await request(app.getHttpServer()).post(goalPath).set(auth).send(goalBody);
        goal = { status: response.status, body: response.body };
        binding = await pendingBinding!;
      } else if (scenario === 'bind-first-goal-failure') {
        binding = await bind();
        const originalQuery = EntityManager.prototype.query;
        jest.spyOn(EntityManager.prototype, 'query').mockImplementation(async function(this: EntityManager, ...args: any[]) {
          const result = await (originalQuery as any).apply(this, args);
          if (String(args[0]).includes('INSERT INTO "collective_goal"')) throw new Error('A14 unrelated goal rollback after committed binding');
          return result;
        });
        const response = await request(app.getHttpServer()).post(goalPath).set(auth).send(goalBody);
        goal = { status: response.status, body: response.body };
      } else if (scenario === 'uncoordinated-active') {
        await db.transaction(async () => { binding = await bind(); });
      } else if (scenario === 'bind-first-unbind' || scenario === 'unbind-first-bind') {
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        const blocker = app.get(ClassroomSnapshotService).transactionRequired(async () => { entered(); await gate; });
        await started;
        const admitted: (() => void)[] = [];
        const admissions = [0, 1].map(i => new Promise<void>(resolve => { admitted[i] = resolve; }));
        let _admissionIndex = 0;
        const access = app.get(PlatformAccessService);
        const originalAccess = access.requireClassAccess.bind(access);
        jest.spyOn(access, 'requireClassAccess').mockImplementation(async (...parameters) => {
          const result = await originalAccess(...parameters);
          if (parameters[0].userType === 'administrator' && !parameters[2]) admitted[_admissionIndex++]?.();
          return result;
        });
        let first: ReturnType<typeof bind>;
        let second: ReturnType<typeof bind>;
        try {
          first = scenario === 'bind-first-unbind' ? bind() : revoke();
          await admissions[0]; await new Promise<void>(resolve => setImmediate(resolve));
          second = scenario === 'bind-first-unbind' ? revoke() : bind();
          await admissions[1]; await new Promise<void>(resolve => setImmediate(resolve));
        } finally { release(); }
        await blocker;
        const one = await first!; const two = await second!;
        binding = scenario === 'bind-first-unbind' ? one : two;
        unbinding = scenario === 'bind-first-unbind' ? two : one;
        expect(unbinding.status).toBe(204);
      } else {
        binding = await bind();
      }
      jest.restoreAllMocks();
      const after = await rows(db);
      const integrity = await db.query('PRAGMA integrity_check');
      const foreignKeys = await db.query('PRAGMA foreign_key_check');
      await writeFile(join(process.cwd(), '.tmp', 'a14-bind-http-' + scenario + '.json'),
        JSON.stringify({ scenario, isolatedDatabase: database,
          bindingRequest: { method: 'POST', path: bindPath, body: bindBody }, binding,
          goalRequest: scenario === 'cross-request-rollback' ? { method: 'POST', path: goalPath, body: goalBody } : null,
          goal, unbinding, before, during, after, transactions, transactionActiveAtBindingResponse,
          bindingUsesTransactionManager: writeManagers.length > 0, integrity, foreignKeys }, null, 2));
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(foreignKeys).toEqual([]);
      const targetRelations = after.find(t => t.table === 'teacher_class')!.data
        .filter((r: any) => r.teacher_id === target.id && r.class_id === cls.id);
      const bindAudits = after.find(t => t.table === 'audit_log')!.data
        .filter((r: any) => r.action === 'teacher_class.bind' &&
          !before.find(t => t.table === 'audit_log')!.data.some((old: any) => old.id === r.id));
      expect(after.find(t => t.table === 'collective_goal')).toEqual(before.find(t => t.table === 'collective_goal'));
      if (['audit-insert-failure', 'role-audit-failure', 'commit-failure'].includes(scenario)) {
        expect(binding!.status).toBe(500);
        expect(bindAudits).toHaveLength(0);
        expect(after.find(t => t.table === 'teacher_class')).toEqual(before.find(t => t.table === 'teacher_class'));
      } else if (['unauthorized-teacher', 'cross-school-admin', 'target-cross-school', 'uncoordinated-active'].includes(scenario)) {
        expect(binding!.status).toBe(['target-cross-school', 'uncoordinated-active'].includes(scenario) ? 409 : 403);
        expect(targetRelations).toHaveLength(0);
        expect(bindAudits).toHaveLength(0);
      } else {
        expect(binding!.status).toBe(201);
        if (goal) expect(goal.status).toBe(500);
        expect(targetRelations).toHaveLength(scenario === 'bind-first-unbind' ? 0 : 1);
        expect(bindAudits).toHaveLength(1);
        if (scenario === 'role-update') {
          expect(targetRelations[0].role).toBe('lead');
          expect(targetRelations[0].id).toBe(before.find(t => t.table === 'teacher_class')!.data.find((r: any) => r.teacher_id === target.id).id);
        }
      }
    } finally {
      jest.restoreAllMocks();
      await app?.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

