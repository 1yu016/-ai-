import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ResourceReviewStatus,
} from '../data/entities/teaching-resource.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { Student } from '../platform/entities/student.entity';
import {
  BindingStatus,
  DeviceStatus,
  DeviceType,
  RecordStatus,
} from '../platform/platform.types';
import { ResourceService } from '../resources/resource.service';
import {
  ClassroomCommandOperation,
  ClassroomCommandSource,
  ClassroomCommandStatus,
  MEDIA_CLASSROOM_COMMANDS,
} from './classroom-command.types';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import {
  ClassroomBreakContentType,
  ClassroomCheckpointType,
  ClassroomEventResult,
  ClassroomEventType,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from './classroom-run.types';
import { ClassroomRunService } from './classroom-run.service';
import { ExecuteClassroomCommandDto } from './dto/classroom-command.dto';
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { StudentRewardService } from './student-reward.service';
import { AttendanceService } from './attendance.service';
import {
  AttendanceChangeSource,
} from './entities/student-attendance-change.entity';
import {
  AttendanceStatus,
} from './entities/student-attendance-record.entity';
import {
  ClassroomRollCallRecord,
  RollCallMode,
} from './entities/classroom-roll-call-record.entity';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { StudentArtworkRecord } from '../artworks/entities/student-artwork-record.entity';
import { AuditService } from '../platform/audit.service';
import { AuditResult } from '../platform/platform.types';

type CommandRunState = ClassroomRun & {
  steps?: Array<{ stepIndex: number }>;
  serverNow?: string;
};

type JsonMap = Record<string, unknown>;

@Injectable()
export class ClassroomCommandService {
  private readonly runQueues = new Map<number, Promise<void>>();

  constructor(
    @InjectRepository(ClassroomCommandRecord)
    private readonly commands: Repository<ClassroomCommandRecord>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceBinding)
    private readonly bindings: Repository<DeviceBinding>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(ClassroomRollCallRecord)
    private readonly rollCalls: Repository<ClassroomRollCallRecord>,
    @InjectRepository(ClassroomEvent)
    private readonly events: Repository<ClassroomEvent>,
    @InjectRepository(StudentArtworkRecord)
    private readonly artworks: Repository<StudentArtworkRecord>,
    private readonly runs: ClassroomRunService,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly rewards: StudentRewardService,
    private readonly resources: ResourceService,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  async execute(actor: JwtTeacherPayload, dto: ExecuteClassroomCommandDto) {
    return this.executeQueued(actor, dto, false);
  }

  /**
   * 手机控制会话已经由 ClassroomMobileService 完成教师、课堂、二维码和
   * 目标大屏校验。这个内部入口仍走同一条幂等命令总线，只跳过“手机必须先
   * 注册成平台设备”的旧约束，避免把浏览器手机伪装成大屏设备。
   */
  async executeFromMobileSession(
    actor: JwtTeacherPayload,
    dto: ExecuteClassroomCommandDto,
  ) {
    if (dto.source !== ClassroomCommandSource.Mobile)
      throw new BadRequestException('手机控制会话只能提交 mobile 来源指令');
    return this.executeQueued(actor, dto, true);
  }

  private async executeQueued(
    actor: JwtTeacherPayload,
    dto: ExecuteClassroomCommandDto,
    mobileSessionValidated: boolean,
  ) {
    const previous = this.runQueues.get(dto.runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.runQueues.set(dto.runId, queued);
    await previous;
    try {
      return await this.executeSerialized(actor, dto, mobileSessionValidated);
    } finally {
      release();
      if (this.runQueues.get(dto.runId) === queued) this.runQueues.delete(dto.runId);
    }
  }

  private async executeSerialized(
    actor: JwtTeacherPayload,
    dto: ExecuteClassroomCommandDto,
    mobileSessionValidated: boolean,
  ) {
    const requestHash = this.requestHash(dto);
    const existing = await this.commands.findOne({
      where: { requestId: dto.requestId },
    });
    if (existing) return this.replay(existing, requestHash, actor);

    this.assertFreshMobileCommand(dto);

    let record: ClassroomCommandRecord;
    try {
      record = await this.commands.save(
        this.commands.create({
          requestId: dto.requestId,
          classroomRunId: dto.runId,
          requestHash,
          source: dto.source,
          operation: dto.operation,
          operatorType: actor.userType,
          operatorId: actor.sub,
          deviceId: dto.deviceId,
          targetDeviceId: dto.targetDeviceId ?? null,
          expectedVersion: dto.expectedVersion,
          parametersSummary: this.parametersSummary(dto.parameters),
          status: ClassroomCommandStatus.Processing,
          httpStatus: null,
          failureReason: null,
          responsePayload: null,
          executedAt: null,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const raced = await this.commands.findOne({
        where: { requestId: dto.requestId },
      });
      if (!raced) throw error;
      return this.replay(raced, requestHash, actor);
    }

    try {
      this.requireTeacher(actor);
      const before = (await this.runs.get(actor, dto.runId)) as CommandRunState;
      await this.requireSourceDevice(
        actor,
        before,
        dto,
        mobileSessionValidated,
      );
      this.assertTargetDevice(before, dto);
      if (before.version !== dto.expectedVersion)
        throw this.versionConflict(before);
      this.assertActive(before);

      const execution = await this.executeOperation(actor, before, dto);
      const latest = (await this.runs.get(actor, dto.runId)) as CommandRunState;
      const response = {
        requestId: dto.requestId,
        runId: dto.runId,
        operation: dto.operation,
        source: dto.source,
        targetDeviceId: dto.targetDeviceId ?? null,
        status: ClassroomCommandStatus.Success,
        result: execution,
        classroomState: latest,
      };
      await this.commands.update(record.id, {
        status: ClassroomCommandStatus.Success,
        httpStatus: 200,
        responsePayload: JSON.stringify(response),
        executedAt: new Date(),
      });
      await this.audit
        .write(actor, {
          action: 'classroom.command',
          targetType: 'classroom_run',
          targetId: dto.runId,
          metadata: {
            requestId: dto.requestId,
            source: dto.source,
            operation: dto.operation,
            targetDeviceId: dto.targetDeviceId ?? null,
            result: ClassroomCommandStatus.Success,
          },
        })
        .catch(() => undefined);
      return response;
    } catch (error) {
      const normalized = await this.normalizeError(actor, dto, error);
      await this.commands.update(record.id, {
        status:
          normalized.statusCode === 409
            ? ClassroomCommandStatus.Conflict
            : ClassroomCommandStatus.Failure,
        httpStatus: normalized.statusCode,
        failureReason: normalized.message.slice(0, 500),
        responsePayload: JSON.stringify(normalized.body),
        executedAt: new Date(),
      });
      await this.audit
        .write(actor, {
          action: 'classroom.command',
          targetType: 'classroom_run',
          targetId: dto.runId,
          result: AuditResult.Failure,
          metadata: {
            requestId: dto.requestId,
            source: dto.source,
            operation: dto.operation,
            targetDeviceId: dto.targetDeviceId ?? null,
            statusCode: normalized.statusCode,
            failureReason: normalized.message.slice(0, 200),
          },
        })
        .catch(() => undefined);
      throw new HttpException(normalized.body, normalized.statusCode);
    }
  }

  async findOne(actor: JwtTeacherPayload, requestId: string) {
    const record = await this.commands.findOne({ where: { requestId } });
    if (!record) throw new NotFoundException('课堂指令记录不存在');
    if (
      record.operatorType !== actor.userType ||
      record.operatorId !== actor.sub
    )
      throw new ForbiddenException('无权查看其他教师的课堂指令');
    return this.recordView(record);
  }

  private async executeOperation(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
  ): Promise<unknown> {
    const parameters = dto.parameters ?? {};
    const legacy = {
      requestId: dto.requestId,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
    };
    switch (dto.operation) {
      case ClassroomCommandOperation.PreviousStep:
        return this.runs.changeStep(actor, run.id, {
          ...legacy,
          stepIndex: run.currentStepIndex - 1,
        });
      case ClassroomCommandOperation.NextStep:
        return this.runs.changeStep(actor, run.id, {
          ...legacy,
          stepIndex: run.currentStepIndex + 1,
        });
      case ClassroomCommandOperation.SwitchStep:
        return this.runs.changeStep(actor, run.id, {
          ...legacy,
          stepIndex: this.int(parameters, 'stepIndex', 0),
        });
      case ClassroomCommandOperation.PauseClass:
        return this.runs.pause(actor, run.id, legacy);
      case ClassroomCommandOperation.ResumeClass:
        return this.runs.resume(actor, run.id, legacy);
      case ClassroomCommandOperation.CompleteClass:
        return this.runs.complete(actor, run.id, legacy);
      case ClassroomCommandOperation.CancelClass:
        return this.runs.cancel(actor, run.id, legacy);
      case ClassroomCommandOperation.StartBreak:
        {
          const rawContent =
            this.optionalString(parameters, 'contentType', 32) ??
            ClassroomBreakContentType.Water;
          if (
            !Object.values(ClassroomBreakContentType).includes(
              rawContent as ClassroomBreakContentType,
            )
          )
            throw new BadRequestException('不支持的课间内容');
        return this.runs.startBreak(actor, run.id, {
          ...legacy,
          durationSeconds: this.int(parameters, 'durationSeconds', 1, 1800),
          contentType: rawContent as ClassroomBreakContentType,
          idleProtectionSeconds: this.optionalInt(
            parameters,
            'idleProtectionSeconds',
            30,
            1800,
          ),
        });
        }
      case ClassroomCommandOperation.EndBreak:
        return this.runs.endBreak(actor, run.id, legacy);
      case ClassroomCommandOperation.AttendanceUpdate:
        return this.updateAttendance(actor, run, dto, parameters);
      case ClassroomCommandOperation.RandomRollCall:
      case ClassroomCommandOperation.SpecifiedRollCall:
      case ClassroomCommandOperation.GroupRollCall:
        return this.rollCall(actor, run, dto, parameters);
      case ClassroomCommandOperation.RewardStudent:
        return this.rewardStudent(actor, run, dto, parameters);
      case ClassroomCommandOperation.RevokeReward:
        return this.revokeReward(actor, run, dto, parameters);
      default:
        if (MEDIA_CLASSROOM_COMMANDS.has(dto.operation))
          return this.mediaCommand(actor, run, dto, parameters);
        throw new BadRequestException('不支持的课堂操作');
    }
  }

  private async updateAttendance(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const sourceValue = this.optionalString(parameters, 'attendanceSource', 32);
    const source = sourceValue === AttendanceChangeSource.VoiceConfirmed
      ? AttendanceChangeSource.VoiceConfirmed
      : sourceValue === AttendanceChangeSource.Batch
        ? AttendanceChangeSource.Batch
        : AttendanceChangeSource.Manual;
    const rawUpdates = Array.isArray(parameters.updates)
      ? parameters.updates
      : [{ studentId: parameters.studentId, status: parameters.status }];
    const updates = rawUpdates.map((raw) => {
      if (!raw || typeof raw !== 'object')
        throw new BadRequestException('考勤记录格式无效');
      const value = raw as JsonMap;
      const studentId = this.int(value, 'studentId', 1);
      const status = this.string(value, 'status') as AttendanceStatus;
      if (!Object.values(AttendanceStatus).includes(status))
        throw new BadRequestException('考勤状态仅支持 present、absent、late 或 leave');
      return { studentId, status };
    });
    const formal = await this.attendance.apply(actor, run, dto.requestId, updates, source);
    await this.runs.checkpoint(actor, run.id, {
      requestId: dto.requestId,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.RollCall,
      attendanceState: formal.attendanceState,
    });
    await this.events.save(this.events.create({
      classroomRunId: run.id,
      eventType: ClassroomEventType.Attendance,
      requestId: `${dto.requestId}:attendance`,
      operatorType: actor.userType,
      operatorId: actor.sub,
      deviceId: run.deviceId,
      payload: JSON.stringify({ updates, source }),
      result: ClassroomEventResult.Success,
    }));
    return { updates, ...formal };
  }

  private async rollCall(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const all = await this.students.find({
      where: { classId: run.classId, status: RecordStatus.Active },
      order: { id: 'ASC' },
    });
    if (!all.length) throw new ConflictException('当前班级没有可点名幼儿');
    const excluded = await this.attendance.excludedStudentIds(run.id);
    let candidates = all.filter((student) => !excluded.has(student.id));
    if (!candidates.length) throw new ConflictException('当前没有可点名的出勤幼儿');
    if (dto.operation === ClassroomCommandOperation.SpecifiedRollCall) {
      const student = parameters.studentId == null
        ? await this.requireStudentByName(run, this.string(parameters, 'studentName'))
        : await this.requireStudent(run, this.int(parameters, 'studentId', 1));
      if (excluded.has(student.id))
        throw new ConflictException('缺勤或请假幼儿不能被点名');
      candidates = [student];
    }
    if (dto.operation === ClassroomCommandOperation.GroupRollCall) {
      const ids = this.intArray(parameters, 'studentIds');
      if (!ids.length) throw new BadRequestException('分组点名必须提供 studentIds');
      const allowed = new Set(ids);
      const classMembers = all.filter((student) => allowed.has(student.id));
      if (classMembers.length !== allowed.size)
        throw new ForbiddenException('分组中包含本课堂之外的幼儿');
      candidates = classMembers.filter((student) => !excluded.has(student.id));
      if (!candidates.length) throw new ConflictException('该分组没有可点名的出勤幼儿');
    }

    const latest = await this.snapshots.loadLatestValid(run.id);
    const previous = latest?.rollCallState ?? {};
    const history = await this.rollCalls.find({
      where: { classroomRunId: run.id },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 50,
    });
    const counts = history.length
      ? history.reduce<Record<number, number>>((map, item) => {
          map[item.studentId] = (map[item.studentId] ?? 0) + 1;
          return map;
        }, {})
      : this.numericMap(previous.counts);
    const recent = history.length
      ? history.slice(0, 5).map((item) => item.studentId)
      : Array.isArray(previous.recentStudentIds)
        ? previous.recentStudentIds.filter((id): id is number => Number.isInteger(id))
        : [];
    const minCount = Math.min(...candidates.map((student) => counts[student.id] ?? 0));
    const fairPool = candidates.filter(
      (student) => (counts[student.id] ?? 0) === minCount,
    );
    const withoutLatest = fairPool.filter((student) => student.id !== recent[0]);
    const pool = withoutLatest.length ? withoutLatest : fairPool;
    const selected = pool[Math.floor(Math.random() * pool.length)]!;
    counts[selected.id] = (counts[selected.id] ?? 0) + 1;
    const rollCallState = {
      counts,
      recentStudentIds: [selected.id, ...recent.filter((id) => id !== selected.id)].slice(0, 5),
      lastStudentId: selected.id,
      lastStudentDisplayName: selected.nickname || selected.name,
      lastOperation: dto.operation,
      updatedAt: new Date().toISOString(),
    };
    await this.runs.checkpoint(actor, run.id, {
      requestId: dto.requestId,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.RollCall,
      rollCallState,
    });
    const mode = dto.operation === ClassroomCommandOperation.SpecifiedRollCall
      ? RollCallMode.Specified
      : dto.operation === ClassroomCommandOperation.GroupRollCall
        ? RollCallMode.GroupRandom
        : RollCallMode.Random;
    const formalRecord = await this.rollCalls.save(this.rollCalls.create({
      requestId: dto.requestId,
      classroomRunId: run.id,
      classId: run.classId,
      studentId: selected.id,
      teacherId: actor.sub,
      mode,
      groupKey: this.optionalString(parameters, 'groupKey', 100) ?? null,
      eligibleCount: candidates.length,
    }));
    await this.events.save(this.events.create({
      classroomRunId: run.id,
      eventType: ClassroomEventType.RollCall,
      requestId: `${dto.requestId}:roll-call`,
      operatorType: actor.userType,
      operatorId: actor.sub,
      deviceId: run.deviceId,
      payload: JSON.stringify({ recordId: formalRecord.id, studentId: selected.id, mode }),
      result: ClassroomEventResult.Success,
    }));
    return {
      recordId: formalRecord.id,
      student: { id: selected.id, displayName: selected.nickname || selected.name },
      rollCallState,
    };
  }

  private async rewardStudent(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const student = parameters.studentId == null
      ? await this.requireStudentByName(run, this.string(parameters, 'studentName'))
      : await this.requireStudent(run, this.int(parameters, 'studentId', 1));
    const studentId = student.id;
    const stars = this.optionalInt(parameters, 'stars', 1, 5) ?? 1;
    const reason = this.optionalString(parameters, 'reason', 200);
    const reward = await this.rewards.createReward(actor, run.id, {
      requestId: dto.requestId,
      studentId,
      stars,
      reason,
      points: this.optionalInt(parameters, 'points', 0, 20),
      rewardCategory: this.optionalString(parameters, 'rewardCategory', 32) as never,
      rewardForms: Array.isArray(parameters.rewardForms) ? parameters.rewardForms as never : undefined,
      badgeCode: this.optionalString(parameters, 'badgeCode', 64),
      praiseTemplateId: this.optionalString(parameters, 'praiseTemplateId', 64),
      praiseText: this.optionalString(parameters, 'praiseText', 120),
      teacherConfirmedPraise: parameters.teacherConfirmedPraise === true,
      animationKey: this.optionalString(parameters, 'animationKey', 32),
    });
    await this.runs.checkpoint(actor, run.id, {
      requestId: `${dto.requestId}:state`,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Reward,
      rewardState: reward.rewardState,
    });
    return reward;
  }

  private async revokeReward(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const reward = await this.rewards.revokeReward(
      actor,
      run.id,
      this.int(parameters, 'rewardRecordId', 1),
      dto.requestId,
      this.optionalString(parameters, 'reason', 200),
    );
    await this.runs.checkpoint(actor, run.id, {
      requestId: `${dto.requestId}:state`,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Reward,
      rewardState: reward.rewardState,
    });
    return reward;
  }

  private async mediaCommand(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const latest = await this.snapshots.loadLatestValid(run.id);
    const playerState = Object.assign({}, latest?.playerState);
    const resourceOperation = [
      ClassroomCommandOperation.OpenResource,
      ClassroomCommandOperation.PlayResource,
    ].includes(dto.operation);
    const resourceId = resourceOperation
      ? this.int(parameters, 'resourceId', 1)
      : this.optionalInt(parameters, 'resourceId', 1);
    if (resourceId != null) {
      const resource = await this.resources.getOne(actor, resourceId);
      if (resource.reviewStatus !== ResourceReviewStatus.Approved)
        throw new ConflictException('资源未审核通过，不能在正式课堂播放');
      playerState.resourceId = resourceId;
      playerState.resourceTitle = resource.title;
      delete playerState.artworkId;
      delete playerState.artworkFileUrl;
      delete playerState.artworkComment;
    }
    if (dto.operation === ClassroomCommandOperation.SetVolume)
      playerState.volume = this.number(parameters, 'volume', 0, 1);
    if (dto.operation === ClassroomCommandOperation.PreviousPage)
      playerState.pageIndex = Math.max(1, Number(playerState.pageIndex ?? 1) - 1);
    if (dto.operation === ClassroomCommandOperation.NextPage) {
      const current = Math.max(1, Number(playerState.pageIndex ?? 1));
      const total = Number(playerState.pageCount ?? Number.MAX_SAFE_INTEGER);
      playerState.pageIndex = Math.min(current + 1, total);
    }
    if (dto.operation === ClassroomCommandOperation.ZoomIn)
      playerState.zoom = Math.min(3, Number(playerState.zoom ?? 1) + 0.25);
    if (dto.operation === ClassroomCommandOperation.ZoomOut)
      playerState.zoom = Math.max(0.5, Number(playerState.zoom ?? 1) - 0.25);
    if (dto.operation === ClassroomCommandOperation.Mute) playerState.muted = true;
    if (dto.operation === ClassroomCommandOperation.Unmute) playerState.muted = false;
    if (dto.operation === ClassroomCommandOperation.SpeakText) {
      const text = this.string(parameters, 'text');
      if (text.length > 500) throw new BadRequestException('播报文本不能超过500字');
      playerState.ttsText = text;
    }
    if (dto.operation === ClassroomCommandOperation.StopMedia) {
      delete playerState.artworkId;
      delete playerState.artworkFileUrl;
      delete playerState.artworkComment;
      delete playerState.ttsText;
      playerState.status = 'stopped';
    }
    if (dto.operation === ClassroomCommandOperation.DisplayArtwork) {
      const artworkId = this.int(parameters, 'artworkId', 1);
      const artwork = await this.artworks.findOne({ where: { id: artworkId } });
      if (!artwork || artwork.classroomRunId !== run.id)
        throw new ForbiddenException('作品不属于当前课堂');
      if (!artwork.confirmedAt || !artwork.teacherComment)
        throw new ConflictException('作品评价尚未由教师确认，不能展示');
      playerState.artworkId = artwork.id;
      playerState.artworkFileUrl = `/artworks/${artwork.id}/file`;
      playerState.artworkComment = artwork.teacherComment;
      playerState.resourceId = null;
      playerState.status = 'artwork';
    }
    playerState.operation = dto.operation;
    playerState.targetDeviceId = dto.targetDeviceId;
    playerState.updatedAt = new Date().toISOString();
    await this.runs.checkpoint(actor, run.id, {
      requestId: dto.requestId,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Command,
      playerState,
    });
    return {
      delivery: 'accepted',
      targetDeviceId: dto.targetDeviceId,
      playerState,
    };
  }

  private async requireSourceDevice(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    mobileSessionValidated = false,
  ) {
    if (dto.source !== ClassroomCommandSource.Mobile) {
      if (dto.deviceId !== run.deviceId)
        throw new ForbiddenException('当前设备已失去课堂控制权');
      return;
    }
    if (mobileSessionValidated) {
      if (dto.deviceId !== run.deviceId)
        throw new ForbiddenException('手机控制会话与当前课堂大屏不一致');
      return;
    }
    const device = await this.devices.findOne({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('控制设备不存在');
    if (![DeviceType.TeacherPhone, DeviceType.TeacherTablet].includes(device.type))
      throw new ForbiddenException('该设备不是教师移动控制端');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ForbiddenException('控制设备当前不可用');
    if (actor.schoolId && device.schoolId !== actor.schoolId)
      throw new ForbiddenException('控制设备不属于当前园所');
    const binding = await this.bindings.findOne({
      where: {
        deviceId: dto.deviceId,
        classroomId: run.classroomId,
        classId: run.classId,
        status: BindingStatus.Active,
      },
    });
    if (!binding) throw new ForbiddenException('控制设备未绑定当前班级和教室');
  }

  private assertTargetDevice(
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
  ) {
    if (!MEDIA_CLASSROOM_COMMANDS.has(dto.operation)) return;
    if (!dto.targetDeviceId)
      throw new BadRequestException('媒体和TTS操作必须提供 targetDeviceId');
    if (dto.targetDeviceId !== run.deviceId)
      throw new ForbiddenException('目标设备不是当前课堂大屏');
  }

  private async requireStudent(run: CommandRunState, studentId: number) {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('学生不存在');
    if (student.classId !== run.classId)
      throw new ForbiddenException('不能操作本课堂之外的幼儿');
    if (student.status !== RecordStatus.Active)
      throw new ConflictException('学生已停用');
    return student;
  }

  private async requireStudentByName(run: CommandRunState, rawName: string) {
    const name = rawName.trim();
    const matches = await this.students.find({
      where: { classId: run.classId, status: RecordStatus.Active },
    });
    const exact = matches.filter(
      (student) => student.name === name || student.nickname === name,
    );
    if (!exact.length) throw new NotFoundException(`当前班级没有找到“${name}”`);
    if (exact.length > 1) throw new ConflictException(`“${name}”对应多名幼儿，请在面板中选择`);
    return exact[0]!;
  }

  private assertActive(run: CommandRunState) {
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    )
      throw new ConflictException('已结束课堂不能继续执行操作');
  }

  private assertFreshMobileCommand(dto: ExecuteClassroomCommandDto) {
    if (dto.source !== ClassroomCommandSource.Mobile) return;
    if (!dto.issuedAt || dto.ttlMs == null)
      throw new BadRequestException('手机指令必须提供 issuedAt 和 ttlMs');
    const issuedAt = Date.parse(dto.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 10_000)
      throw new BadRequestException('手机指令时间无效');
    if (Date.now() - issuedAt > dto.ttlMs)
      throw new HttpException('课堂指令已过期，未执行', 408);
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('管理员不能直接控制正在进行的课堂');
  }

  private versionConflict(latest: CommandRunState) {
    return new ConflictException({
      statusCode: 409,
      message: '课堂状态版本冲突，请使用最新状态重试',
      latestClassroomState: latest,
    });
  }

  private async normalizeError(
    actor: JwtTeacherPayload,
    dto: ExecuteClassroomCommandDto,
    error: unknown,
  ) {
    const statusCode = error instanceof HttpException ? error.getStatus() : 500;
    const response =
      error instanceof HttpException ? error.getResponse() : '课堂指令执行失败';
    const message = this.errorMessage(response);
    let latestClassroomState: unknown;
    if (statusCode === 409) {
      try {
        latestClassroomState = await this.runs.get(actor, dto.runId);
      } catch {
        latestClassroomState = undefined;
      }
    }
    const body =
      typeof response === 'object' && response !== null
        ? { ...response, ...(latestClassroomState ? { latestClassroomState } : {}) }
        : {
            statusCode,
            message,
            ...(latestClassroomState ? { latestClassroomState } : {}),
          };
    return { statusCode, message, body };
  }

  private replay(
    record: ClassroomCommandRecord,
    requestHash: string,
    actor: JwtTeacherPayload,
  ): unknown {
    if (
      record.operatorType !== actor.userType ||
      record.operatorId !== actor.sub
    )
      throw new ConflictException('该 requestId 已被其他操作者使用');
    if (record.requestHash !== requestHash)
      throw new ConflictException('同一 requestId 已用于不同的课堂指令');
    if (record.status === ClassroomCommandStatus.Processing)
      throw new ConflictException('该课堂指令正在处理中，请稍后查询结果');
    const payload = this.parseJson(record.responsePayload) ?? {
      statusCode: record.httpStatus ?? 500,
      message: record.failureReason ?? '课堂指令执行失败',
    };
    if (record.status === ClassroomCommandStatus.Success) return payload;
    throw new HttpException(payload, record.httpStatus ?? 500);
  }

  private recordView(record: ClassroomCommandRecord) {
    return {
      ...record,
      parametersSummary: this.parseJson(record.parametersSummary),
      responsePayload: this.parseJson(record.responsePayload),
    };
  }

  private requestHash(dto: ExecuteClassroomCommandDto) {
    return createHash('sha256')
      .update(this.stableJson(dto))
      .digest('hex');
  }

  private parametersSummary(parameters?: JsonMap) {
    if (!parameters) return null;
    const summary = { ...parameters };
    if (typeof summary.text === 'string')
      summary.text = `${summary.text.slice(0, 60)}${summary.text.length > 60 ? '…' : ''}`;
    return JSON.stringify(summary);
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const input = value as JsonMap;
      return `{${Object.keys(input)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(input[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  private int(input: JsonMap, key: string, min: number, max = Number.MAX_SAFE_INTEGER) {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new BadRequestException(`${key} 参数无效`);
    return value;
  }

  private optionalInt(input: JsonMap, key: string, min: number, max = Number.MAX_SAFE_INTEGER) {
    return input[key] == null ? undefined : this.int(input, key, min, max);
  }

  private number(input: JsonMap, key: string, min: number, max: number) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < min || value > max)
      throw new BadRequestException(`${key} 参数无效`);
    return value;
  }

  private string(input: JsonMap, key: string) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value) throw new BadRequestException(`${key} 参数不能为空`);
    return value;
  }

  private optionalString(input: JsonMap, key: string, maxLength: number) {
    if (input[key] == null) return undefined;
    const value = this.string(input, key);
    if (value.length > maxLength)
      throw new BadRequestException(`${key} 不能超过 ${maxLength} 字`);
    return value;
  }

  private intArray(input: JsonMap, key: string) {
    if (!Array.isArray(input[key])) return [];
    const values = input[key].map(Number);
    if (values.some((value) => !Number.isInteger(value) || value < 1))
      throw new BadRequestException(`${key} 参数无效`);
    return [...new Set(values)];
  }

  private numericMap(value: unknown): Record<number, number> {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value as JsonMap)
        .map(([key, item]) => [Number(key), Number(item)])
        .filter(([key, item]) => Number.isInteger(key) && Number.isFinite(item)),
    );
  }

  private errorMessage(response: unknown) {
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      return Array.isArray(message) ? message.join('；') : String(message);
    }
    return '课堂指令执行失败';
  }

  private parseJson(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private isUniqueViolation(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
