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
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ClassroomSnapshotReason,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from '../classroom-runs/classroom-run.types';
import { ClassroomSnapshotService } from '../classroom-runs/classroom-snapshot.service';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import {
  AttendanceChangeSource,
  AttendanceStatus,
  ROLL_CALL_ALGORITHM_VERSION,
  RollCallMode,
} from './classroom-participation.types';
import {
  AttendanceEntryDto,
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
    const result = await this.persistAttendance(
      actor,
      run,
      dto,
      AttendanceChangeSource.Manual,
    );
    await this.captureAttendance(runId);
    return result;
  }

  async batchAttendance(
    actor: JwtTeacherPayload,
    runId: number,
    dto: BatchAttendanceDto,
  ) {
    const run = await this.teacherRun(actor, runId, false);
    const unique = new Set(dto.entries.map((entry) => entry.studentId));
    if (unique.size !== dto.entries.length)
      throw new BadRequestException('批量考勤中学生重复');
    await this.requireStudentsInClass(run.classId, [...unique]);

    const result = await this.dataSource.transaction(async (manager) => {
      const prior = await manager.getRepository(AttendanceChangeLog).find({
        where: { classroomRunId: run.id, requestId: dto.requestId },
      });
      if (prior.length) {
        if (
          prior.length !== dto.entries.length ||
          prior.some((log) => !unique.has(log.studentId))
        )
          throw new ConflictException('requestId 已用于不同的批量考勤');
        return manager.getRepository(AttendanceRecord).find({
          where: { classroomRunId: run.id, studentId: In([...unique]) },
          order: { studentId: 'ASC' },
        });
      }
      const records: AttendanceRecord[] = [];
      for (const entry of dto.entries) {
        records.push(
          await this.persistAttendanceInManager(
            manager,
            actor,
            run,
            entry,
            dto.requestId,
            AttendanceChangeSource.Batch,
            null,
          ),
        );
      }
      return records;
    });
    await this.captureAttendance(runId);
    return { items: result };
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
        attendance: byStudent.get(student.id) ?? null,
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
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async attendanceChangeLogs(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    return this.attendanceLogs.find({
      where: { classroomRunId: runId },
      order: { id: 'DESC' },
    });
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
    const run = await this.teacherRun(actor, runId, true);
    const payload = this.verifyVoiceToken(dto.confirmationToken);
    if (payload.runId !== runId || payload.teacherId !== actor.sub)
      throw new ForbiddenException('语音确认凭证不属于当前课堂或教师');
    if (!payload.candidateIds.includes(dto.studentId))
      throw new BadRequestException('确认的学生不在语音候选中');
    const tokenHash = this.sha256(dto.confirmationToken);
    const used = await this.attendanceLogs.findOne({
      where: { confirmationTokenHash: tokenHash },
    });
    if (used) throw new ConflictException('语音确认凭证已使用');
    const result = await this.persistAttendance(
      actor,
      run,
      {
        studentId: dto.studentId,
        status: dto.status,
        note: dto.note,
        requestId: dto.requestId,
      },
      AttendanceChangeSource.VoiceConfirmed,
      tokenHash,
    );
    await this.captureAttendance(runId);
    return result;
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
    const run = await this.teacherRun(actor, runId, true);
    const duplicate = await this.rollCalls.findOne({
      where: { classroomRunId: run.id, requestId: dto.requestId },
    });
    if (duplicate) return this.rollCallResponse(duplicate);

    const allStudents = await this.classStudents(run.classId);
    const allIds = new Set(allStudents.map((student) => student.id));
    let scope = new Set(allIds);
    let groupId: number | null = null;
    if (dto.mode === RollCallMode.Range) {
      await this.requireStudentsInClass(run.classId, dto.studentIds ?? []);
      scope = new Set(dto.studentIds);
    } else if (dto.mode === RollCallMode.Group) {
      const group = await this.requireGroup(run.id, dto.groupId!);
      groupId = group.id;
      const members = await this.groupMembers.find({
        where: { groupId: group.id, active: true },
      });
      scope = new Set(members.map((member) => member.studentId));
    } else if (dto.mode === RollCallMode.TeacherSpecified) {
      await this.requireStudentsInClass(run.classId, [dto.specifiedStudentId!]);
      scope = new Set([dto.specifiedStudentId!]);
    }

    const attendance = await this.attendance.find({
      where: { classroomRunId: run.id },
    });
    const attendanceByStudent = new Map(
      attendance.map((record) => [record.studentId, record.status]),
    );
    const history = await this.rollCalls.find({
      where: { classroomRunId: run.id },
      order: { id: 'DESC' },
    });
    const cooldownCount = dto.cooldownCount ?? 2;
    const recent = history
      .slice(0, cooldownCount)
      .map((record) => record.selectedStudentId);
    const totalCounts = new Map<number, number>();
    const lastCalls = new Map<number, Date>();
    history.forEach((record) => {
      totalCounts.set(
        record.selectedStudentId,
        (totalCounts.get(record.selectedStudentId) ?? 0) + 1,
      );
      if (!lastCalls.has(record.selectedStudentId))
        lastCalls.set(record.selectedStudentId, record.createdAt);
    });
    const baseEligible = allStudents.filter((student) => {
      const status = attendanceByStudent.get(student.id);
      return (
        scope.has(student.id) &&
        status !== AttendanceStatus.Absent &&
        status !== AttendanceStatus.Leave
      );
    });
    if (!baseEligible.length)
      throw new ConflictException('没有可点名的在场幼儿');
    let pool = baseEligible.filter((student) => !recent.includes(student.id));
    const cooldownRelaxed = pool.length === 0;
    if (cooldownRelaxed) pool = baseEligible;
    const minimumCount = Math.min(
      ...pool.map((student) => totalCounts.get(student.id) ?? 0),
    );
    pool = pool.filter(
      (student) => (totalCounts.get(student.id) ?? 0) === minimumCount,
    );
    const selected = [...pool].sort(
      (a, b) =>
        this.stableNumber(`${dto.requestId}:${a.id}`) -
        this.stableNumber(`${dto.requestId}:${b.id}`),
    )[0];

    let record: RollCallRecord;
    try {
      record = await this.dataSource.transaction(async (manager) => {
        const recordRepo = manager.getRepository(RollCallRecord);
        const repeated = await recordRepo.findOne({
          where: { classroomRunId: run.id, requestId: dto.requestId },
        });
        if (repeated) return repeated;
        const saved = await recordRepo.save(
          recordRepo.create({
            classroomRunId: run.id,
            classId: run.classId,
            teacherId: actor.sub,
            requestId: dto.requestId,
            mode: dto.mode,
            groupId,
            selectedStudentId: selected.id,
            algorithmVersion: ROLL_CALL_ALGORITHM_VERSION,
            cooldownCount,
            source:
              dto.mode === RollCallMode.TeacherSpecified
                ? 'teacher'
                : 'fair_random',
          }),
        );
        await manager.getRepository(RollCallCandidateSnapshot).save(
          allStudents.map((student) => {
            const status = attendanceByStudent.get(student.id);
            let exclusionReason: string | null = null;
            let eligible = true;
            if (!scope.has(student.id)) {
              eligible = false;
              exclusionReason = 'outside_scope';
            } else if (status === AttendanceStatus.Absent) {
              eligible = false;
              exclusionReason = 'absent';
            } else if (status === AttendanceStatus.Leave) {
              eligible = false;
              exclusionReason = 'leave';
            } else if (!cooldownRelaxed && recent.includes(student.id)) {
              eligible = false;
              exclusionReason = 'cooldown';
            }
            return manager.getRepository(RollCallCandidateSnapshot).create({
              rollCallRecordId: saved.id,
              studentId: student.id,
              eligible,
              exclusionReason,
              recentCallCount: recent.filter((id) => id === student.id).length,
              totalCallCount: totalCounts.get(student.id) ?? 0,
              lastCalledAt: lastCalls.get(student.id) ?? null,
              selected: student.id === selected.id,
            });
          }),
        );
        return saved;
      });
    } catch (error) {
      const repeated = await this.rollCalls.findOne({
        where: { classroomRunId: run.id, requestId: dto.requestId },
      });
      if (repeated) return this.rollCallResponse(repeated);
      throw error;
    }
    await this.snapshots.capture(
      run.id,
      ClassroomSnapshotReason.RollCall,
      true,
      {
        rollCallState: {
          recordId: record.id,
          selectedStudentId: record.selectedStudentId,
          algorithmVersion: record.algorithmVersion,
        },
      },
    );
    return this.rollCallResponse(record);
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

  private async persistAttendance(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: SetAttendanceDto,
    source: AttendanceChangeSource,
    confirmationTokenHash: string | null = null,
  ) {
    await this.requireStudentsInClass(run.classId, [dto.studentId]);
    return this.dataSource.transaction((manager) =>
      this.persistAttendanceInManager(
        manager,
        actor,
        run,
        dto,
        dto.requestId,
        source,
        confirmationTokenHash,
      ),
    );
  }

  private async persistAttendanceInManager(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    entry: AttendanceEntryDto,
    requestId: string,
    source: AttendanceChangeSource,
    confirmationTokenHash: string | null,
  ) {
    const logRepo = manager.getRepository(AttendanceChangeLog);
    const duplicate = await logRepo.findOne({
      where: { classroomRunId: run.id, studentId: entry.studentId, requestId },
    });
    if (duplicate)
      return manager
        .getRepository(AttendanceRecord)
        .findOneByOrFail({ id: duplicate.attendanceRecordId });
    const repo = manager.getRepository(AttendanceRecord);
    let record = await repo.findOne({
      where: { classroomRunId: run.id, studentId: entry.studentId },
    });
    const previousStatus = record?.status ?? null;
    if (!record)
      record = repo.create({
        classroomRunId: run.id,
        classId: run.classId,
        studentId: entry.studentId,
      });
    Object.assign(record, {
      status: entry.status,
      note: entry.note?.trim() || null,
      updatedBy: actor.sub,
    });
    record = await repo.save(record);
    await logRepo.save(
      logRepo.create({
        attendanceRecordId: record.id,
        classroomRunId: run.id,
        classId: run.classId,
        studentId: entry.studentId,
        previousStatus,
        newStatus: entry.status,
        source,
        actorType: actor.userType,
        actorId: actor.sub,
        requestId,
        confirmationTokenHash,
        reason: entry.note?.trim() || null,
      }),
    );
    return record;
  }

  private async captureAttendance(runId: number) {
    const records = await this.attendance.find({
      where: { classroomRunId: runId },
    });
    const counts = Object.values(AttendanceStatus).reduce<
      Record<string, number>
    >((result, status) => {
      result[status] = records.filter(
        (record) => record.status === status,
      ).length;
      return result;
    }, {});
    await this.snapshots.capture(runId, ClassroomSnapshotReason.Timed, false, {
      attendanceState: { counts, updatedAt: new Date().toISOString() },
    });
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
      id: record.id,
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
