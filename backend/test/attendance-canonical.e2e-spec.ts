import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { seedSnapshotFixture } from './helpers/snapshot-fixture';
import { AttendanceService } from '../src/classroom-runs/attendance.service';
import { ClassroomRecordService } from '../src/classroom-runs/classroom-record.service';
import { AttendanceStatus, StudentAttendanceRecord } from '../src/classroom-runs/entities/student-attendance-record.entity';
import { AttendanceChangeSource, StudentAttendanceChange } from '../src/classroom-runs/entities/student-attendance-change.entity';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ClassroomBusinessReceiptService } from '../src/classroom-runs/classroom-business-receipt.service';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { ClassroomSnapshotReason } from '../src/classroom-runs/classroom-run.types';
import type { JwtTeacherPayload } from '../src/auth/auth.types';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import {
  LESSON_PLAN_ENTITIES,
  LessonPlanModule,
} from '../src/lesson-plans/lesson-plan.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonAgeGroup, LessonPlanStatus } from '../src/lesson-plans/lesson-plan.types';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { Device } from '../src/platform/entities/device.entity';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';
import {
  DeviceStatus,
  DeviceType,
  RecordStatus,
  TeacherClassRole,
} from '../src/platform/platform.types';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

describe('0.5-3C canonical attendance transactions (e2e)', () => {
  let app: INestApplication;
  let teacherId: number;
  let otherTeacherId: number;
  let classId: number;
  let foreignClassId: number;
  let studentId: number;
  let student2Id: number;
  let foreignStudentId: number;
  let runId: number;

  const rid = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'student-reward-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'reward_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '奖励教师',
              ARK_API_KEY: 'reward-test-key',
              ARK_ENDPOINT_ID: 'reward-test-model',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            Teacher,
            Administrator,
            RefreshTokenSession,
            TeachingResource,
            LessonPlan,
            ...PLATFORM_ENTITIES,
            ...RESOURCE_ENTITIES,
            ...LESSON_PLAN_ENTITIES,
            ...CLASSROOM_RUN_ENTITIES,
            ...AVATAR_ENTITIES,
          ],
          synchronize: true,
        }),
        AuthModule,
        PlatformModule,
        ResourceModule,
        LessonPlanModule,
        ClassroomRunModule,
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({ account: 'reward_teacher' });
    teacher.schoolId = 'garden-reward';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const other = await teachers.save(
      teachers.create({
        account: 'reward_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '隔壁教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-reward',
      }),
    );
    otherTeacherId = other.id;
    const _token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: teacher.account, password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
    const _otherToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: other.account, password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;

    const classes = app.get<Repository<SchoolClass>>(getRepositoryToken(SchoolClass));
    classId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-reward',
          name: '小一班',
          grade: '小班',
          ageRange: '3-4',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    foreignClassId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-reward',
          name: '中一班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    // 奖励教师只拥有小一班（隔壁教师没有任何班）。
    await app
      .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
      .save(
        app
          .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
          .create({ teacherId, classId, role: TeacherClassRole.Lead }),
      );

    const students = app.get<Repository<Student>>(getRepositoryToken(Student));
    studentId = (
      await students.save(
        students.create({
          classId,
          studentNo: 'XB-001',
          name: '朵朵',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    student2Id = (
      await students.save(
        students.create({
          classId,
          studentNo: 'XB-002',
          name: '糖糖',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    foreignStudentId = (
      await students.save(
        students.create({
          classId: foreignClassId,
          studentNo: 'ZB-001',
          name: '壮壮',
          status: RecordStatus.Active,
        }),
      )
    ).id;

    const classrooms = app.get<Repository<Classroom>>(getRepositoryToken(Classroom));
    const classroomId = (
      await classrooms.save(
        classrooms.create({
          schoolId: 'garden-reward',
          name: '阳光活动室',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    const deviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'REWARD-SCREEN-1',
          schoolId: 'garden-reward',
          name: '一号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;

    const deviceId2 = (
      await devices.save(
        devices.create({
          deviceCode: 'REWARD-SCREEN-2',
          schoolId: 'garden-reward',
          name: '二号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;

    const plans = app.get<Repository<LessonPlan>>(getRepositoryToken(LessonPlan));
    const plan = await plans.save(
      plans.create({
        teacherId,
        schoolId: 'garden-reward',
        title: '认识数字1',
        theme: '数字认知',
        ageGroup: LessonAgeGroup.ThreeToFour,
        objectives: '认识数字1',
        estimatedMinutes: 15,
        status: LessonPlanStatus.Draft,
        version: 1,
      }),
    );

    const runs = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const makeRun = async (
      ownerId: number,
      clsId: number,
      title: string,
      devId: number,
    ) => {
      const saved = await runs.save(
        runs.create({
          lessonPlanId: plan.id,
          lessonPlanVersion: 1,
          teacherId: ownerId,
          classId: clsId,
          classroomId,
          deviceId: devId,
          title,
          status: ClassroomRunStatus.Running,
          currentStepIndex: 0,
          version: 1,
        }),
      );
      await enterTeachingFixture(app, saved.id);
      return saved;
    };
    runId = (await makeRun(teacherId, classId, '认识数字1', deviceId)).id;
    const _foreignRunId = (
      await makeRun(otherTeacherId, foreignClassId, '隔壁课堂', deviceId2)
    ).id;

  });

  afterAll(async () => {
    await app.close();
  });


  let id: number;
  const actor = (): JwtTeacherPayload => ({ sub: teacherId, userType: AuthUserType.Teacher,
    role: TeacherRole.Teacher, schoolId: 'garden-reward' } as JwtTeacherPayload);
  const service = () => app.get(AttendanceService);
  const repo = <T>(entity: new () => T): Repository<T & object> => app.get(getRepositoryToken(entity));
  const tables = ['classroom_run', 'student_attendance_record', 'student_attendance_change', 'classroom_event', 'classroom_snapshot'];
  const capture = async () => Promise.all(tables.map(table => repo(ClassroomRun).manager.query('SELECT * FROM ' + table + ' ORDER BY id')));
  const updates = () => [{ studentId, status: AttendanceStatus.Present, note: '教师确认' },
    { studentId: student2Id, status: AttendanceStatus.Late, note: '稍晚到达' }];
  const write = (requestId: string, items = updates(), options: any = { mode: 'batch' }) =>
    service().apply(actor(), { id, classId: foreignClassId }, requestId, items, AttendanceChangeSource.Manual, options);

  beforeEach(async () => {
    const runs = repo(ClassroomRun);
    await runs.update({ classId }, { status: ClassroomRunStatus.Completed });
    const parent = await runs.findOneByOrFail({ id: runId });
    const { id: _id, ...data } = parent;
    id = (await runs.save(runs.create({ ...data, status: ClassroomRunStatus.Running, version: 1 }))).id;
    await enterTeachingFixture(app, id);
  });

  it('single modify and atomic batch preserve first mark; records are sole current state', async () => {
    const first = await write(rid('single'), [updates()[0]!], { mode: 'single', expectedVersion: 1 });
    expect(first.committedRunVersion).toBe(2);
    const result = await write(rid('batch'));
    expect(result.attendanceState).toEqual({ [studentId]: 'present', [student2Id]: 'late' });
    await write(rid('change'), [{ ...updates()[0]!, status: AttendanceStatus.Absent }], { mode: 'single' });
    const record = await repo(StudentAttendanceRecord).findOneByOrFail({ classroomRunId: id, studentId });
    expect(record.firstStatus).toBe('present'); expect(record.status).toBe('absent');
    expect(await repo(StudentAttendanceChange).countBy({ classroomRunId: id })).toBe(4);
    expect((await app.get(ClassroomSnapshotService).loadLatestValid(id))!.attendanceState)
      .toEqual({ [studentId]: 'absent', [student2Id]: 'late' });
  });

  it('replays original result across reorder, later changes and completion without extra audit', async () => {
    const requestId = rid('lost-response');
    const first = await write(requestId);
    await write(rid('later'), [{ ...updates()[0]!, status: AttendanceStatus.Absent }], { mode: 'single' });
    await repo(ClassroomRun).update(id, { status: ClassroomRunStatus.Completed });
    const baseline = await capture();
    expect(await write(requestId, [...updates()].reverse())).toEqual(first);
    expect(await capture()).toEqual(baseline);
    await expect(write(rid('terminal'))).rejects.toMatchObject({ status: 409 });
    const receipt = await new ClassroomBusinessReceiptService().read(repo(ClassroomRun).manager, actor(), id,
      requestId, 'attendance.batch', app.get(ClassroomBusinessReceiptService).digest(id, 'attendance.batch',
        service().normalize(updates(), AttendanceChangeSource.Manual, { mode: 'batch' })));
    expect(receipt!.result).toEqual(first);
  });

  it('same ID rejects status, note, members, mode and confirmation changes', async () => {
    const requestId = rid('digest');
    await write(requestId);
    const baseline = await capture();
    for (const items of [
      [{ ...updates()[0]!, status: AttendanceStatus.Absent }, updates()[1]!],
      [{ ...updates()[0]!, note: '不同备注' }, updates()[1]!],
      [updates()[0]!],
      [{ ...updates()[0]!, studentId: foreignStudentId }, updates()[1]!],
    ]) await expect(write(requestId, items)).rejects.toMatchObject({ status: 409 });
    await expect(write(requestId, updates(), { mode: 'batch', confirmed: true })).rejects.toMatchObject({ status: 409 });
    await expect(write(requestId, [updates()[0]!], { mode: 'single' })).rejects.toMatchObject({ status: 409 });
    expect(await capture()).toEqual(baseline);
  });

  it('legacy audit without a durable receipt cannot be guessed or executed again', async () => {
    const requestId = rid('legacy-audit');
    await write(requestId);
    // Simulate historical pre-3C facts lacking the new envelope, in isolated data only.
    await repo(ClassroomEvent).delete({ requestId: app.get(ClassroomBusinessReceiptService).key(actor(), id, requestId) });
    const baseline = await capture();
    await expect(write(requestId)).rejects.toMatchObject({ status: 409 });
    expect(await capture()).toEqual(baseline);
  });

  it('rejects duplicate students, even identical entries; invalid batch has no partial facts', async () => {
    const baseline = await capture();
    await expect(write(rid('duplicate'), [updates()[0]!, updates()[0]!])).rejects.toMatchObject({ status: 400 });
    await expect(write(rid('foreign'), [updates()[0]!, { ...updates()[1]!, studentId: foreignStudentId }]))
      .rejects.toMatchObject({ status: 400 });
    expect(await capture()).toEqual(baseline);
  });

  it.each(['record', 'change', 'event', 'snapshot'])('late %s failure rolls back batch, CAS, audit, receipt and snapshot', async failure => {
    const baseline = await capture();
    const save = Repository.prototype.save;
    const target = { record: StudentAttendanceRecord, change: StudentAttendanceChange,
      event: ClassroomEvent, snapshot: ClassroomSnapshot }[failure]!;
    let seen = 0; let manager: unknown;
    const fault = jest.spyOn(Repository.prototype, 'save').mockImplementation(async function(this: Repository<any>, value: any, options: any) {
      if ([StudentAttendanceRecord, StudentAttendanceChange, ClassroomEvent, ClassroomSnapshot].includes(this.metadata.target as any)) {
        manager ??= this.manager;
        expect(this.manager).toBe(manager);
        expect(this.manager.queryRunner!.isTransactionActive).toBe(true);
        expect((this.manager.queryRunner as any).transactionDepth).toBe(1);
      }
      const result = await (save as any).call(this, value, options);
      if (this.metadata.target === target && ++seen === (failure === 'record' || failure === 'change' ? 2 : 1))
        throw new Error('late attendance ' + failure + ' failure');
      return result;
    } as any);
    const requestId = rid('retry');
    try { await expect(write(requestId)).rejects.toThrow(); expect(await capture()).toEqual(baseline); }
    finally { fault.mockRestore(); }
    expect(seen).toBe(failure === 'record' || failure === 'change' ? 2 : 1);
    const first = await write(requestId);
    const committed = await capture();
    expect(await write(requestId)).toEqual(first); expect(await capture()).toEqual(committed);
    expect(await repo(StudentAttendanceChange).countBy({ classroomRunId: id })).toBe(2);
  });

  it('rebuilds damaged and wrong snapshots from canonical records only', async () => {
    await write(rid('initial'));
    const snapshots = app.get(ClassroomSnapshotService);
    const current = await repo(ClassroomSnapshot).findOneOrFail({ where: { classroomRunId: id }, order: { snapshotVersion: 'DESC' } });
    await repo(ClassroomSnapshot).update(current.id, { checksum: 'broken' });
    await write(rid('after-corrupt'), [updates()[0]!], { mode: 'single' });
    await seedSnapshotFixture(snapshots, id, ClassroomSnapshotReason.Timed, false,
      { attendanceState: { [studentId]: 'leave', 99999: 'present' } });
    await write(rid('after-wrong'), [{ ...updates()[0]!, status: AttendanceStatus.Absent }], { mode: 'single' });
    expect((await snapshots.loadLatestValid(id))!.attendanceState).toEqual({ [studentId]: 'absent', [student2Id]: 'late' });
  });

  it('summary current attendance reads canonical records, not a contradictory audit trail', async () => {
    await write(rid('summary-facts'));
    await repo(StudentAttendanceChange).update({ classroomRunId: id }, { nextStatus: AttendanceStatus.Absent });
    const run = await repo(ClassroomRun).findOneByOrFail({ id });
    const summary = await (app.get(ClassroomRecordService) as any).summaryAggregate(run);
    expect(summary.aiInput.attendance).toEqual(expect.arrayContaining([
      { name: 'present', count: 1 }, { name: 'late', count: 1 },
    ]));
    expect(summary.aiInput.attendance).toHaveLength(2);
    expect(summary.fallback.participation).toContain('考勤2人');
  });

  it('rejects disabled/transferred students; replay remains read-only with current authorization', async () => {
    const requestId = rid('before-transfer'); const first = await write(requestId);
    const original = await repo(Student).findOneByOrFail({ id: studentId });
    try {
      await repo(Student).update(studentId, { status: RecordStatus.Disabled });
      let baseline = await capture();
      await expect(write(rid('disabled'))).rejects.toMatchObject({ status: 400 });
      expect(await capture()).toEqual(baseline);
      await repo(Student).update(studentId, { status: RecordStatus.Active, classId: foreignClassId });
      baseline = await capture();
      await expect(write(rid('transfer'))).rejects.toMatchObject({ status: 400 });
      expect(await capture()).toEqual(baseline);
      expect(await write(requestId)).toEqual(first);
      await expect(service().apply({ ...actor(), sub: otherTeacherId }, { id, classId }, requestId,
        updates(), AttendanceChangeSource.Manual, { mode: 'batch' })).rejects.toMatchObject({ status: 403 });
      const relation = await repo(TeacherClass).findOneByOrFail({ teacherId, classId });
      await repo(TeacherClass).delete(relation.id);
      try { await expect(write(requestId)).rejects.toMatchObject({ status: 403 }); }
      finally { await repo(TeacherClass).save(relation); }
    } finally { await repo(Student).save(original); }
  });

  it('stale/CAS lost race writes nothing; terminal runs reject all first writes', async () => {
    const baseline = await capture();
    await expect(write(rid('version'), updates(), { mode: 'batch', expectedVersion: 99 })).rejects.toMatchObject({ status: 409 });
    expect(await capture()).toEqual(baseline);
    const update = Repository.prototype.update;
    const fault = jest.spyOn(Repository.prototype, 'update').mockImplementation(function(this: Repository<any>, criteria: any, values: any) {
      return this.metadata.target === ClassroomRun && criteria.id === id
        ? Promise.resolve({ affected: 0 } as any) : (update as any).call(this, criteria, values);
    } as any);
    try { await expect(write(rid('race'))).rejects.toMatchObject({ status: 409 }); expect(await capture()).toEqual(baseline); }
    finally { fault.mockRestore(); }
    for (const status of [ClassroomRunStatus.Completed, ClassroomRunStatus.Cancelled, ClassroomRunStatus.Failed]) {
      await repo(ClassroomRun).update(id, { status });
      const before = await capture();
      await expect(write(rid('terminal'))).rejects.toMatchObject({ status: 409 });
      expect(await capture()).toEqual(before);
    }
  });

  it('concurrent identical retries commit once; a terminal transition winning the gate blocks a new write', async () => {
    const requestId = rid('concurrent');
    const results = await Promise.all([write(requestId), write(requestId, [...updates()].reverse())]);
    expect(results[0]).toEqual(results[1]);
    expect(await repo(StudentAttendanceChange).countBy({ classroomRunId: id })).toBe(2);
    expect((await repo(ClassroomRun).findOneByOrFail({ id })).version).toBe(2);
    const attempts = await Promise.allSettled([
      app.get(ClassroomSnapshotService).transactionRequired(async manager => {
        await manager.getRepository(ClassroomRun).update(id, { status: ClassroomRunStatus.Completed, version: 3 });
      }),
      write(rid('racing-complete')),
    ]);
    expect(attempts[0]!.status).toBe('fulfilled');
    expect(attempts[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(await repo(StudentAttendanceChange).countBy({ classroomRunId: id })).toBe(2);
  });
});

