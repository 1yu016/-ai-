import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { withRecordIdentity } from './legacy-write-boundary';
import { assertRunOperation } from './classroom-operation-context';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { SchoolClass } from '../platform/entities/school-class.entity';
import { TeacherClass } from '../platform/entities/teacher-class.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { ClassroomBusinessReceiptService } from './classroom-business-receipt.service';
import { ClassroomSnapshotReason, TERMINAL_CLASSROOM_RUN_STATUSES } from './classroom-run.types';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import { ClassroomRunService } from './classroom-run.service';
import {
  AttendanceChangeSource,
  StudentAttendanceChange,
} from './entities/student-attendance-change.entity';
import {
  AttendanceStatus,
  StudentAttendanceRecord,
} from './entities/student-attendance-record.entity';

export type AttendanceUpdate = { studentId: number; status: AttendanceStatus; note?: string | null };
type AttendanceOptions = { expectedVersion?: number; mode?: 'single' | 'batch'; confirmed?: boolean };
type AttendanceResult = { items: StudentAttendanceRecord[]; updates: AttendanceUpdate[]; source: AttendanceChangeSource;
  confirmed: boolean; attendanceState: Record<string, AttendanceStatus>; committedRunVersion: number };

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(StudentAttendanceRecord)
    private readonly records: Repository<StudentAttendanceRecord>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly receipts: ClassroomBusinessReceiptService,
    private readonly runs: ClassroomRunService,
  ) {}

  async list(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.get(actor, runId);
    const items = await this.records.find({
      where: { classroomRunId: runId },
      order: { studentId: 'ASC' },
    });
    return { runId, classId: run.classId, items: items.map(r => withRecordIdentity(r, 'canonical', 'attendance')), attendanceState: this.state(items) };
  }

  /** Canonical write; caller-provided class data is not trusted. */
  async apply(actor: JwtTeacherPayload, identity: { id: number; classId: number }, requestId: string,
    updates: AttendanceUpdate[], source: AttendanceChangeSource, options: AttendanceOptions = {}) {
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100)
      throw new BadRequestException('考勤请求标识非法');
    const payload = this.normalize(updates, source, options);
    const operation = payload.mode === 'single' ? 'attendance.single' : 'attendance.batch';
    const digest = this.receipts.digest(identity.id, operation, payload);
    return this.snapshots.transactionRequired(async manager => {
      const run = await this.requireAccess(manager, actor, identity.id);
      const replay = await this.receipts.read(manager, actor, run.id, requestId, operation, digest);
      if (replay) return replay.result as unknown as AttendanceResult;
      if (await manager.getRepository(StudentAttendanceChange).existsBy({ classroomRunId: run.id, requestId }))
        throw new ConflictException('LEGACY_REQUEST_UNVERIFIABLE: 考勤已有审计但缺少可验证回执');
      if (TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as typeof TERMINAL_CLASSROOM_RUN_STATUSES[number]))
        throw new ConflictException('已结束课堂不能新增考勤');
      if (options.expectedVersion !== undefined && options.expectedVersion !== run.version)
        throw new ConflictException('课堂版本冲突');
      const hasPrevious = await manager.getRepository(StudentAttendanceRecord).existsBy({
        classroomRunId: run.id, studentId: In(payload.updates.map(u => u.studentId)),
      });
      // Mixed batches still contain new facts; existing-only correction semantics are not redefined.
      const allExisting = hasPrevious && await manager.getRepository(StudentAttendanceRecord).countBy({
        classroomRunId: run.id, studentId: In(payload.updates.map(u => u.studentId)),
      }) === payload.updates.length;
      await assertRunOperation(run, manager, this.snapshots, allExisting ? 'attendance_correction' : 'attendance_new');
      const changed = await manager.getRepository(ClassroomRun).update({
        id: run.id, version: options.expectedVersion ?? run.version, status: run.status, teacherId: actor.sub,
      }, { version: run.version + 1 });
      if (changed.affected !== 1) throw new ConflictException('课堂版本冲突');
      run.version += 1;
      const students = await manager.getRepository(Student).find({
        where: { id: In(payload.updates.map(u => u.studentId)), classId: run.classId, status: RecordStatus.Active },
      });
      if (students.length !== payload.updates.length)
        throw new BadRequestException('考勤名单包含非本课堂或已停用幼儿');
      const recordRepo = manager.getRepository(StudentAttendanceRecord);
      const changeRepo = manager.getRepository(StudentAttendanceChange);
      const ids: number[] = [];
      for (const item of payload.updates) {
        const previous = await recordRepo.findOneBy({ classroomRunId: run.id, studentId: item.studentId });
        const previousStatus = previous?.status ?? null;
        const now = new Date();
        const record = previous
          ? Object.assign(previous, { status: item.status, modifiedByTeacherId: actor.sub, modifiedAt: now })
          : recordRepo.create({
              classroomRunId: run.id, classId: run.classId, studentId: item.studentId,
              status: item.status, firstStatus: item.status, firstMarkedByTeacherId: actor.sub,
              firstMarkedAt: now, modifiedByTeacherId: actor.sub, modifiedAt: now,
            });
        const saved = await recordRepo.save(record);
        ids.push(saved.id);
        await changeRepo.save(changeRepo.create({
          attendanceRecordId: saved.id, classroomRunId: run.id, classId: run.classId,
          studentId: item.studentId, previousStatus, nextStatus: item.status,
          changedByTeacherId: actor.sub, source, requestId,
        }));
      }
      const items = await recordRepo.find({ where: { classroomRunId: run.id }, order: { studentId: 'ASC' } });
      const result = JSON.parse(JSON.stringify({
        items, updates: payload.updates, source, confirmed: payload.confirmed,
        attendanceState: this.state(items), committedRunVersion: run.version,
      })) as AttendanceResult;
      await this.receipts.write(manager, actor, run.deviceId, {
        kind: 'classroom_business_receipt', contractVersion: 1, normalizationVersion: 1,
        originalRequestId: requestId, operation, runId: run.id, payloadDigest: digest,
        businessRecordIds: ids, committedRunVersion: run.version, result,
      });
      await this.snapshots.captureBusinessRequired(run.id, ClassroomSnapshotReason.RollCall, false,
        'attendance', {}, manager);
      return result;
    });
  }

  normalize(updates: AttendanceUpdate[], source: AttendanceChangeSource, options: AttendanceOptions = {}) {
    if (!Array.isArray(updates) || !updates.length || updates.length > 500)
      throw new BadRequestException('考勤记录数量必须为1至500');
    if (!Object.values(AttendanceChangeSource).includes(source))
      throw new BadRequestException('考勤来源非法');
    const mode = options.mode ?? (source === AttendanceChangeSource.Batch || updates.length > 1 ? 'batch' : 'single');
    if (!['single', 'batch'].includes(mode) || (mode === 'single' && updates.length !== 1))
      throw new BadRequestException('考勤操作类型非法');
    if (options.confirmed !== undefined && typeof options.confirmed !== 'boolean')
      throw new BadRequestException('考勤确认标记非法');
    if (source === AttendanceChangeSource.VoiceConfirmed && options.confirmed === false)
      throw new BadRequestException('语音考勤必须由教师确认');
    const seen = new Set<number>();
    const normalized = updates.map(item => {
      if (!item || !Number.isSafeInteger(item.studentId) || item.studentId < 1 ||
          !Object.values(AttendanceStatus).includes(item.status))
        throw new BadRequestException('考勤学生或状态非法');
      if (seen.has(item.studentId)) throw new BadRequestException('考勤名单包含重复学生');
      seen.add(item.studentId);
      if (item.note !== undefined && item.note !== null && (typeof item.note !== 'string' || item.note.length > 500))
        throw new BadRequestException('考勤备注最多500字');
      return { studentId: item.studentId, status: item.status, note: item.note?.trim() || null };
    }).sort((a, b) => a.studentId - b.studentId);
    return { mode, source, confirmed: options.confirmed ?? source === AttendanceChangeSource.VoiceConfirmed, updates: normalized };
  }

  /** Replay authorization must not settle timed breaks or mutate the Run. */
  async assertReceiptAccess(actor: JwtTeacherPayload, runId: number) {
    await this.requireAccess(this.records.manager, actor, runId);
  }

  async readCommandReceipt(actor: JwtTeacherPayload, runId: number, requestId: string,
    updates: AttendanceUpdate[], source: AttendanceChangeSource, options: AttendanceOptions = {}) {
    await this.assertReceiptAccess(actor, runId);
    const payload = this.normalize(updates, source, options);
    const operation = payload.mode === 'single' ? 'attendance.single' : 'attendance.batch';
    return this.receipts.read(this.records.manager, actor, runId, requestId, operation,
      this.receipts.digest(runId, operation, payload));
  }

  private async requireAccess(manager: EntityManager, actor: JwtTeacherPayload, runId: number) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('仅教师可操作考勤');
    const run = await manager.getRepository(ClassroomRun).findOneBy({ id: runId });
    if (!run) throw new NotFoundException('课堂不存在');
    const schoolClass = await manager.getRepository(SchoolClass).findOneBy({ id: run.classId });
    const relation = await manager.getRepository(TeacherClass).existsBy({ teacherId: actor.sub, classId: run.classId });
    if (run.teacherId !== actor.sub || !schoolClass || !relation ||
        (actor.schoolId && schoolClass.schoolId && actor.schoolId !== schoolClass.schoolId))
      throw new ForbiddenException('无权访问本课堂班级');
    return run;
  }

  async voiceCandidates(actor: JwtTeacherPayload, runId: number, transcript: string) {
    const run = await this.runs.get(actor, runId);
    const students = await this.students.find({
      where: { classId: run.classId, status: RecordStatus.Active },
      order: { id: 'ASC' },
    });
    const text = transcript.trim();
    const candidates = students.flatMap((student) => {
      const names = [student.name, student.nickname].filter(Boolean) as string[];
      if (!names.some((name) => text.includes(name))) return [];
      const status = this.detectStatus(text, names);
      return [{ studentId: student.id, displayName: student.nickname || student.name, status, confidence: status ? 0.9 : 0.6 }];
    });
    return { transcript: text, candidates, requiresTeacherConfirmation: true };
  }

  async excludedStudentIds(runId: number) {
    const items = await this.records.find({ where: { classroomRunId: runId } });
    return new Set(
      items
        .filter((item) => [AttendanceStatus.Absent, AttendanceStatus.Leave].includes(item.status))
        .map((item) => item.studentId),
    );
  }

  private state(items: StudentAttendanceRecord[]) {
    return Object.fromEntries(items.map((item) => [item.studentId, item.status]));
  }

  private detectStatus(text: string, names: string[]): AttendanceStatus | null {
    const position = Math.max(...names.map((name) => text.indexOf(name)));
    const nearby = text.slice(Math.max(0, position - 8), position + 20);
    if (/请假|休假/.test(nearby)) return AttendanceStatus.Leave;
    if (/缺勤|没来|未到|不到/.test(nearby)) return AttendanceStatus.Absent;
    if (/迟到/.test(nearby)) return AttendanceStatus.Late;
    if (/到课|到了|出勤|在/.test(nearby)) return AttendanceStatus.Present;
    return null;
  }
}
