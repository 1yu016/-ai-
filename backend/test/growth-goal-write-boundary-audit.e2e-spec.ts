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
import { PlatformAccessService } from '../src/platform/platform-access.service';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { DataSource } from 'typeorm';
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
  'classroom_run', 'collective_goal', 'class_growth_goal',
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





describe('A-08 goal write boundary audit', () => {
  it.each(['legacy-normal', 'legacy-after-complete', 'legacy-unauthorized',
    'legacy-access-race', 'legacy-concurrent', 'canonical-concurrent'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'a08-goal-audit-'));
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
        const other = await db.getRepository(Teacher).save({ account: 'other_synthetic_teacher',
          passwordHash: 'not-used-for-login', name: '隔离无权教师', schoolId: 'other-synthetic-school' });
        const otherToken = app.get(JwtService).sign({ sub: other.id, userType: 'teacher', role: 'teacher', tokenVersion: 0 });
        const otherAuth = { Authorization: `Bearer ${otherToken}` };
      await enterTeachingFixture(app, run.id);


      const legacyPath = '/classes/' + cls.id + '/collective-goals';
      const canonicalPath = '/classroom-runs/' + run.id + '/growth-goals';
      const input = { title: '合成独立班级目标', description: '审查测试', targetValue: 20 };
      const before = await rows(db);
      let terminalBaseline = before;
      if (scenario === 'legacy-after-complete') {
        const complete = await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/complete')
          .set(auth).send({ requestId: 'a08-complete', deviceId: device.id, version: 1 });
        expect(complete.status).toBe(201);
        terminalBaseline = await rows(db);
      }
      if (scenario === 'legacy-access-race') {
        const access = app.get(PlatformAccessService);
        const original = access.requireClassAccess.bind(access);
        jest.spyOn(access, 'requireClassAccess').mockImplementation(async (...args) => {
          const result = await original(...args); // Real original successful authorization.
          // Test-only revocation committed after successful check, before createGoal's save.
          await db.getRepository(TeacherClass).delete({ teacherId: teacher.id, classId: cls.id });
          return result;
        });
      }
      let responses;
      if (scenario === 'canonical-concurrent') {
        responses = await Promise.all(['first', 'second'].map(id => request(app!.getHttpServer())
          .post(canonicalPath).set(auth).send({ title: '合成目标-' + id,
            targetPoints: 20, requestId: 'a08-concurrent-' + id })));
      } else if (scenario === 'legacy-concurrent') {
        responses = await Promise.all(['first', 'second'].map(id => request(app!.getHttpServer())
          .post(legacyPath).set(auth).send({ ...input, title: input.title + id })));
      } else {
        responses = [await request(app.getHttpServer()).post(legacyPath)
          .set(scenario === 'legacy-unauthorized' ? otherAuth : auth).send(input)];
      }
      jest.restoreAllMocks();
      const after = await rows(db);
      const classRelations = await db.getRepository(TeacherClass).find();
      const integrity = await db.query('PRAGMA integrity_check');
      const foreignKeys = await db.query('PRAGMA foreign_key_check');
      await writeFile(join(process.cwd(), '.tmp', 'a08-goal-' + scenario + '.json'),
        JSON.stringify({ scenario, isolatedDatabase: database, input, before, terminalBaseline, after,
          responses: responses.map(r => ({ status: r.status, body: r.body })),
          classRelations, integrity, foreignKeys,
          note: 'legacy goal is independent class configuration; multiple active configs are not assumed invalid',
        }, null, 2));
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(foreignKeys).toEqual([]);
      if (scenario === 'legacy-access-race') {
        expect(classRelations).toHaveLength(0);
        expect(responses[0].status).toBe(403); // Preserve the acceptance failure if authorization is bypassed.
        expect(after).toEqual(before);
      } else if (scenario === 'legacy-unauthorized') {
        expect(responses[0].status).toBe(403);
        expect(after).toEqual(before); // Business tables only; denial audit is intentionally permitted.
      } else {
        expect(responses.every(r => r.status === 201)).toBe(true);
        const table = scenario === 'canonical-concurrent' ? 'class_growth_goal' : 'collective_goal';
        const goals = after.find(t => t.table === table)!;
        expect(goals.count).toBe(scenario.endsWith('-concurrent') ? 2 : 1);
        if (scenario === 'canonical-concurrent')
          expect(goals.data.filter((g: any) => g.status === 'active')).toHaveLength(1);
        for (const t of tables.filter(t => t !== table))
          expect(after.find(r => r.table === t)).toEqual(terminalBaseline.find(r => r.table === t));
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

