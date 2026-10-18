import { rejectLegacyWrite, withRecordIdentity } from '../classroom-runs/legacy-write-boundary';
import { AttendanceService } from '../classroom-runs/attendance.service';
import { AttendanceChangeSource as CanonicalAttendanceSource } from '../classroom-runs/entities/student-attendance-change.entity';
import { AttendanceStatus as CanonicalAttendanceStatus } from '../classroom-runs/entities/student-attendance-record.entity';
import { ClassroomRollCallService } from '../classroom-runs/classroom-roll-call.service';
import { RollCallMode as CanonicalRollCallMode } from '../classroom-runs/entities/classroom-roll-call-record.entity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from '../classroom-runs/classroom-run.types';
import { ClassroomSnapshotService } from '../classroom-runs/classroom-snapshot.service';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import {
  AttendanceStatus,
  RollCallMode,
} from './classroom-participation.types';
import {
  AttendanceHistoryQueryDto,
  BatchAttendanceDto,
  ConfirmVoiceAttendanceDto,
  CreateStudentGroupDto,
  GroupMemberDto,
  RandomGroupingDto,
  RollCallDto,
  SetAttendanceDto,
  UpdateStudentGroupDto,
  VoiceAttendanceRecognizeDto,
} from './dto/classroom-participation.dto';
import {
  AttendanceChangeLog,
  AttendanceRecord,
  RollCallCandidateSnapshot,
  RollCallRecord,
  StudentGroup,
  StudentGroupMember,
} from './entities';

type VoiceTokenPayload = {
  runId: number;
  teacherId: number;
  candidateIds: number[];
  suggestedStatus: AttendanceStatus;
  textHash: string;
  expiresAt: number;
};

type SafeStudent = Pick<
  Student,
  'id' | 'classId' | 'name' | 'nickname' | 'status'
>;

@Injectable()
export class ClassroomParticipationService {
  private readonly voiceSecret: string;

  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly attendance: Repository<AttendanceRecord>,
    @InjectRepository(AttendanceChangeLog)
    private readonly attendanceLogs: Repository<AttendanceChangeLog>,
    @InjectRepository(StudentGroup)
    private readonly groups: Repository<StudentGroup>,
    @InjectRepository(StudentGroupMember)
    private readonly groupMembers: Repository<StudentGroupMember>,
    @InjectRepository(RollCallRecord)
    private readonly rollCalls: Repository<RollCallRecord>,
    @InjectRepository(RollCallCandidateSnapshot)
    private readonly candidateSnapshots: Repository<RollCallCandidateSnapshot>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly access: PlatformAccessService,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly canonicalAttendance: AttendanceService,
    private readonly canonicalRollCalls: ClassroomRollCallService,
  ) {
    this.voiceSecret =
      this.config.get<string>('JWT_ACCESS_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      'local-development-voice-confirmation-secret';
  }

  async setAttendance(
    actor: JwtTeacherPayload,
    runId: number,
    dto: SetAttendanceDto,
  ) {
    const run = await this.teacherRun(actor, runId, false);
    await this.assertNoLegacyAttendanceRequest(runId, dto.requestId);
    const result = await this.canonicalAttendance.apply(actor, run, dto.requestId,
      [{ studentId: dto.studentId, status: dto.status as unknown as CanonicalAttendanceStatus, note: dto.note }],
      CanonicalAttendanceSource.Manual, { mode: 'single' });
    const record = withRecordIdentity(result.items.find(r => r.studentId === dto.studentId)!, 'canonical', 'attendance');
    return { ...record, note: result.updates[0]!.note, updatedBy: record.modifiedByTeacherId,
      ...result, record };
  }

  async batchAttendance(
    actor: JwtTeacherPayload,
    runId: number,
    dto: BatchAttendanceDto,
  ) {
    const run = await this.teacherRun(actor, runId, false);
    await this.assertNoLegacyAttendanceRequest(runId, dto.requestId);
    const result = await this.canonicalAttendance.apply(actor, run, dto.requestId,
      dto.entries.map(entry => ({ ...entry, status: entry.status as unknown as CanonicalAttendanceStatus })),
      CanonicalAttendanceSource.Batch, { mode: 'batch' });
    return { ...result, items: result.updates.map(update => {
      const record = withRecordIdentity(result.items.find(r => r.studentId === update.studentId)!, 'canonical', 'attendance');
      return { ...record, note: update.note, updatedBy: record.modifiedByTeacherId };
    }) };
  }

  private async assertNoLegacyAttendanceRequest(runId: number, requestId: string) {
    // A legacy audit has no canonical receipt. Never repeat it as a new fact.
    if (await this.attendanceLogs.existsBy({ classroomRunId: runId, requestId }))
      rejectLegacyWrite('participation.attendance.legacyRequest');
  }

  async listAttendance(actor: JwtTeacherPayload, runId: number) {
    const run = await this.readableRun(actor, runId);
    const [students, records] = await Promise.all([
      this.classStudents(run.classId),
      this.attendance.find({ where: { classroomRunId: run.id } }),
    ]);
    const byStudent = new Map(
      records.map((record) => [record.studentId, record]),
    );
    return {
      classroomRunId: run.id,
      items: students.map((student) => ({
        student,
        attendance: byStudent.has(student.id) ? withRecordIdentity(byStudent.get(student.id)!, 'legacy_participation', 'attendance') : null,
      })),
    };
  }

  async attendanceHistory(
    actor: JwtTeacherPayload,
    studentId: number,
    query: AttendanceHistoryQueryDto,
  ) {
    const student = await this.access.requireStudentAccess(actor, studentId);
    const [items, total] = await this.attendance.findAndCount({
      where: { studentId, classId: student.classId },
      order: { updatedAt: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items: items.map(r => withRecordIdentity(r, 'legacy_participation', 'attendance')), total, page: query.page, pageSize: query.pageSize };
  }

  async attendanceChangeLogs(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    return (await this.attendanceLogs.find({
      where: { classroomRunId: runId },
      order: { id: 'DESC' },
    })).map(r => withRecordIdentity(r, 'legacy_participation', 'attendance_change'));
  }

  async recognizeVoice(
    actor: JwtTeacherPayload,
    runId: number,
    dto: VoiceAttendanceRecognizeDto,
  ) {
    const run = await this.teacherRun(actor, runId, true);
    const students = await this.classStudents(run.classId);
    const normalized = this.normalizeSpeech(dto.text);
    const exact = students.filter((student) =>
      [student.name, student.nickname]
        .filter(Boolean)
        .some((name) => normalized.includes(this.normalizeSpeech(name!))),
    );
    const spokenName = normalized.replace(
      /请假|休假|迟到|缺席|没来|不在|到了|到校|来了|签到|出勤/g,
      '',
    );
    const similar = exact.length
      ? []
      : students
          .map((student) => ({
            student,
            distance: Math.min(
              this.levenshtein(spokenName, this.normalizeSpeech(student.name)),
              student.nickname
                ? this.levenshtein(
                    spokenName,
                    this.normalizeSpeech(student.nickname),
                  )
                : 99,
            ),
          }))
          .filter(
            (item) =>
              item.distance <= Math.max(1, Math.floor(spokenName.length / 3)),
          )
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 5)
          .map((item) => item.student);
    const candidates = exact.length ? exact : similar;
    const suggestedStatus = this.voiceAttendanceStatus(
      normalized,
      dto.defaultStatus,
    );
    if (!candidates.length) {
      return {
        status: 'pending_unmatched',
        suggestedStatus,
        candidates: [],
        confirmationToken: null,
        message: '未匹配到班级幼儿，请教师手动确认',
      };
    }
    const token = this.signVoiceToken({
      runId,
      teacherId: actor.sub,
      candidateIds: candidates.map((student) => student.id),
      suggestedStatus,
      textHash: this.sha256(dto.text),
      expiresAt: Date.now() + 5 * 60_000,
    });
    return {
      status: 'pending_confirmation',
      suggestedStatus,
      candidates: candidates.map((student) => ({
        id: student.id,
        name: student.name,
        nickname: student.nickname,
        matchType: exact.length ? 'exact' : 'similar',
      })),
      confirmationToken: token,
      message: '语音识别结果不会直接修改考勤，请教师确认',
    };
  }

  async confirmVoice(
    actor: JwtTeacherPayload,
    runId: number,
    dto: ConfirmVoiceAttendanceDto,
  ) {
    await this.teacherRun(actor, runId, false);
    void dto;
    return rejectLegacyWrite('participation.confirmVoice');
  }

  async createGroup(
    actor: JwtTeacherPayload,
    runId: number,
    dto: CreateStudentGroupDto,
  ) {
    const run = await this.teacherRun(actor, runId, true);
    const ids = dto.studentIds ?? [];
    await this.requireStudentsInClass(run.classId, ids);
    try {
      const group = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(StudentGroup);
        const created = await repo.save(
          repo.create({
            classroomRunId: run.id,
            classId: run.classId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            sortOrder: dto.sortOrder ?? 0,
            membershipSnapshot: JSON.stringify(ids),
            batchRequestId: dto.requestId,
            createdBy: actor.sub,
          }),
        );
        if (ids.length)
          await manager.getRepository(StudentGroupMember).save(
            ids.map((studentId) =>
              manager.getRepository(StudentGroupMember).create({
                groupId: created.id,
                studentId,
                active: true,
                addedBy: actor.sub,
                addedAt: new Date(),
                removedAt: null,
              }),
            ),
          );
        return created;
      });
      return this.groupResponse(group);
    } catch (error) {
      const existing = await this.groups.findOne({
        where: { classroomRunId: run.id, batchRequestId: dto.requestId },
      });
      if (existing) return this.groupResponse(existing);
      if (this.isUniqueViolation(error))
        throw new ConflictException('分组名称已存在');
      throw error;
    }
  }

  async updateGroup(
    actor: JwtTeacherPayload,
    runId: number,
    groupId: number,
    dto: UpdateStudentGroupDto,
  ) {
    await this.teacherRun(actor, runId, true);
    const group = await this.requireGroup(runId, groupId);
    if (dto.name !== undefined) group.name = dto.name.trim();
    if (dto.description !== undefined)
      group.description = dto.description.trim() || null;
    if (dto.sortOrder !== undefined) group.sortOrder = dto.sortOrder;
    try {
      return this.groupResponse(await this.groups.save(group));
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('分组名称已存在');
      throw error;
    }
  }

  async deleteGroup(actor: JwtTeacherPayload, runId: number, groupId: number) {
    await this.teacherRun(actor, runId, true);
    const group = await this.requireGroup(runId, groupId);
    await this.groups.softRemove(group);
    return { deleted: true, id: group.id };
  }

  async listGroups(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    const groups = await this.groups.find({
      where: { classroomRunId: runId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return {
      items: await Promise.all(
        groups.map((group) => this.groupResponse(group)),
      ),
    };
  }

  async addGroupMember(
    actor: JwtTeacherPayload,
    runId: number,
    groupId: number,
    dto: GroupMemberDto,
  ) {
    const run = await this.teacherRun(actor, runId, true);
    const group = await this.requireGroup(runId, groupId);
    await this.requireStudentsInClass(run.classId, [dto.studentId]);
    let member = await this.groupMembers.findOne({
      where: { groupId, studentId: dto.studentId },
    });
    if (!member)
      member = this.groupMembers.create({
        groupId,
        studentId: dto.studentId,
        active: true,
        addedBy: actor.sub,
        addedAt: new Date(),
        removedAt: null,
      });
    else if (!member.active)
      Object.assign(member, {
        active: true,
        addedBy: actor.sub,
        addedAt: new Date(),
        removedAt: null,
      });
    await this.groupMembers.save(member);
    await this.refreshGroupSnapshot(group);
    return this.groupResponse(group);
  }

  async removeGroupMember(
    actor: JwtTeacherPayload,
    runId: number,
    groupId: number,
    studentId: number,
  ) {
    await this.teacherRun(actor, runId, true);
    const group = await this.requireGroup(runId, groupId);
    const member = await this.groupMembers.findOne({
      where: { groupId, studentId, active: true },
    });
    if (!member) throw new NotFoundException('分组成员不存在');
    member.active = false;
    member.removedAt = new Date();
    await this.groupMembers.save(member);
    await this.refreshGroupSnapshot(group);
    return this.groupResponse(group);
  }

  async randomGroups(
    actor: JwtTeacherPayload,
    runId: number,
    dto: RandomGroupingDto,
  ) {
    const run = await this.teacherRun(actor, runId, true);
    const existing = await this.groups.find({
      where: { classroomRunId: run.id, batchRequestId: dto.requestId },
      order: { sortOrder: 'ASC' },
    });
    if (existing.length)
      return {
        items: await Promise.all(
          existing.map((group) => this.groupResponse(group)),
        ),
      };
    const students = await this.classStudents(run.classId);
    const selectedIds = dto.studentIds ?? students.map((student) => student.id);
    if (selectedIds.length < dto.groupCount)
      throw new BadRequestException('学生数量不能少于分组数量');
    await this.requireStudentsInClass(run.classId, selectedIds);
    const ordered = [...selectedIds].sort(
      (a, b) =>
        this.stableNumber(`${dto.requestId}:${a}`) -
        this.stableNumber(`${dto.requestId}:${b}`),
    );
    const names =
      dto.names ??
      Array.from({ length: dto.groupCount }, (_, index) => `第${index + 1}组`);
    if (names.length !== dto.groupCount || new Set(names).size !== names.length)
      throw new BadRequestException('分组名称数量必须与分组数一致且不能重复');
    const created = await this.dataSource.transaction(async (manager) => {
      const result: StudentGroup[] = [];
      for (let index = 0; index < dto.groupCount; index += 1) {
        const memberIds = ordered.filter(
          (_, position) => position % dto.groupCount === index,
        );
        const group = await manager.getRepository(StudentGroup).save(
          manager.getRepository(StudentGroup).create({
            classroomRunId: run.id,
            classId: run.classId,
            name: names[index].trim(),
            description: '课堂随机分组快照',
            sortOrder: index,
            membershipSnapshot: JSON.stringify(memberIds),
            batchRequestId: dto.requestId,
            createdBy: actor.sub,
          }),
        );
        await manager.getRepository(StudentGroupMember).save(
          memberIds.map((studentId) =>
            manager.getRepository(StudentGroupMember).create({
              groupId: group.id,
              studentId,
              active: true,
              addedBy: actor.sub,
              addedAt: new Date(),
              removedAt: null,
            }),
          ),
        );
        result.push(group);
      }
      return result;
    });
    return {
      items: await Promise.all(
        created.map((group) => this.groupResponse(group)),
      ),
    };
  }

  async rollCall(actor: JwtTeacherPayload, runId: number, dto: RollCallDto) {
    await this.teacherRun(actor, runId, false);
    // Legacy fair-v1 cools before fairness and hashes requestId. Canonical
    // fair-v1 applies fairness first and draws inside the transaction.
    // Never substitute algorithms or fabricate a legacy candidateSnapshot.
    if (dto.mode !== RollCallMode.TeacherSpecified || dto.groupId != null || dto.studentIds != null)
      return rejectLegacyWrite('participation.rollCall.randomSemantics');
    if (await this.rollCalls.existsBy({ classroomRunId: runId, requestId: dto.requestId }))
      return rejectLegacyWrite('participation.rollCall.legacyRequest');
    const result = await this.canonicalRollCalls.execute(actor, runId, dto.requestId, {
      mode: CanonicalRollCallMode.Specified, studentId: dto.specifiedStudentId,
      cooldownCount: dto.cooldownCount ?? 2, algorithmVersion: 'fair-v1',
    });
    return { ...result, ...withRecordIdentity({ id: result.recordId }, 'canonical', 'roll_call'),
      classroomRunId: runId, mode: dto.mode, selectedStudent: result.student };
  }

  async listRollCalls(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    const items = await this.rollCalls.find({
      where: { classroomRunId: runId },
      order: { id: 'DESC' },
    });
    return {
      items: await Promise.all(
        items.map((item) => this.rollCallResponse(item)),
      ),
    };
  }







  private async teacherRun(
    actor: JwtTeacherPayload,
    runId: number,
    requireActive: boolean,
  ) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('该操作仅限负责课堂的教师');
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作其他教师的课堂');
    await this.access.requireClassAccess(actor, run.classId);
    if (
      requireActive &&
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as never)
    )
      throw new ConflictException('已结束课堂不能执行该操作');
    return run;
  }

  private async readableRun(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    if (!this.access.isAdministrator(actor) && run.teacherId !== actor.sub)
      throw new ForbiddenException('无权查询其他教师的课堂');
    return run;
  }

  private async classStudents(classId: number): Promise<SafeStudent[]> {
    return this.students
      .createQueryBuilder('student')
      .select([
        'student.id',
        'student.classId',
        'student.name',
        'student.nickname',
        'student.status',
      ])
      .where('student.classId = :classId', { classId })
      .andWhere('student.status = :status', { status: RecordStatus.Active })
      .orderBy('student.id', 'ASC')
      .getMany();
  }

  private async requireStudentsInClass(classId: number, studentIds: number[]) {
    const ids = [...new Set(studentIds)];
    if (!ids.length) return;
    const count = await this.students.count({
      where: { id: In(ids), classId, status: RecordStatus.Active },
    });
    if (count !== ids.length)
      throw new BadRequestException('存在不属于当前班级或已停用的学生');
  }

  private async requireGroup(runId: number, groupId: number) {
    const group = await this.groups.findOne({
      where: { id: groupId, classroomRunId: runId, deletedAt: IsNull() },
    });
    if (!group) throw new NotFoundException('课堂分组不存在');
    return group;
  }

  private async refreshGroupSnapshot(group: StudentGroup) {
    const members = await this.groupMembers.find({
      where: { groupId: group.id, active: true },
      order: { id: 'ASC' },
    });
    group.membershipSnapshot = JSON.stringify(
      members.map((member) => member.studentId),
    );
    await this.groups.save(group);
  }

  private async groupResponse(group: StudentGroup) {
    const members = await this.groupMembers.find({
      where: { groupId: group.id, active: true },
      order: { id: 'ASC' },
    });
    const students = members.length
      ? await this.students
          .createQueryBuilder('student')
          .select(['student.id', 'student.name', 'student.nickname'])
          .where('student.id IN (:...ids)', {
            ids: members.map((member) => member.studentId),
          })
          .getMany()
      : [];
    return {
      id: group.id,
      classroomRunId: group.classroomRunId,
      classId: group.classId,
      name: group.name,
      description: group.description,
      sortOrder: group.sortOrder,
      memberSnapshot: this.parseIds(group.membershipSnapshot),
      members: students.map((student) => ({
        id: student.id,
        name: student.name,
        nickname: student.nickname,
      })),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  private async rollCallResponse(record: RollCallRecord) {
    const student = await this.students
      .createQueryBuilder('student')
      .select(['student.id', 'student.name', 'student.nickname'])
      .where('student.id = :id', { id: record.selectedStudentId })
      .getOne();
    const snapshots = await this.candidateSnapshots.find({
      where: { rollCallRecordId: record.id },
      order: { studentId: 'ASC' },
    });
    return {
      ...withRecordIdentity({ id: record.id }, 'legacy_participation', 'roll_call'),
      classroomRunId: record.classroomRunId,
      mode: record.mode,
      selectedStudent: student,
      algorithmVersion: record.algorithmVersion,
      cooldownCount: record.cooldownCount,
      requestId: record.requestId,
      createdAt: record.createdAt,
      candidateSnapshot: snapshots.map((item) => ({
        studentId: item.studentId,
        eligible: item.eligible,
        exclusionReason: item.exclusionReason,
        recentCallCount: item.recentCallCount,
        totalCallCount: item.totalCallCount,
        selected: item.selected,
      })),
    };
  }

  private voiceAttendanceStatus(text: string, fallback?: AttendanceStatus) {
    if (/请假|休假/.test(text)) return AttendanceStatus.Leave;
    if (/缺席|没来|不在/.test(text)) return AttendanceStatus.Absent;
    if (/迟到/.test(text)) return AttendanceStatus.Late;
    if (/到了|到校|来了|签到|出勤/.test(text)) return AttendanceStatus.Present;
    return fallback ?? AttendanceStatus.Present;
  }

  private signVoiceToken(payload: VoiceTokenPayload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${createHmac('sha256', this.voiceSecret).update(encoded).digest('base64url')}`;
  }

  private verifyVoiceToken(token: string): VoiceTokenPayload {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature)
      throw new BadRequestException('语音确认凭证无效');
    const expected = createHmac('sha256', this.voiceSecret)
      .update(encoded)
      .digest('base64url');
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new BadRequestException('语音确认凭证无效');
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as VoiceTokenPayload;
      if (
        !Array.isArray(payload.candidateIds) ||
        payload.expiresAt < Date.now()
      )
        throw new BadRequestException('语音确认凭证已过期');
      return payload;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('语音确认凭证无效');
    }
  }

  private normalizeSpeech(value: string) {
    return value
      .toLowerCase()
      .replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, '');
  }

  private levenshtein(a: string, b: string) {
    const rows = Array.from({ length: a.length + 1 }, () =>
      Array<number>(b.length + 1).fill(0),
    );
    for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return rows[a.length][b.length];
  }

  private stableNumber(value: string) {
    return Number.parseInt(
      createHash('sha256').update(value).digest('hex').slice(0, 12),
      16,
    );
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private parseIds(value: string): number[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is number => Number.isInteger(item))
        : [];
    } catch {
      return [];
    }
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Error && /unique|constraint/i.test(error.message);
  }
}
