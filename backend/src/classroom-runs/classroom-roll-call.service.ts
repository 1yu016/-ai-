import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { SchoolClass } from '../platform/entities/school-class.entity';
import { TeacherClass } from '../platform/entities/teacher-class.entity';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import { StudentGroup } from '../classroom-participation/entities/student-group.entity';
import { StudentGroupMember } from '../classroom-participation/entities/student-group-member.entity';
import { ClassroomBusinessReceiptService, type RollCallOperation } from './classroom-business-receipt.service';
import { assertRunOperation } from './classroom-operation-context';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { ClassroomSnapshotReason, TERMINAL_CLASSROOM_RUN_STATUSES } from './classroom-run.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomRollCallRecord, RollCallMode } from './entities/classroom-roll-call-record.entity';
import { AttendanceStatus, StudentAttendanceRecord } from './entities/student-attendance-record.entity';

export type RollCallInput = {
  mode: RollCallMode; studentId?: number | null; studentName?: string | null;
  studentIds?: number[] | null; groupId?: number | null; groupKey?: string | null;
  cooldownCount?: number; algorithmVersion?: string;
};
type RollCallResult = {
  recordId: number; student: { id: number; displayName: string };
  rollCallState: Record<string, unknown>; committedRunVersion: number;
  eligibleCount: number; selectionPoolCount: number; cooldownRelaxed: boolean;
};

@Injectable()
export class ClassroomRollCallService {
  constructor(
    @InjectRepository(ClassroomRun) private readonly runs: Repository<ClassroomRun>,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly receipts: ClassroomBusinessReceiptService,
  ) {}

  normalize(input: RollCallInput) {
    if (!Object.values(RollCallMode).includes(input.mode)) throw new BadRequestException('点名模式非法');
    const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
    for (const value of [input.studentId, input.groupId])
      if (value != null && !positive(value)) throw new BadRequestException('点名对象标识非法');
    for (const value of [input.studentName, input.groupKey])
      if (value != null && (typeof value !== 'string' || value.length > 100)) throw new BadRequestException('点名名称非法');
    let studentIds: number[] | null = null;
    if (input.studentIds != null) {
      if (!Array.isArray(input.studentIds) || !input.studentIds.length || input.studentIds.length > 500 ||
          input.studentIds.some(id => !positive(id)) || new Set(input.studentIds).size !== input.studentIds.length)
        throw new BadRequestException('点名范围非法或包含重复学生');
      studentIds = [...input.studentIds].sort((a, b) => a - b);
    }
    const cooldownCount = input.cooldownCount ?? 1;
    if (!Number.isInteger(cooldownCount) || cooldownCount < 0 || cooldownCount > 50)
      throw new BadRequestException('点名冷却次数必须为0至50');
    const algorithmVersion = input.algorithmVersion ?? 'fair-v1';
    if (typeof algorithmVersion !== 'string' || !algorithmVersion.length || algorithmVersion.length > 32)
      throw new BadRequestException('点名算法版本非法');
    return { mode: input.mode, studentId: input.studentId ?? null,
      studentName: input.studentName?.trim() || null, studentIds,
      groupId: input.groupId ?? null, groupKey: input.groupKey?.trim() || null, cooldownCount, algorithmVersion };
  }

  async execute(actor: JwtTeacherPayload, runId: number, requestId: string,
    input: RollCallInput, expectedVersion?: number): Promise<RollCallResult> {
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100)
      throw new BadRequestException('点名请求标识非法');
    const payload = this.normalize(input);
    const operation = `roll_call.${payload.mode}` as RollCallOperation;
    const digest = this.receipts.digest(runId, operation, payload);
    return this.snapshots.transactionRequired(async manager => {
      const run = await this.requireAccess(manager, actor, runId);
      const replay = await this.receipts.read(manager, actor, runId, requestId, operation, digest);
      // Never read membership, attendance or random source on committed replay.
      if (replay) return replay.result as unknown as RollCallResult;
      if (await manager.getRepository(ClassroomRollCallRecord).existsBy({ requestId }))
        throw new ConflictException('LEGACY_REQUEST_UNVERIFIABLE: 点名已有正式记录但缺少可验证回执');
      if (TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as typeof TERMINAL_CLASSROOM_RUN_STATUSES[number]))
        throw new ConflictException('已结束课堂不能新增点名');
      if (expectedVersion !== undefined && expectedVersion !== run.version) throw new ConflictException('课堂版本冲突');
      await assertRunOperation(run, manager, this.snapshots, 'roll_call');
      if (payload.algorithmVersion !== 'fair-v1') throw new BadRequestException('不支持的点名算法版本');
      const changed = await manager.getRepository(ClassroomRun).update({ id: runId,
        version: expectedVersion ?? run.version, status: run.status, teacherId: actor.sub }, { version: run.version + 1 });
      if (changed.affected !== 1) throw new ConflictException('课堂版本冲突');
      run.version += 1;
      const students = await manager.getRepository(Student).find({
        where: { classId: run.classId, status: RecordStatus.Active }, order: { id: 'ASC' },
      });
      let candidates = students;
      if (payload.studentIds) {
        const range = new Set(payload.studentIds);
        candidates = candidates.filter(s => range.has(s.id));
        if (candidates.length !== range.size) throw new ForbiddenException('点名范围包含非本班或已停用幼儿');
      }
      if (payload.groupId !== null) {
        const group = await manager.getRepository(StudentGroup).findOneBy({ id: payload.groupId });
        if (!group || group.classroomRunId !== runId || group.classId !== run.classId)
          throw new ForbiddenException('分组不属于当前课堂班级');
        const members = await manager.getRepository(StudentGroupMember).findBy({ groupId: group.id, active: true });
        const ids = new Set(members.filter(m => m.removedAt === null).map(m => m.studentId));
        candidates = candidates.filter(s => ids.has(s.id));
      }
      if (payload.mode === RollCallMode.GroupRandom && payload.groupId === null && !payload.studentIds)
        throw new BadRequestException('分组点名必须提供groupId或明确范围');
      if (payload.mode === RollCallMode.Specified) {
        const matches = candidates.filter(s => payload.studentId !== null ? s.id === payload.studentId
          : payload.studentName !== null && [s.name, s.nickname].includes(payload.studentName));
        if (matches.length !== 1) throw new ForbiddenException('指定幼儿不在有效范围或重名，请使用学生ID');
        if (payload.studentName !== null && ![matches[0]!.name, matches[0]!.nickname].includes(payload.studentName))
          throw new BadRequestException('学生ID与姓名不一致');
        candidates = matches;
      } else if (payload.studentId !== null || payload.studentName !== null) {
        throw new BadRequestException('随机点名不能提交指定幼儿');
      }
      const attendance = await manager.getRepository(StudentAttendanceRecord).findBy({ classroomRunId: runId });
      const excluded = new Set(attendance.filter(a => [AttendanceStatus.Absent, AttendanceStatus.Leave].includes(a.status)).map(a => a.studentId));
      candidates = candidates.filter(s => !excluded.has(s.id));
      if (!candidates.length) throw new ConflictException('当前范围没有可点名的出勤幼儿');
      const records = manager.getRepository(ClassroomRollCallRecord);
      const history = await records.find({ where: { classroomRunId: runId }, order: { createdAt: 'DESC', id: 'DESC' } });
      const counts = this.counts(history);
      let pool = candidates;
      let cooldownRelaxed = false;
      if (payload.mode !== RollCallMode.Specified) {
        const minimum = Math.min(...candidates.map(s => counts[s.id] ?? 0));
        const fair = candidates.filter(s => (counts[s.id] ?? 0) === minimum);
        const recent = new Set(history.slice(0, payload.cooldownCount).map(r => r.studentId));
        const cooled = fair.filter(s => !recent.has(s.id));
        cooldownRelaxed = !cooled.length && fair.some(s => recent.has(s.id));
        pool = cooled.length ? cooled : fair;
      }
      const selected = pool[payload.mode === RollCallMode.Specified ? 0 : this.chooseIndex(pool.length)]!;
      const record = await records.save(records.create({ requestId, classroomRunId: runId, classId: run.classId,
        studentId: selected.id, teacherId: actor.sub, mode: payload.mode,
        groupKey: payload.groupId !== null ? `group:${payload.groupId}` : payload.groupKey,
        eligibleCount: candidates.length, createdAt: new Date(Math.max(Date.now(), history[0]?.createdAt.getTime() ?? 0)) }));
      const formal = await records.find({ where: { classroomRunId: runId }, order: { createdAt: 'DESC', id: 'DESC' } });
      const rollCallState = await this.projection(manager, formal);
      const result: RollCallResult = JSON.parse(JSON.stringify({ recordId: record.id,
        student: { id: selected.id, displayName: selected.nickname || selected.name }, rollCallState,
        committedRunVersion: run.version, eligibleCount: candidates.length, selectionPoolCount: pool.length, cooldownRelaxed }));
      await this.receipts.write(manager, actor, run.deviceId, { kind: 'classroom_business_receipt', contractVersion: 1,
        normalizationVersion: 1, originalRequestId: requestId, operation, runId, payloadDigest: digest,
        businessRecordIds: [record.id], committedRunVersion: run.version, result });
      await this.snapshots.captureBusinessRequired(runId, ClassroomSnapshotReason.RollCall, false, 'roll_call', {}, manager);
      return result;
    });
  }

  async assertReceiptAccess(actor: JwtTeacherPayload, runId: number) {
    await this.requireAccess(this.runs.manager, actor, runId);
  }

  async readCommandReceipt(actor: JwtTeacherPayload, runId: number, requestId: string, input: RollCallInput) {
    await this.assertReceiptAccess(actor, runId);
    const payload = this.normalize(input);
    const operation = `roll_call.${payload.mode}` as RollCallOperation;
    return this.receipts.read(this.runs.manager, actor, runId, requestId, operation,
      this.receipts.digest(runId, operation, payload));
  }

  private async requireAccess(manager: EntityManager, actor: JwtTeacherPayload, runId: number) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('仅教师可点名');
    const run = await manager.getRepository(ClassroomRun).findOneBy({ id: runId });
    if (!run) throw new NotFoundException('课堂不存在');
    const cls = await manager.getRepository(SchoolClass).findOneBy({ id: run.classId });
    if (run.teacherId !== actor.sub || !cls ||
        !(await manager.getRepository(TeacherClass).existsBy({ teacherId: actor.sub, classId: run.classId })) ||
        (actor.schoolId && cls.schoolId && actor.schoolId !== cls.schoolId)) throw new ForbiddenException('无权访问本课堂班级');
    return run;
  }

  private chooseIndex(size: number) { return randomInt(size); }

  private counts(records: ClassroomRollCallRecord[]) {
    const counts: Record<number, number> = {};
    for (const record of records) counts[record.studentId] = (counts[record.studentId] ?? 0) + 1;
    return counts;
  }

  private async projection(manager: EntityManager, records: ClassroomRollCallRecord[]) {
    const latest = records[0]!;
    const student = await manager.getRepository(Student).findOneBy({ id: latest.studentId });
    const operation = { [RollCallMode.Random]: 'random_roll_call', [RollCallMode.Specified]: 'specified_roll_call',
      [RollCallMode.GroupRandom]: 'group_roll_call' }[latest.mode];
    return { counts: this.counts(records), recentStudentIds: [...new Set(records.map(r => r.studentId))].slice(0, 5),
      recentResults: records.slice(0, 5).map(r => ({ recordId: r.id, studentId: r.studentId, mode: r.mode })),
      lastRecordId: latest.id, lastStudentId: latest.studentId, lastStudentDisplayName: student?.nickname || student?.name || '',
      lastOperation: operation, updatedAt: latest.createdAt.toISOString() };
  }
}
