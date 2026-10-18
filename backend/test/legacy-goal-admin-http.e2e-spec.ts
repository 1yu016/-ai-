import { jest } from '@jest/globals';
import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { JwtService } from '@nestjs/jwt';
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
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { PlatformAccessService } from '../src/platform/platform-access.service';
import { AuditService } from '../src/platform/audit.service';
import { DataSource, EntityManager, Repository } from 'typeorm';
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







describe('A-11 isolated HTTP revoke commit boundary', () => {
  it.each(['normal', 'revoke-first', 'unauthorized-teacher', 'cross-school-admin',
    'waiting-revoke', 'locked-revoke', 'locked-revoke-rollback', 'delete-failure', 'audit-failure',
    'commit-failure', 'revoke-committed-then-goal-failure', 'missing-relation', 'uncoordinated-active'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'a11-http-goal-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
    let release: (() => void) | undefined;
    let blocker: Promise<unknown> | undefined;
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
        const other = await db.getRepository(Teacher).save({ account: 'other_synthetic_teacher',
          passwordHash: 'not-used-for-login', name: '隔离无权教师', schoolId: 'other-synthetic-school' });
        const otherToken = app.get(JwtService).sign({ sub: other.id, userType: 'teacher', role: 'teacher', tokenVersion: 0 });
        const _otherAuth = { Authorization: `Bearer ${otherToken}` };
      await enterTeachingFixture(app, run.id);




      const passwordHash = await bcrypt.hash('SyntheticAdmin123!', 4);
      const admin = await db.getRepository(Administrator).save({ account: 'a10_admin',
        passwordHash, name: '合成管理员', schoolId: 'isolated-restart' });
      const crossAdmin = await db.getRepository(Administrator).save({ account: 'a10_other_admin',
        passwordHash, name: '合成外园管理员', schoolId: 'different-synthetic-school' });
      const loginAdmin = async (account: string) => {
        const login = await request(app!.getHttpServer()).post('/auth/admin/login')
          .send({ account, password: 'SyntheticAdmin123!' }).expect(200);
        return { Authorization: 'Bearer ' + login.body.access_token };
      };
      const adminAuth = await loginAdmin(admin.account);
      const crossAdminAuth = await loginAdmin(crossAdmin.account);
      const createPath = '/classes/' + cls.id + '/collective-goals';
      const revokePath = '/classes/' + cls.id + '/teachers/' + teacher.id;
      const input = { title: '合成HTTP联动目标', description: '仅隔离数据', targetValue: 20 };
      let createAuth = auth;
      if (scenario === 'revoke-committed-then-goal-failure') {
        const creator = await db.getRepository(Teacher).save({ account: 'a11_goal_creator',
          passwordHash, name: '合成有权创建教师', schoolId: 'isolated-restart', role: 'admin' as any });
        const login = await request(app.getHttpServer()).post('/auth/login')
          .send({ account: creator.account, password: 'SyntheticAdmin123!' }).expect(200);
        createAuth = { Authorization: 'Bearer ' + login.body.access_token };
      }
      await request(app.getHttpServer()).post(createPath).set(auth)
        .send({ ...input, title: '已提交旧目标' }).expect(201);
      const before = await rows(db);
      const calls: { method: string; path: string; response: { status: number; body: unknown } }[] = [];
      const revoke = async (headers = adminAuth) => {
        const r = await request(app!.getHttpServer()).delete(revokePath).set(headers);
        calls.push({ method: 'DELETE', path: revokePath, response: { status: r.status, body: r.body } });
        return r;
      };
      const create = async () => {
        const r = await request(app!.getHttpServer()).post(createPath).set(createAuth).send(input);
        calls.push({ method: 'POST', path: createPath, response: { status: r.status, body: r.body } });
        return r;
      };
      let creation: { status: number; body: unknown } | undefined;
      let during: Awaited<ReturnType<typeof rows>> | undefined;
      let pendingRevoke: ReturnType<typeof revoke> | undefined;
      let revokeFinished = false;
      const watchRevokeAdmission = () => {
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const access = app!.get(PlatformAccessService);
        const original = access.requireClassAccess.bind(access);
        jest.spyOn(access, 'requireClassAccess').mockImplementation(async (...args) => {
          const result = await original(...args);
          if (args[0].userType === 'administrator' && !args[2]) entered();
          return result;
        });
        pendingRevoke = revoke().then(r => { revokeFinished = true; return r; });
        return ready;
      };
      let deleteManager: EntityManager | undefined;
      let auditManager: EntityManager | undefined;
      const transactionDepths: number[] = [];
      if (['delete-failure', 'audit-failure', 'commit-failure'].includes(scenario)) {
        const originalDelete = Repository.prototype.delete;
        jest.spyOn(Repository.prototype, 'delete').mockImplementation(async function(this: Repository<any>, ...args: any[]) {
          const result = await (originalDelete as any).apply(this, args);
          if (this.metadata.target === TeacherClass) {
            deleteManager = this.manager;
            expect(this.manager.queryRunner?.isTransactionActive).toBe(true);
            transactionDepths.push((this.manager.queryRunner as any).transactionDepth);
            if (scenario === 'delete-failure') throw new Error('A11 AFTER actual relation DELETE');
          }
          return result;
        });
        const audit = app.get(AuditService);
        const originalAudit = audit.write.bind(audit);
        jest.spyOn(audit, 'write').mockImplementation(async (...args) => {
          await originalAudit(...args);
          if (args[1].action === 'teacher_class.unbind') {
            auditManager = args[2];
            expect(auditManager).toBe(deleteManager);
            if (scenario === 'audit-failure') throw new Error('A11 AFTER actual revoke audit INSERT');
          }
        });
        if (scenario === 'commit-failure')
          jest.spyOn(db.createQueryRunner(), 'commitTransaction').mockImplementationOnce(async () => {
            throw new Error('A11 BEFORE commit; no HTTP success allowed');
          });
      }
      const snapshots = app.get(ClassroomSnapshotService);
      if (scenario === 'revoke-first') {
        await revoke().then(r => expect(r.status).toBe(204));
        creation = await create();
      } else if (scenario === 'missing-relation') {
        await revoke().then(r => expect(r.status).toBe(204));
        await revoke().then(r => expect(r.status).toBe(404));
      } else if (scenario === 'uncoordinated-active') {
        await db.transaction(async () => {
          await revoke().then(r => expect(r.status).toBe(409));
        });
      } else if (scenario === 'unauthorized-teacher' || scenario === 'cross-school-admin') {
        await revoke(scenario === 'unauthorized-teacher' ? auth : crossAdminAuth).then(r => expect(r.status).toBe(403));
      } else if (['delete-failure', 'audit-failure', 'commit-failure'].includes(scenario)) {
        await revoke().then(r => expect(r.status).toBe(500));
      } else if (scenario === 'revoke-committed-then-goal-failure') {
        await revoke().then(r => expect(r.status).toBe(204));
        const originalQuery = EntityManager.prototype.query;
        jest.spyOn(EntityManager.prototype, 'query').mockImplementation(async function(this: EntityManager, ...args: any[]) {
          const result = await (originalQuery as any).apply(this, args);
          if (String(args[0]).includes('INSERT INTO "collective_goal"'))
            throw new Error('A11 failed goal after already committed revoke');
          return result;
        });
        creation = await create();
      } else if (scenario === 'waiting-revoke') {
        let entered!: () => void;
        const acquired = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        blocker = snapshots.transactionRequired(async () => { entered(); await gate; });
        await acquired;
        // Queue revocation first, then the still-authorized create request.
        await watchRevokeAdmission();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(revokeFinished).toBe(false);
        let queued!: () => void;
        const ready = new Promise<void>(resolve => { queued = resolve; });
        const original = snapshots.transactionRequired.bind(snapshots);
        jest.spyOn(snapshots, 'transactionRequired').mockImplementation(work => {
          const result = original(work); queued(); return result;
        });
        const pending = create();
        await ready;
        release!(); await blocker;
        creation = await pending;
      } else if (scenario.startsWith('locked-revoke')) {
        const originalQuery = EntityManager.prototype.query;
        jest.spyOn(EntityManager.prototype, 'query').mockImplementation(async function(this: EntityManager, ...args: any[]) {
          const result = await (originalQuery as any).apply(this, args);
          if (String(args[0]).includes('INSERT INTO "collective_goal"')) {
            expect(this.queryRunner?.isTransactionActive).toBe(true);
            await watchRevokeAdmission();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(revokeFinished).toBe(false); // Cannot return 204 from this request's transaction.
            during = await rows(db);
            expect(during.find(t => t.table === 'teacher_class')!.count).toBe(1);
            if (scenario === 'locked-revoke-rollback') throw new Error('A11 actual INSERT fails before queued HTTP revoke');
          }
          return result;
        });
        creation = await create();
      } else {
        creation = await create();
      }
      if (pendingRevoke) expect((await pendingRevoke).status).toBe(204);
      jest.restoreAllMocks();
      const after = await rows(db);
      const integrity = await db.query('PRAGMA integrity_check');
      const foreignKeys = await db.query('PRAGMA foreign_key_check');
      await writeFile(join(process.cwd(), '.tmp', 'a11v2-http-goal-' + scenario + '.json'),
        JSON.stringify({ scenario, isolatedDatabase: database, createPath, revokePath, input,
          before, calls, during, after, integrity, foreignKeys,
          transactionDepths, auditUsesDeleteManager: !!auditManager && auditManager === deleteManager,
          note: 'All revoke operations here use the real administrator HTTP route, not direct DELETE SQL.' }, null, 2));
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(foreignKeys).toEqual([]);
      const table = (data: Awaited<ReturnType<typeof rows>>, name: string) => data.find(t => t.table === name)!;
      const beforeGoals = table(before, 'collective_goal');
      const finalGoals = table(after, 'collective_goal');
      const relations = table(after, 'teacher_class');
      const auditBefore = table(before, 'audit_log');
      const auditAfter = table(after, 'audit_log');
      const unbindAudits = auditAfter.data.filter((a: any) => a.action === 'teacher_class.unbind');
      if (scenario === 'unauthorized-teacher' || scenario === 'cross-school-admin') {
        expect(finalGoals).toEqual(beforeGoals);
        expect(relations).toEqual(table(before, 'teacher_class'));
        expect(unbindAudits).toHaveLength(0);
        expect(auditAfter.count).toBeGreaterThan(auditBefore.count); // Legitimate denial audit.
      } else if (['delete-failure', 'audit-failure', 'commit-failure', 'uncoordinated-active'].includes(scenario)) {
        expect(relations).toEqual(table(before, 'teacher_class'));
        expect(finalGoals).toEqual(beforeGoals);
        expect(auditAfter).toEqual(auditBefore);
        expect(transactionDepths).toEqual(scenario === 'uncoordinated-active' ? [] : [1]);
      } else if (scenario === 'missing-relation') {
        expect(finalGoals).toEqual(beforeGoals);
        expect(relations.count).toBe(0);
        expect(unbindAudits).toHaveLength(1);
      } else if (scenario === 'normal') {
        expect(creation!.status).toBe(201);
        expect(finalGoals.count).toBe(2);
        expect(relations.count).toBe(1);
      } else {
        expect(creation!.status).toBe(['locked-revoke-rollback', 'revoke-committed-then-goal-failure'].includes(scenario) ? 500 :
          scenario === 'locked-revoke' ? 201 : 403);
        expect(finalGoals.count).toBe(scenario === 'locked-revoke' ? 2 : 1);
        expect(relations.count).toBe(0); // A real HTTP 204 must not be undone by another request's rollback.
        expect(unbindAudits).toHaveLength(1);
      }
      expect(finalGoals.data[0]).toEqual(beforeGoals.data[0]); // Legacy goal creation never archives prior configuration.
      for (const name of tables.filter(t => !['collective_goal', 'teacher_class', 'audit_log'].includes(t)))
        expect(table(after, name)).toEqual(table(before, name));
    } finally {
      release?.();
      await blocker;
      jest.restoreAllMocks();
      await app?.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

