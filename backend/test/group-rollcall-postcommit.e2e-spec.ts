import { jest } from '@jest/globals';
import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { JwtService } from '@nestjs/jwt';
import { ClassroomCommandService } from '../src/classroom-runs/classroom-command.service';
import { ClassroomRunService } from '../src/classroom-runs/classroom-run.service';
import { ClassroomCommandRecord } from '../src/classroom-runs/entities/classroom-command-record.entity';
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
import { ClassroomRollCallService } from '../src/classroom-runs/classroom-roll-call.service';
import { StudentGroup } from '../src/classroom-participation/entities/student-group.entity';
import { StudentGroupMember } from '../src/classroom-participation/entities/student-group-member.entity';
import { StudentAttendanceRecord } from '../src/classroom-runs/entities/student-attendance-record.entity';
import { DataSource, Repository } from 'typeorm';
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
  'classroom_run', 'collective_goal', 'class_growth_goal', 'student_group', 'student_group_member',
];
const legacyTables = tables.slice(0, 9);

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


/**
 * Post-commit recovery regression. Original reproduction evidence is retained in
 * COMMAND_BUS_POSTCOMMIT_FAULT_VERIFICATION.md. No production fault switches.
 * Uses a fresh mkdtemp SQLite file; never imports AppModule or the real .env.
 */
describe('A-03 canonical group rollcall post-commit recovery', () => {
  const domains = [
    { name: 'group-rollcall', operation: 'group_roll_call', table: 'classroom_roll_call_record',
      params: (groupId: number, ids: number[]) => ({ groupId, studentIds: ids, cooldownCount: 1,
        algorithmVersion: 'fair-v1', groupKey: 'synthetic-group' }) },
  ];
  for (const domain of domains) for (const fault of ['A-read-run', 'B-save-success', 'C-reopen-processing', 'normal', 'uncommitted']) {
    it(`${fault === 'normal' || fault === 'uncommitted' ? 'CONTROL' : 'RECOVERY'} ${domain.name}: ${fault}`, async () => {
      const folder = await mkdtemp(join(tmpdir(), 'command-postcommit-isolated-'));
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
      const students = await db.getRepository(Student).save([
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
        const group = await db.getRepository(StudentGroup).save({ classroomRunId: run.id, classId: cls.id,
          name: 'synthetic-group', createdBy: teacher.id });
        await db.getRepository(StudentGroupMember).save(students.map(student => ({
          groupId: group.id, studentId: student.id, active: true, addedBy: teacher.id, addedAt: new Date(), removedAt: null,
        })));
        const body = { requestId: `fault-${domain.name}-${fault}`, runId: run.id, deviceId: device.id,
          expectedVersion: 1, source: 'teacher_panel', operation: domain.operation,
          parameters: domain.params(group.id, students.map(student => student.id)) };
        const bus = app.get(ClassroomCommandService);
        await enterTeachingFixture(app, run.id);
        const runs = app.get(ClassroomRunService);
        const commands = (bus as any).commands;
        const assertCommitted = async () => {
          expect(await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id })).toMatchObject({ version: 2 });
          const count = await db.query(`SELECT COUNT(*) AS n FROM "${domain.table}"`);
          expect(count[0].n).toBe(1);
          const events = await db.query('SELECT payload FROM classroom_event');
          expect(events.map((e: any) => JSON.parse(e.payload)).filter((p: any) =>
            p.kind === 'classroom_business_receipt' && p.contractVersion === 1)).toHaveLength(1);
        };
        let seamHits = 0;
        if (fault === 'A-read-run') {
          const originalGet = runs.get.bind(runs);
          let gets = 0;
          jest.spyOn(runs, 'get').mockImplementation(async (...args: Parameters<typeof runs.get>) => {
            if (++gets === 2) {
              await assertCommitted(); seamHits++;
              throw new Error('INJECTED after commit: read Run');
            }
            return originalGet(...args);
          });
        }
        if (fault === 'B-save-success' || fault === 'C-reopen-processing' || fault === 'uncommitted') {
          const originalUpdate = commands.update.bind(commands);
          jest.spyOn(commands, 'update').mockImplementation(async (criteria: any, patch: any) => {
            if (patch.status === 'success') {
              await assertCommitted(); seamHits++;
              throw new Error('INJECTED after commit: save Success');
            }
            if ((fault === 'C-reopen-processing' || fault === 'uncommitted') && patch.status === 'failure')
              throw new Error('INJECTED interrupt before failure response persistence');
            return originalUpdate(criteria, patch);
          });
          if (fault === 'uncommitted')
            jest.spyOn(bus as any, 'executeOperation').mockRejectedValue(new Error('INJECTED before domain execution'));
        }
        const initial = await rows(db);
        const firstSelection = jest.spyOn(app.get(ClassroomRollCallService) as any, 'chooseIndex');
        const first = await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(body);
        const firstSelectionCalls = firstSelection.mock.calls.length;
        expect(firstSelectionCalls).toBe(fault === 'uncommitted' ? 0 : 1);
        jest.restoreAllMocks();
        const beforeReopen = await rows(db);
        const commandBeforeReopen = await db.getRepository(ClassroomCommandRecord).findOneByOrFail({ requestId: body.requestId });
        let activeDb = db;
        if (fault === 'C-reopen-processing' || fault === 'uncommitted') {
          await app.close(); app = undefined;
          app = await openTestApplication(database, false);
          activeDb = app.get(DataSource);
          expect(activeDb).not.toBe(db);
          expect(activeDb.options.database).toBe(database);
        }
        const committed = await rows(activeDb);
        const command = await activeDb.getRepository(ClassroomCommandRecord).findOneByOrFail({ requestId: body.requestId });
        expect(committed).toEqual(beforeReopen);
        expect(command).toEqual(commandBeforeReopen);
        const poolTargets = [Student, StudentGroup, StudentGroupMember, StudentAttendanceRecord];
        const assertReadOnlyReplay = async (expectedState: Awaited<ReturnType<typeof rows>>) => {
          const service = app!.get(ClassroomRollCallService);
          const select = jest.spyOn(service as any, 'chooseIndex');
          let candidateReads = 0;
          const watches = ['find', 'findBy', 'findOneBy'].map(method => {
            const original = (Repository.prototype as any)[method];
            return jest.spyOn(Repository.prototype as any, method).mockImplementation(async function(this: Repository<any>, ...args: any[]) {
              if (poolTargets.includes(this.metadata.target as any)) candidateReads++;
              return original.apply(this, args);
            });
          });
          try {
            const response = await request(app!.getHttpServer()).post('/classroom-commands').set(auth)
              .send({ ...body, parameters: { ...body.parameters, studentIds: [...body.parameters.studentIds].reverse() } });
            const direct = service.execute as any;
            const expectedFailure = fault === 'uncommitted';
            if (!expectedFailure) {
              expect(response.status).toBe(201);
              const receipt = JSON.parse(expectedState.find(t => t.table === 'classroom_event')!.data[0].payload);
              expect(response.body.result).toEqual(receipt.result);
              expect(await direct.call(service, { sub: teacher.id, userType: 'teacher', schoolId: 'isolated-restart' },
                run.id, body.requestId, { ...body.parameters, mode: 'group_random' })).toEqual(receipt.result);
              expect(response.body.result.recordId).toBe(expectedState.find(t => t.table === domain.table)!.data[0].id);
            } else expect(response.status).toBe(409);
            expect(candidateReads).toBe(0);
            expect(select).not.toHaveBeenCalled();
            expect(await rows(activeDb)).toEqual(expectedState);
            return response;
          } finally { watches.forEach(watch => watch.mockRestore()); select.mockRestore(); }
        };
        const executionSpy = jest.spyOn(app.get(ClassroomCommandService) as any, 'executeOperation');
        const retry = await assertReadOnlyReplay(committed);
        expect(executionSpy).not.toHaveBeenCalled();
        executionSpy.mockRestore();
        expect(await rows(activeDb)).toEqual(committed);
        const changedStatuses: Record<string, number> = {};
        const variants = {
          mode: { ...body, operation: 'random_roll_call' },
          group: { ...body, parameters: { ...body.parameters, groupId: group.id + 999 } },
          range: { ...body, parameters: { ...body.parameters, studentIds: [students[0]!.id] } },
          cooldown: { ...body, parameters: { ...body.parameters, cooldownCount: 0 } },
          algorithm: { ...body, parameters: { ...body.parameters, algorithmVersion: 'fair-v2' } },
          groupKey: { ...body, parameters: { ...body.parameters, groupKey: 'different-key' } },
          student: { ...body, parameters: { ...body.parameters, studentId: students[0]!.id } },
        };
        for (const [field, variant] of Object.entries(variants)) {
          const changed = await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(variant);
          expect(changed.status).toBe(409); changedStatuses[field] = changed.status;
          expect(await rows(activeDb)).toEqual(committed);
        }
        const denied: Record<string, number> = {};
        for (const path of ['replay', 'query']) {
          const result = path === 'replay'
            ? await request(app.getHttpServer()).post('/classroom-commands').set(otherAuth).send(body)
            : await request(app.getHttpServer()).get(`/classroom-commands/${body.requestId}`).set(otherAuth);
          expect([403, 409]).toContain(result.status);
          denied[path] = result.status;
          expect(JSON.stringify(result.body)).not.toContain('businessRecordIds');
          expect(result.body).not.toHaveProperty('result');
          expect(result.body).not.toHaveProperty('responsePayload');
        }
        expect(await rows(activeDb)).toEqual(committed);
        expect(committed.filter(t => legacyTables.includes(t.table))).toEqual(initial.filter(t => legacyTables.includes(t.table)));
        expect(await activeDb.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await activeDb.query('PRAGMA foreign_key_check')).toEqual([]);
        const currentRun = await activeDb.getRepository(ClassroomRun).findOneByOrFail({ id: run.id });
        const factRows = committed.find(t => t.table === domain.table)!;
        expect(factRows.count).toBe(fault === 'uncommitted' ? 0 : 1);
        expect(currentRun.version).toBe(fault === 'uncommitted' ? 1 : 2);
        if (fault === 'uncommitted') {
          expect(committed).toEqual(initial);
        } else {
          expect(committed.find(t => t.table === 'classroom_snapshot')!.count).toBe(initial.find(t => t.table === 'classroom_snapshot')!.count + 1);
          const receipts = committed.find(t => t.table === 'classroom_event')!.data.map((e: any) => JSON.parse(e.payload));
          expect(receipts).toHaveLength(1);
          expect(receipts[0]).toMatchObject({ kind: 'classroom_business_receipt', contractVersion: 1,
            originalRequestId: body.requestId, committedRunVersion: 2 });
          expect(factRows.data.every((r: any) => r.classroom_run_id === run.id)).toBe(true);
          expect(receipts[0]).toMatchObject({ operation: 'roll_call.group_random',
            businessRecordIds: [factRows.data[0].id], result: { recordId: factRows.data[0].id, eligibleCount: 2, selectionPoolCount: 2 } });
          expect(students.map(student => student.id)).toContain(receipts[0].result.student.id);
          expect(factRows.data[0]).toMatchObject({ mode: 'group_random', group_key: 'group:' + group.id });
          const latestSnapshot = committed.find(t => t.table === 'classroom_snapshot')!.data.at(-1);
          expect(JSON.parse(latestSnapshot.roll_call_state)).toEqual(receipts[0].result.rollCallState);
        }
        const evidence = { domain: domain.name, fault, database, request: body,
          first: { status: first.status, body: first.body }, retry: { status: retry.status, body: retry.body },
          changedStatuses, denied, commandStatus: command.status, command, seamHits, firstSelectionCalls,
          runVersion: currentRun.version,
          before: initial, after: committed,
          integrity: 'ok', foreignKeys: 0, sideEffectsOnRetry: false };
        await writeFile(join(process.cwd(), '.tmp', `group-rollcall-postcommit-${fault}.json`),
          JSON.stringify(evidence, null, 2));
        console.log('GROUP_ROLLCALL_POST_COMMIT_EVIDENCE', JSON.stringify({ domain: domain.name, fault,
          firstStatus: first.status, retryStatus: retry.status, commandStatus: command.status,
          runVersion: currentRun.version, integrity: 'ok', sideEffectsOnRetry: false }));
        if (fault !== 'uncommitted') {
          await activeDb.getRepository(StudentGroupMember).update({ groupId: group.id }, { active: false, removedAt: new Date() });
          const membershipChanged = await rows(activeDb);
          await assertReadOnlyReplay(membershipChanged);
          const fresh = await request(app.getHttpServer()).post('/classroom-commands').set(auth).send({
            ...body, requestId: body.requestId + '-new', expectedVersion: 2,
          });
          expect(fresh.status).toBe(409);
          expect(await rows(activeDb)).toEqual(membershipChanged);
          await writeFile(join(process.cwd(), '.tmp', `group-rollcall-membership-${fault}.json`),
            JSON.stringify({ requestId: body.requestId, originalRecordId: factRows.data[0].id,
              beforeMembershipChange: committed, afterMembershipChange: membershipChanged,
              afterReplay: await rows(activeDb), newRequestStatus: fresh.status,
              candidateReadsOnReplay: 0, randomSelectionsOnReplay: 0 }, null, 2));
        }
        if (fault === 'normal') {
          expect(first.status).toBe(201); expect(retry.status).toBe(201); expect(retry.body).toEqual(first.body);
        } else if (fault === 'uncommitted') {
          expect(first.status).toBe(500); expect(command.status).toBe('processing'); expect(retry.status).toBe(409);
        } else {
          expect(seamHits).toBe(1);
          expect(retry.status).toBe(201);
          const event = committed.find(t => t.table === 'classroom_event')!.data[0];
          const receipt = JSON.parse(event.payload);
          expect(retry.body.result).toEqual(receipt.result);
          expect(retry.body.classroomState).toBeNull();
          expect(retry.body.currentClassroomState).toMatchObject({ id: run.id, version: 2 });
          expect(retry.body.recovery).toMatchObject({ source: 'canonical_business_receipt', committedRunVersion: 2 });
          if (fault === 'A-read-run') {
            const beforeTamper = await rows(activeDb); // Membership was deliberately changed above.
            // A transport hash match alone is not proof of canonical success.
            for (const replacement of [JSON.stringify({ kind: 'command' }),
              JSON.stringify({ ...receipt, payloadDigest: '0'.repeat(64) }),
              JSON.stringify({ ...receipt, runId: run.id + 1 })]) {
              await activeDb.query('UPDATE classroom_event SET payload=? WHERE id=?', [replacement, event.id]);
              await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(body).expect(409);
            }
            await activeDb.query('DELETE FROM classroom_event WHERE id=?', [event.id]);
            await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(body).expect(500);
            await activeDb.query('INSERT INTO classroom_event (' + Object.keys(event).map(k => `"${k}"`).join(',') +
              ') VALUES (' + Object.keys(event).map(() => '?').join(',') + ')', Object.values(event));
            expect(await rows(activeDb)).toEqual(beforeTamper);
          }
          if (fault === 'C-reopen-processing') {
            await activeDb.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed, version: 3 });
            await activeDb.getRepository(Student).update(students[0]!.id, { status: RecordStatus.Disabled, name: '隔离改名后' });
            const advanced = await rows(activeDb);
            const replay = await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(body).expect(201);
            expect(replay.body.result).toEqual(receipt.result);
            expect(replay.body.recovery.committedRunVersion).toBe(2);
            expect(replay.body.currentClassroomState).toMatchObject({ status: 'completed', version: 3 });
            expect(await rows(activeDb)).toEqual(advanced);
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
  }
});



