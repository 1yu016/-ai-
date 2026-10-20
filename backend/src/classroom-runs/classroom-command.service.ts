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
import { EntityManager, Repository } from 'typeorm';
import { GuardianConsent } from '../platform/entities/guardian-consent.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { ConsentStatus, ConsentType } from '../platform/platform.types';
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
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from './classroom-run.types';
import { ClassroomRunService } from './classroom-run.service';
import { ExecuteClassroomCommandDto } from './dto/classroom-command.dto';
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { StudentRewardService } from './student-reward.service';
import { ClassroomRollCallService, type RollCallInput } from './classroom-roll-call.service';
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
import { StudentArtworkRecord } from '../artworks/entities/student-artwork-record.entity';
import { AuditService } from '../platform/audit.service';
import { AuditResult } from '../platform/platform.types';
import { commandPolicyOperation } from './classroom-operation-policy';

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
    @InjectRepository(StudentArtworkRecord)
    private readonly artworks: Repository<StudentArtworkRecord>,
    private readonly runs: ClassroomRunService,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly rewards: StudentRewardService,
    private readonly resources: ResourceService,
    private readonly attendance: AttendanceService,
    private readonly rollCallService: ClassroomRollCallService,
    private readonly audit: AuditService,
    private readonly access: PlatformAccessService,
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
    if (dto.operation === ClassroomCommandOperation.DisplayArtwork ||
        (dto.operation === ClassroomCommandOperation.SpeakText && dto.parameters?.artworkId != null))
      return this.executeArtwork(actor, dto, mobileSessionValidated);
    const requestHash = this.requestHash(dto);
    const existing = await this.commands.findOne({
      where: { requestId: dto.requestId },
    });
    if (existing) {
      if ([ClassroomCommandOperation.RewardStudent, ClassroomCommandOperation.RevokeReward].includes(existing.operation))
        await this.rewards.assertRewardReceiptAccess(actor, existing.classroomRunId);
      if (existing.operation === ClassroomCommandOperation.AttendanceUpdate)
        await this.attendance.assertReceiptAccess(actor, existing.classroomRunId);
      if (this.isRollCall(existing.operation)) await this.rollCallService.assertReceiptAccess(actor, existing.classroomRunId);
      return this.replay(existing, this.compatibleDomainHash(existing, dto, requestHash), actor, dto);
    }

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
      if ([ClassroomCommandOperation.RewardStudent, ClassroomCommandOperation.RevokeReward].includes(raced.operation))
        await this.rewards.assertRewardReceiptAccess(actor, raced.classroomRunId);
      if (raced.operation === ClassroomCommandOperation.AttendanceUpdate)
        await this.attendance.assertReceiptAccess(actor, raced.classroomRunId);
      if (this.isRollCall(raced.operation)) await this.rollCallService.assertReceiptAccess(actor, raced.classroomRunId);
      return this.replay(raced, this.compatibleDomainHash(raced, dto, requestHash), actor, dto);
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

  /** Artwork only: admission, Processing, control, required snapshot and final
   * success share one transaction. Never enter the run queue or snapshot gate twice. */
  private async executeArtwork(actor: JwtTeacherPayload, dto: ExecuteClassroomCommandDto, mobileSessionValidated: boolean) {
    return this.snapshots.transactionRequired(async manager => {
      await manager.query('UPDATE classroom_run SET version=version WHERE id=?', [dto.runId]);
      this.requireTeacher(actor);
      const run = await manager.getRepository(ClassroomRun).findOneBy({ id: dto.runId });
      if (!run) throw new NotFoundException('课堂运行不存在');
      if (run.teacherId !== actor.sub) throw new ForbiddenException('不能操作其他教师的课堂');
      await this.access.requireClassAccess(actor, run.classId, manager, { readOnly: true });
      const repository = manager.getRepository(ClassroomCommandRecord);
      const existing = await repository.findOneBy({ requestId: dto.requestId });
      if (existing) return this.replay(existing, this.requestHash(dto), actor, dto);
      this.assertFreshMobileCommand(dto);
      const artwork = await manager.getRepository(StudentArtworkRecord).findOneBy({ id: this.int(dto.parameters ?? {}, 'artworkId', 1) });
      if (!artwork || artwork.teacherId !== actor.sub || artwork.classroomRunId !== run.id || artwork.classId !== run.classId)
        throw new ForbiddenException('作品不属于当前教师、班级和课堂');
      if (!artwork.confirmedAt || !artwork.teacherComment) throw new ConflictException('作品评价尚未由教师确认');
      const student = artwork.studentId == null ? null : await manager.getRepository(Student).findOneBy({ id: artwork.studentId });
      if (!student || student.classId !== run.classId || student.status !== RecordStatus.Active)
        throw new ForbiddenException('作品学生已停用或不属于当前班级');
      const consents = await manager.getRepository(GuardianConsent).findBy({ studentId: student.id });
      const granted = new Set(consents.filter(c => c.status === ConsentStatus.Granted).map(c => c.consentType));
      if (!granted.has(ConsentType.Photo) || !granted.has(ConsentType.Artwork))
        throw new ForbiddenException({ code: 'ARTWORK_CONSENT_REQUIRED', message: '照片或作品授权已撤销，不能新增展示或朗读命令' });
      await this.requireSourceDevice(actor, run, dto, mobileSessionValidated, manager);
      this.assertTargetDevice(run, dto);
      if (run.version !== dto.expectedVersion) throw this.versionConflict(run);
      this.assertActive(run);
      const record = await repository.save(repository.create({
        requestId: dto.requestId, classroomRunId: run.id, requestHash: this.requestHash(dto), source: dto.source,
        operation: dto.operation, operatorType: actor.userType, operatorId: actor.sub, deviceId: dto.deviceId,
        targetDeviceId: dto.targetDeviceId ?? null, expectedVersion: dto.expectedVersion,
        parametersSummary: this.parametersSummary(dto.parameters), status: ClassroomCommandStatus.Processing,
      }));
      const result = await this.mediaCommand(actor, run, dto, dto.parameters ?? {}, manager);
      const response = { requestId: dto.requestId, runId: run.id, operation: dto.operation, source: dto.source,
        targetDeviceId: dto.targetDeviceId ?? null, status: ClassroomCommandStatus.Success, result,
        classroomState: await this.runs.readCommandState(actor, run.id, manager) };
      await repository.update(record.id, { status: ClassroomCommandStatus.Success, httpStatus: 200,
        responsePayload: JSON.stringify(response), executedAt: new Date() });
      await this.audit.write(actor, { action: 'classroom.command', targetType: 'classroom_run', targetId: run.id,
        metadata: { requestId: dto.requestId, operation: dto.operation, result: 'success' } }, manager);
      return response;
    });
  }

  async findOne(actor: JwtTeacherPayload, requestId: string) {
    const record = await this.commands.findOne({ where: { requestId } });
    if (!record) throw new NotFoundException('课堂指令记录不存在');
    if (
      record.operatorType !== actor.userType ||
      record.operatorId !== actor.sub
    )
      throw new ForbiddenException('无权查看其他教师的课堂指令');
    if (record.operation === ClassroomCommandOperation.DisplayArtwork ||
        (record.operation === ClassroomCommandOperation.SpeakText && (this.parseJson(record.parametersSummary) as JsonMap | null)?.artworkId != null)) {
      const run = await this.commands.manager.getRepository(ClassroomRun).findOneByOrFail({ id: record.classroomRunId });
      await this.access.requireClassAccess(actor, run.classId, undefined, { readOnly: true });
    }
    return this.recordView(record);
  }

  private async executeOperation(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
  ): Promise<unknown> {
    const operation = commandPolicyOperation(dto.operation);
    if (operation) await this.runs.assertOperation(actor, run.id, operation);
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
      case ClassroomCommandOperation.UpdatePresentationQueue:
        return this.updatePresentationQueue(actor, run, dto, parameters);
      case ClassroomCommandOperation.SetPresentation:
        return this.setPresentation(actor, run, dto, parameters);
      default:
        if (MEDIA_CLASSROOM_COMMANDS.has(dto.operation))
          return this.mediaCommand(actor, run, dto, parameters);
        throw new BadRequestException('不支持的课堂操作');
    }
  }

  private async updatePresentationQueue(
    actor: JwtTeacherPayload, run: CommandRunState,
    dto: ExecuteClassroomCommandDto, parameters: JsonMap,
  ) {
    const stepIndex = this.int(parameters, 'stepIndex', 0);
    if (!run.steps?.some((step) => step.stepIndex === stepIndex))
      throw new BadRequestException('课堂环节不存在');
    if (!Array.isArray(parameters.items) || parameters.items.length > 100)
      throw new BadRequestException('课堂队列最多包含100项');
    const ids = new Set<string>();
    const items: JsonMap[] = [];
    for (const raw of parameters.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new BadRequestException('课堂队列格式无效');
      const input = raw as JsonMap;
      const id = this.string(input, 'id');
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id) || ids.has(id))
        throw new BadRequestException('队列项编号无效或重复');
      ids.add(id);
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
        throw new BadRequestException('队列显示状态无效');
      if (input.kind === 'avatar') {
        items.push({ id, kind: 'avatar', title: '数字人互动', enabled: input.enabled !== false });
      } else if (input.kind === 'resource') {
        const resourceId = this.int(input, 'resourceId', 1);
        const resource = await this.resources.getOne(actor, resourceId);
        if (resource.reviewStatus !== ResourceReviewStatus.Approved)
          throw new ConflictException('资源未审核通过，不能加入课堂队列');
        items.push({ id, kind: 'resource', resourceId, title: resource.title, enabled: input.enabled !== false });
      } else throw new BadRequestException('不支持的课堂队列内容');
    }
    const latest = await this.snapshots.loadLatestValid(run.id);
    const previous = latest?.interactionState ?? {};
    const queues = previous.presentationQueues && typeof previous.presentationQueues === 'object'
      ? previous.presentationQueues as JsonMap : {};
    await this.runs.checkpointControl(actor, run.id, {
      requestId: dto.requestId, version: dto.expectedVersion, deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Command,
      interactionState: { ...previous, presentationQueues: { ...queues, [String(stepIndex)]: items } },
    });
    // Editing the queue deliberately does not patch playerState or LessonPlan.
    return { stepIndex, items };
  }

  private async setPresentation(
    actor: JwtTeacherPayload, run: CommandRunState,
    dto: ExecuteClassroomCommandDto, parameters: JsonMap,
  ) {
    const mode = this.string(parameters, 'mode');
    if (mode !== 'avatar')
      throw new BadRequestException('不支持的课堂展示模式');
    const latest = await this.snapshots.loadLatestValid(run.id);
    const playerState = { ...latest?.playerState, presentationMode: mode,
      status: 'stopped', operation: dto.operation, presentationCommandId: dto.requestId,
      presentationItemId: this.optionalString(parameters, 'presentationItemId', 100) ?? null, updatedAt: new Date().toISOString() };
    // Keep the last resource and page as a return point; mode selects what is shown.
    await this.runs.checkpointControl(actor, run.id, {
      requestId: dto.requestId, version: dto.expectedVersion, deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Command, playerState,
    });
    return { delivery: 'accepted', playerState };
  }

  private async updateAttendance(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    const payload = this.attendancePayload(parameters);
    return this.attendance.apply(actor, run, dto.requestId, payload.updates, payload.source, {
      expectedVersion: dto.expectedVersion, mode: payload.mode, confirmed: payload.confirmed,
    });
  }

  private attendancePayload(parameters: JsonMap) {
    const source = (parameters.attendanceSource ?? AttendanceChangeSource.Manual) as AttendanceChangeSource;
    const batch = Array.isArray(parameters.updates);
    if (parameters.updates !== undefined && !batch) throw new BadRequestException('考勤记录格式无效');
    const raw = batch ? parameters.updates as unknown[] : [parameters];
    const updates = raw.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('考勤记录格式无效');
      const value = item as JsonMap;
      return { studentId: this.int(value, 'studentId', 1), status: value.status as AttendanceStatus,
        note: value.note as string | null | undefined };
    });
    return this.attendance.normalize(updates, source, {
      mode: batch ? 'batch' : 'single', confirmed: parameters.confirmed as boolean | undefined,
    });
  }

  private async rollCall(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
  ) {
    return this.rollCallService.execute(actor, run.id, dto.requestId,
      this.rollCallPayload(dto.operation, parameters), dto.expectedVersion);
  }

  private isRollCall(operation: ClassroomCommandOperation) {
    return [ClassroomCommandOperation.RandomRollCall, ClassroomCommandOperation.SpecifiedRollCall,
      ClassroomCommandOperation.GroupRollCall].includes(operation);
  }

  private rollCallPayload(operation: ClassroomCommandOperation, parameters: JsonMap) {
    const mode = operation === ClassroomCommandOperation.SpecifiedRollCall ? RollCallMode.Specified
      : operation === ClassroomCommandOperation.GroupRollCall ? RollCallMode.GroupRandom : RollCallMode.Random;
    return this.rollCallService.normalize({ ...parameters, mode } as RollCallInput);
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
    const reward = await this.rewards.createReward(actor, run.id, {
      ...this.rewardInput(dto, parameters),
      studentId,
    });
    return reward;
  }

  private rewardInput(dto: ExecuteClassroomCommandDto, parameters: JsonMap) {
    return {
      version: dto.expectedVersion, requestId: dto.requestId,
      stars: this.optionalInt(parameters, 'stars', 1, 5) ?? 1,
      reason: this.optionalString(parameters, 'reason', 200),
      points: this.optionalInt(parameters, 'points', 0, 20),
      rewardCategory: this.optionalString(parameters, 'rewardCategory', 32) as never,
      rewardForms: Array.isArray(parameters.rewardForms) ? parameters.rewardForms as never : undefined,
      badgeCode: this.optionalString(parameters, 'badgeCode', 64),
      praiseTemplateId: this.optionalString(parameters, 'praiseTemplateId', 64),
      praiseText: this.optionalString(parameters, 'praiseText', 120),
      teacherConfirmedPraise: parameters.teacherConfirmedPraise === true,
      animationKey: this.optionalString(parameters, 'animationKey', 32),
    };
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
      dto.expectedVersion,
    );
    return reward;
  }

  private async mediaCommand(
    actor: JwtTeacherPayload,
    run: CommandRunState,
    dto: ExecuteClassroomCommandDto,
    parameters: JsonMap,
    transactionManager?: EntityManager,
  ) {
    const latest = await this.snapshots.loadLatestValid(run.id, transactionManager);
    const playerState = Object.assign({}, latest?.playerState);
    playerState.presentationCommandId = dto.requestId;
    if (dto.operation === ClassroomCommandOperation.OpenResource || dto.operation === ClassroomCommandOperation.PlayResource)
      playerState.presentationItemId = this.optionalString(parameters, 'presentationItemId', 100) ?? null;
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
      if (resourceOperation) {
        playerState.presentationMode = 'resource';
        playerState.pageIndex = 1;
        playerState.currentTime = 0;
        playerState.status = dto.operation === ClassroomCommandOperation.PlayResource ? 'playing' : 'paused';
        playerState.autoPlay = dto.operation === ClassroomCommandOperation.PlayResource;
      }
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
    if (dto.operation === ClassroomCommandOperation.PauseMedia) playerState.status = 'paused';
    if (dto.operation === ClassroomCommandOperation.ResumeMedia) playerState.status = 'playing';
    if (dto.operation === ClassroomCommandOperation.DisplayArtwork) {
      const artworkId = this.int(parameters, 'artworkId', 1);
      const artwork = await (transactionManager ? transactionManager.getRepository(StudentArtworkRecord) : this.artworks).findOne({ where: { id: artworkId } });
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
    await this.runs.checkpointControl(actor, run.id, {
      requestId: dto.requestId,
      version: dto.expectedVersion,
      deviceId: run.deviceId,
      checkpointType: ClassroomCheckpointType.Command,
      playerState,
    }, transactionManager);
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
    manager?: EntityManager,
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
    const device = await (manager ? manager.getRepository(Device) : this.devices).findOne({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('控制设备不存在');
    if (![DeviceType.TeacherPhone, DeviceType.TeacherTablet].includes(device.type))
      throw new ForbiddenException('该设备不是教师移动控制端');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ForbiddenException('控制设备当前不可用');
    if (actor.schoolId && device.schoolId !== actor.schoolId)
      throw new ForbiddenException('控制设备不属于当前园所');
    const binding = await (manager ? manager.getRepository(DeviceBinding) : this.bindings).findOne({
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

  private async replay(
    record: ClassroomCommandRecord,
    requestHash: string,
    actor: JwtTeacherPayload,
    dto: ExecuteClassroomCommandDto,
  ): Promise<unknown> {
    if (
      record.operatorType !== actor.userType ||
      record.operatorId !== actor.sub
    )
      throw new ConflictException('该 requestId 已被其他操作者使用');
    if (record.requestHash !== requestHash)
      throw new ConflictException('同一 requestId 已用于不同的课堂指令');
    if (record.status !== ClassroomCommandStatus.Success) {
      const recovered = await this.recoverCommittedBusiness(actor, record, dto);
      if (recovered) return recovered;
    }
    if (record.status === ClassroomCommandStatus.Processing)
      throw new ConflictException('该课堂指令正在处理中，请稍后查询结果');
    const payload = this.parseJson(record.responsePayload) ?? {
      statusCode: record.httpStatus ?? 500,
      message: record.failureReason ?? '课堂指令执行失败',
    };
    if (record.status === ClassroomCommandStatus.Success) return payload;
    throw new HttpException(payload, record.httpStatus ?? 500);
  }

  /** Read-only reconciliation. Never execute a command or mutate a durable receipt. */
  private async recoverCommittedBusiness(actor: JwtTeacherPayload, record: ClassroomCommandRecord,
    dto: ExecuteClassroomCommandDto) {
    const parameters = dto.parameters ?? {};
    let receipt;
    if (record.operation === ClassroomCommandOperation.RewardStudent) {
      receipt = await this.rewards.readCommandReceipt(actor, record.classroomRunId, record.requestId, {
        ...this.rewardInput(dto, parameters),
        studentId: parameters.studentId == null ? undefined : this.int(parameters, 'studentId', 1),
      });
    } else if (record.operation === ClassroomCommandOperation.RevokeReward) {
      receipt = await this.rewards.readRevokeCommandReceipt(actor, record.classroomRunId, record.requestId,
        this.int(parameters, 'rewardRecordId', 1), this.optionalString(parameters, 'reason', 200));
    } else if (record.operation === ClassroomCommandOperation.AttendanceUpdate) {
      const payload = this.attendancePayload(parameters);
      receipt = await this.attendance.readCommandReceipt(actor, record.classroomRunId, record.requestId,
        payload.updates, payload.source, { mode: payload.mode, confirmed: payload.confirmed });
    } else if (this.isRollCall(record.operation)) {
      receipt = await this.rollCallService.readCommandReceipt(actor, record.classroomRunId, record.requestId,
        this.rollCallPayload(record.operation, parameters));
    }
    if (!receipt) return null;
    // Canonical digests intentionally exclude transport expectedVersion: an already
    // committed request remains replayable after the Run advances or terminates.
    // Run.get() can settle a timed break. Use a plain read, never synthesize the lost original response.
    const currentClassroomState = await this.commands.manager.getRepository(ClassroomRun)
      .findOneBy({ id: record.classroomRunId });
    return {
      requestId: record.requestId, runId: record.classroomRunId, operation: record.operation,
      source: record.source, targetDeviceId: record.targetDeviceId,
      status: ClassroomCommandStatus.Success, result: receipt.result,
      classroomState: null, currentClassroomState,
      recovery: { source: 'canonical_business_receipt', contractVersion: 1,
        committedRunVersion: receipt.committedRunVersion, refreshRequired: true },
    };
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
      .update(this.stableJson(dto.operation === ClassroomCommandOperation.AttendanceUpdate
        ? { ...dto, parameters: this.attendancePayload(dto.parameters ?? {}) }
        : this.isRollCall(dto.operation) ? { ...dto, parameters: this.rollCallPayload(dto.operation, dto.parameters ?? {}) } : dto))
      .digest('hex');
  }

  private compatibleDomainHash(record: ClassroomCommandRecord, dto: ExecuteClassroomCommandDto, current: string) {
    // Pre-3C transport receipts used the unnormalised envelope. Exact retries may
    // replay them, but never synthesize a canonical receipt or execute again.
    if ((record.operation === ClassroomCommandOperation.AttendanceUpdate || this.isRollCall(record.operation)) &&
        record.requestHash === createHash('sha256').update(this.stableJson(dto)).digest('hex'))
      return record.requestHash;
    return current;
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
