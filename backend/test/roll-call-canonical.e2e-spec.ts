import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { seedSnapshotFixture } from './helpers/snapshot-fixture';
import { ClassroomRollCallService, type RollCallInput } from '../src/classroom-runs/classroom-roll-call.service';
import { ClassroomRollCallRecord, RollCallMode } from '../src/classroom-runs/entities/classroom-roll-call-record.entity';
import { StudentGroup } from '../src/classroom-participation/entities/student-group.entity';
import { StudentGroupMember } from '../src/classroom-participation/entities/student-group-member.entity';


import { AttendanceStatus, StudentAttendanceRecord } from '../src/classroom-runs/entities/student-attendance-record.entity';

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

describe('0.5-3D canonical roll-call transactions (e2e)', () => {
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
  const service = () => app.get(ClassroomRollCallService);
  const repo = <T>(entity: new () => T): Repository<T & object> => app.get(getRepositoryToken(entity));
  const tables = ['classroom_run', 'classroom_roll_call_record', 'classroom_event', 'classroom_snapshot',
    'student_group', 'student_group_member', 'student_attendance_record'];
  const capture = async () => Promise.all(tables.map(table => repo(ClassroomRun).manager.query('SELECT * FROM ' + table + ' ORDER BY id')));
  const input = (): RollCallInput => ({ mode: RollCallMode.Random, studentIds: [studentId, student2Id] });
  const write = (requestId: string, payload = input(), version?: number) => service().execute(actor(), id, requestId, payload, version);
  const group = async () => {
    const g = await repo(StudentGroup).save(repo(StudentGroup).create({
      classroomRunId: id, classId, name: rid('group'), createdBy: teacherId, membershipSnapshot: '[]',
    }));
    for (const sid of [studentId, student2Id]) await repo(StudentGroupMember).save(repo(StudentGroupMember).create({
      groupId: g.id, studentId: sid, active: true, addedBy: teacherId, addedAt: new Date(), removedAt: null,
    }));
    return g;
  };
  const mark = async (sid: number, status: AttendanceStatus) => repo(StudentAttendanceRecord).save(repo(StudentAttendanceRecord).create({
    classroomRunId: id, classId, studentId: sid, status, firstStatus: status, firstMarkedByTeacherId: teacherId,
    firstMarkedAt: new Date(), modifiedByTeacherId: teacherId, modifiedAt: new Date(),
  }));

  beforeEach(async () => {
    const runs = repo(ClassroomRun);
    await runs.update({ classId }, { status: ClassroomRunStatus.Completed });
    const { id: _id, ...parent } = await runs.findOneByOrFail({ id: runId });
    id = (await runs.save(runs.create({ ...parent, status: ClassroomRunStatus.Running, version: 1 }))).id;
    await enterTeachingFixture(app, id);
  });

  it('random and specified persist one formal result, receipt and required Snapshot per operation', async () => {
    const random = await write(rid('random'), input(), 1);
    expect([studentId, student2Id]).toContain(random.student.id);
    expect(random.committedRunVersion).toBe(2);
    const choose = jest.spyOn(service() as any, 'chooseIndex');
    try {
      const specified = await write(rid('specified'), { mode: RollCallMode.Specified, studentId }, 2);
      expect(specified.student.id).toBe(studentId); expect(choose).not.toHaveBeenCalled();
      expect(specified.rollCallState.lastRecordId).toBe(specified.recordId);
      expect(Object.values(specified.rollCallState.counts as object).reduce((a: number,b: any) => a + b, 0)).toBe(2);
      expect((await app.get(ClassroomSnapshotService).loadLatestValid(id))!.rollCallState).toEqual(specified.rollCallState);
      const events = await repo(ClassroomEvent).findBy({ classroomRunId: id });
      expect(events).toHaveLength(2);
      expect(events.every(e => app.get(ClassroomBusinessReceiptService).parse(e)?.operation.startsWith('roll_call.'))).toBe(true);
    } finally { choose.mockRestore(); }
  });

  it('lost response retry returns frozen first child without candidate reads or random call, even after transfer/completion', async () => {
    const requestId = rid('lost-response');
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValue(0);
    const original = await repo(Student).findOneByOrFail({ id: studentId });
    try {
      const first = await write(requestId);
      expect(first.student.id).toBe(studentId); expect(choose).toHaveBeenCalledTimes(1);
      await repo(Student).update(studentId, { status: RecordStatus.Disabled, classId: foreignClassId, name: '改名后' });
      await repo(ClassroomRun).update(id, { status: ClassroomRunStatus.Completed });
      const baseline = await capture();
      const find = Repository.prototype.find;
      const guard = jest.spyOn(Repository.prototype, 'find').mockImplementation(function(this: Repository<any>, options: any) {
        if ([Student, StudentGroup, StudentGroupMember, StudentAttendanceRecord, ClassroomRollCallRecord].includes(this.metadata.target as any))
          throw new Error('replay must not rebuild candidates or history');
        return (find as any).call(this, options);
      } as any);
      try {
        expect(await write(requestId, { ...input(), studentIds: [student2Id, studentId] }, 1)).toEqual(first);
        expect(choose).toHaveBeenCalledTimes(1);
      } finally { guard.mockRestore(); }
      expect(await capture()).toEqual(baseline);
      const stored = await new ClassroomBusinessReceiptService().read(repo(ClassroomRun).manager, actor(), id,
        requestId, 'roll_call.random', app.get(ClassroomBusinessReceiptService).digest(id, 'roll_call.random', service().normalize(input())));
      expect(stored!.result).toEqual(first);
    } finally { choose.mockRestore(); await repo(Student).save(original); }
  });

  it('same requestId rejects mode/student/range/group/cooldown/algorithm/label changes', async () => {
    const requestId = rid('digest'); await write(requestId);
    const baseline = await capture();
    const variants: RollCallInput[] = [
      { ...input(), mode: RollCallMode.Specified, studentId }, { ...input(), studentId },
      { ...input(), studentIds: [studentId] }, { ...input(), groupId: 999 },
      { ...input(), cooldownCount: 2 }, { ...input(), algorithmVersion: 'fair-v2' }, { ...input(), groupKey: 'changed' },
    ];
    for (const value of variants) await expect(write(requestId, value)).rejects.toMatchObject({ status: 409 });
    expect(await capture()).toEqual(baseline);
    const specifiedId = rid('specified-digest');
    await write(specifiedId, { mode: RollCallMode.Specified, studentId });
    await expect(write(specifiedId, { mode: RollCallMode.Specified, studentId: student2Id })).rejects.toMatchObject({ status: 409 });
  });

  it('group members are revalidated for first execution but never change committed replay', async () => {
    const g = await group();
    // Membership snapshot is deliberately empty; only the real active member rows count.
    const requestId = rid('group');
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValue(0);
    const payload = { mode: RollCallMode.GroupRandom, groupId: g.id };
    try {
      const first = await write(requestId, payload);
      expect(first.student.id).toBe(studentId);
      await repo(StudentGroupMember).update({ groupId: g.id, studentId }, { active: false, removedAt: new Date() });
      expect(await write(requestId, payload)).toEqual(first);
      expect(choose).toHaveBeenCalledTimes(1);
      const next = await write(rid('new-group'), payload);
      expect(next.student.id).toBe(student2Id);
      await repo(StudentGroup).softDelete(g.id);
      expect(await write(requestId, payload)).toEqual(first);
      await expect(write(rid('deleted-group'), payload)).rejects.toMatchObject({ status: 403 });
    } finally { choose.mockRestore(); }
  });

  it('first execution excludes absent/leave, disabled, transferred and foreign students inside transaction', async () => {
    await mark(studentId, AttendanceStatus.Absent);
    const result = await write(rid('attendance-exclusion'));
    expect(result.student.id).toBe(student2Id);
    await expect(write(rid('specified-absent'), { mode: RollCallMode.Specified, studentId })).rejects.toMatchObject({ status: 409 });
    await mark(student2Id, AttendanceStatus.Leave);
    await expect(write(rid('none'))).rejects.toMatchObject({ status: 409 });
    const original = await repo(Student).findOneByOrFail({ id: studentId });
    try {
      for (const patch of [{ status: RecordStatus.Disabled }, { status: RecordStatus.Active, classId: foreignClassId }]) {
        await repo(Student).update(studentId, patch);
        const before = await capture();
        await expect(write(rid('ineligible'))).rejects.toMatchObject({ status: 403 });
        expect(await capture()).toEqual(before);
      }
    } finally { await repo(Student).save(original); }
    await expect(write(rid('foreign'), { ...input(), studentIds: [foreignStudentId] })).rejects.toMatchObject({ status: 403 });
  });

  it('revalidates membership/active state using the caller transaction, not a precomputed pool', async () => {
    const g = await group();
    const find = Repository.prototype.find;
    let changed = false;
    const intercept = jest.spyOn(Repository.prototype, 'find').mockImplementation(async function(this: Repository<any>, options: any) {
      if (this.metadata.target === Student && !changed) {
        changed = true;
        expect(this.manager.queryRunner!.isTransactionActive).toBe(true);
        await this.manager.getRepository(Student).update(studentId, { status: RecordStatus.Disabled });
        await this.manager.getRepository(StudentGroupMember).update({ groupId: g.id, studentId: student2Id }, { active: false });
      }
      return (find as any).call(this, options);
    } as any);
    const original = await repo(Student).findOneByOrFail({ id: studentId });
    const before = await capture();
    try {
      await expect(write(rid('changed-before-select'), { mode: RollCallMode.GroupRandom, groupId: g.id })).rejects.toMatchObject({ status: 409 });
      expect(await capture()).toEqual(before);
    } finally { intercept.mockRestore(); await repo(Student).save(original); }
  });

  it('group validates Run/class ownership; scoped range and active member restrictions intersect', async () => {
    const g = await group();
    expect((await write(rid('intersection'), { mode: RollCallMode.GroupRandom, groupId: g.id, studentIds: [student2Id] })).student.id).toBe(student2Id);
    await repo(StudentGroup).update(g.id, { classId: foreignClassId });
    await expect(write(rid('wrong-class-group'), { mode: RollCallMode.GroupRandom, groupId: g.id })).rejects.toMatchObject({ status: 403 });
    await repo(StudentGroup).update(g.id, { classId, classroomRunId: runId });
    await expect(write(rid('wrong-run-group'), { mode: RollCallMode.GroupRandom, groupId: g.id })).rejects.toMatchObject({ status: 403 });
  });

  it('cooldown uses formal ordered history and reports relaxation when fairness leaves no alternative', async () => {
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValue(0);
    try {
      const first = await write(rid('cooldown-first'));
      const second = await write(rid('cooldown-next'));
      expect(second.student.id).not.toBe(first.student.id);
      const one = await write(rid('single-candidate'), { ...input(), studentIds: [second.student.id], cooldownCount: 1 });
      expect(one.student.id).toBe(second.student.id); expect(one.cooldownRelaxed).toBe(true);
    } finally { choose.mockRestore(); }
  });

  it.each(['record', 'event', 'snapshot'])('late %s failure rolls back result/CAS/receipt/Snapshot; only a successful retry freezes randomness', async failure => {
    const before = await capture();
    const target = { record: ClassroomRollCallRecord, event: ClassroomEvent, snapshot: ClassroomSnapshot }[failure]!;
    const save = Repository.prototype.save;
    let seen = 0; let manager: unknown;
    const fault = jest.spyOn(Repository.prototype, 'save').mockImplementation(async function(this: Repository<any>, value: any, options: any) {
      if ([ClassroomRollCallRecord, ClassroomEvent, ClassroomSnapshot].includes(this.metadata.target as any)) {
        manager ??= this.manager; expect(this.manager).toBe(manager);
        expect(this.manager.queryRunner!.isTransactionActive).toBe(true);
        expect((this.manager.queryRunner as any).transactionDepth).toBe(1);
      }
      const saved = await (save as any).call(this, value, options);
      if (this.metadata.target === target) { seen++; throw new Error('late roll-call ' + failure); }
      return saved;
    } as any);
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValueOnce(0).mockReturnValue(1);
    const requestId = rid('fault-retry');
    try {
      try { await expect(write(requestId)).rejects.toThrow(); expect(await capture()).toEqual(before); }
      finally { fault.mockRestore(); }
      expect(seen).toBe(1);
      const first = await write(requestId); expect(first.student.id).toBe(student2Id);
      expect(choose).toHaveBeenCalledTimes(2);
      const committed = await capture();
      expect(await write(requestId)).toEqual(first); expect(choose).toHaveBeenCalledTimes(2);
      expect(await capture()).toEqual(committed);
    } finally { fault.mockRestore(); choose.mockRestore(); }
  });

  it('repairs Snapshot-only bogus counts and corrupt checksums from ALL formal records, beyond the old 50 row window', async () => {
    const records = repo(ClassroomRollCallRecord);
    await records.save(Array.from({ length: 60 }, (_, index) => records.create({
      requestId: rid('history-' + index), classroomRunId: id, classId, teacherId, studentId,
      mode: RollCallMode.Specified, eligibleCount: 1, groupKey: null, createdAt: new Date(Date.now() - 1000),
    })));
    const snapshots = app.get(ClassroomSnapshotService);
    await seedSnapshotFixture(snapshots, id, ClassroomSnapshotReason.Timed, false, { rollCallState: { counts: { [studentId]: 999, 99999: 999 } } });
    const first = await write(rid('repair'), { mode: RollCallMode.Specified, studentId: student2Id });
    expect(first.rollCallState.counts).toEqual({ [studentId]: 60, [student2Id]: 1 });
    const latest = await repo(ClassroomSnapshot).findOneOrFail({ where: { classroomRunId: id }, order: { snapshotVersion: 'DESC' } });
    await repo(ClassroomSnapshot).update(latest.id, { checksum: 'broken' });
    const next = await write(rid('repair-corrupt'), { mode: RollCallMode.Specified, studentId });
    expect(next.rollCallState.counts).toEqual({ [studentId]: 61, [student2Id]: 1 });
    expect(next.rollCallState.lastRecordId).toBe(next.recordId);
    expect((await snapshots.loadLatestValid(id))!.rollCallState).toEqual(next.rollCallState);
  });

  it('Snapshot-only history never seeds fairness or counts when no canonical record exists', async () => {
    await seedSnapshotFixture(app.get(ClassroomSnapshotService), id, ClassroomSnapshotReason.Timed, false,
      { rollCallState: { counts: { [studentId]: 1000 }, recentStudentIds: [student2Id] } });
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValue(0);
    try {
      const result = await write(rid('no-formal-history'));
      expect(result.student.id).toBe(studentId); expect(result.rollCallState.counts).toEqual({ [studentId]: 1 });
    } finally { choose.mockRestore(); }
  });

  it('CAS conflicts/terminal/authorization failures create no result; success replay rechecks current teacher access', async () => {
    const before = await capture();
    await expect(write(rid('stale'), input(), 99)).rejects.toMatchObject({ status: 409 }); expect(await capture()).toEqual(before);
    const update = Repository.prototype.update;
    const fault = jest.spyOn(Repository.prototype, 'update').mockImplementation(function(this: Repository<any>, criteria: any, values: any) {
      return this.metadata.target === ClassroomRun && criteria.id === id ? Promise.resolve({ affected: 0 } as any)
        : (update as any).call(this, criteria, values);
    } as any);
    try { await expect(write(rid('cas-zero'))).rejects.toMatchObject({ status: 409 }); expect(await capture()).toEqual(before); }
    finally { fault.mockRestore(); }
    const requestId = rid('terminal-replay'); const first = await write(requestId);
    for (const status of [ClassroomRunStatus.Completed, ClassroomRunStatus.Cancelled, ClassroomRunStatus.Failed]) {
      await repo(ClassroomRun).update(id, { status });
      const baseline = await capture(); expect(await write(requestId)).toEqual(first);
      await expect(write(rid('terminal'))).rejects.toMatchObject({ status: 409 }); expect(await capture()).toEqual(baseline);
    }
    await expect(service().execute({ ...actor(), sub: otherTeacherId }, id, requestId, input())).rejects.toMatchObject({ status: 403 });
    const relation = await repo(TeacherClass).findOneByOrFail({ teacherId, classId }); await repo(TeacherClass).delete(relation.id);
    try { await expect(write(requestId)).rejects.toMatchObject({ status: 403 }); }
    finally { await repo(TeacherClass).save(relation); }
  });

  it('concurrent identical requests choose only once and legacy formal rows without receipt cannot be guessed', async () => {
    const requestId = rid('concurrent');
    const choose = jest.spyOn(service() as any, 'chooseIndex').mockReturnValue(0);
    try {
      const both = await Promise.all([write(requestId), write(requestId)]);
      expect(both[0]).toEqual(both[1]); expect(choose).toHaveBeenCalledTimes(1);
      await repo(ClassroomEvent).delete({ requestId: app.get(ClassroomBusinessReceiptService).key(actor(), id, requestId) });
      const before = await capture();
      await expect(write(requestId)).rejects.toMatchObject({ status: 409 }); expect(await capture()).toEqual(before);
    } finally { choose.mockRestore(); }
  });

  it('ambiguous names, duplicate ranges and unknown algorithms cannot create first results', async () => {
    const other = await repo(Student).findOneByOrFail({ id: student2Id });
    await repo(Student).update(student2Id, { name: '朵朵' });
    try {
      const before = await capture();
      await expect(write(rid('ambiguous'), { mode: RollCallMode.Specified, studentName: '朵朵' })).rejects.toMatchObject({ status: 403 });
      await expect(write(rid('duplicates'), { ...input(), studentIds: [studentId, studentId] })).rejects.toMatchObject({ status: 400 });
      await expect(write(rid('unknown'), { ...input(), algorithmVersion: 'unknown' })).rejects.toMatchObject({ status: 400 });
      expect(await capture()).toEqual(before);
    } finally { await repo(Student).save(other); }
  });
});

