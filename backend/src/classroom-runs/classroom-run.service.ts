import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AvatarService } from '../avatars/avatar.service';
import { AvatarConfigurationService } from '../avatars/avatar-configuration.service';
import {
  CancelClassroomAvatarBindingDto,
  SetClassroomAvatarBindingDto,
} from '../avatars/dto/avatar-config.dto';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ResourceReviewStatus,
  TeachingResource,
} from '../data/entities/teaching-resource.entity';
import type { LessonStepAction } from '../lesson-plans/entities/lesson-step-action.entity';
import type { LessonStep } from '../lesson-plans/entities/lesson-step.entity';
import { LessonPlanService } from '../lesson-plans/lesson-plan.service';
import { Classroom } from '../platform/entities/classroom.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import {
  BindingStatus,
  DeviceStatus,
  RecordStatus,
} from '../platform/platform.types';
import { ResourceService } from '../resources/resource.service';
import {
  allowedClassroomRunTransitions,
  assertClassroomRunTransition,
} from './classroom-run.state-machine';
import {
  ClassroomSnapshotService,
  type ClassroomSnapshotPatch,
  type ValidClassroomSnapshot,
} from './classroom-snapshot.service';
import {
  ACTIVE_CLASSROOM_RUN_STATUSES,
  ClassroomCheckpointType,
  ClassroomEventResult,
  ClassroomEventType,
  ClassroomRunStatus,
  ClassroomSnapshotReason,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from './classroom-run.types';
import {
  ClassroomCheckpointDto,
  ChangeClassroomStepDto,
  ClassroomRunOperationDto,
  RecoverClassroomRunDto,
  StartClassroomRunDto,
  TakeoverClassroomRunDto,
} from './dto/classroom-run.dto';
import { ClassroomDeviceTransfer } from './entities/classroom-device-transfer.entity';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomRunStepSnapshot } from './entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from './entities/classroom-run.entity';

type SnapshotSourceStep = LessonStep & {
  actions?: LessonStepAction[];
  recoveryPoint?: Record<string, unknown> | null;
};

@Injectable()
export class ClassroomRunService {
  constructor(
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomRunStepSnapshot)
    private readonly snapshots: Repository<ClassroomRunStepSnapshot>,
    @InjectRepository(ClassroomEvent)
    private readonly events: Repository<ClassroomEvent>,
    @InjectRepository(ClassroomDeviceTransfer)
    private readonly transfers: Repository<ClassroomDeviceTransfer>,
    @InjectRepository(DeviceBinding)
    private readonly bindings: Repository<DeviceBinding>,
    @InjectRepository(Classroom)
    private readonly classrooms: Repository<Classroom>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly dataSource: DataSource,
    private readonly access: PlatformAccessService,
    private readonly lessonPlans: LessonPlanService,
    private readonly resources: ResourceService,
    private readonly snapshotService: ClassroomSnapshotService,
    private readonly avatars: AvatarService,
    private readonly avatarConfiguration: AvatarConfigurationService,
  ) {}

  async start(actor: JwtTeacherPayload, dto: StartClassroomRunDto) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.Start,
    );
    if (duplicate) return this.get(actor, duplicate.classroomRunId);

    const schoolClass = await this.access.requireClassAccess(
      actor,
      dto.classId,
    );
    if (schoolClass.status !== RecordStatus.Active)
      throw new ConflictException('班级已停用，不能开始课堂');
    const plan = await this.lessonPlans.get(actor, dto.lessonPlanId);
    if (!plan.steps.length) throw new BadRequestException('空教案不能开始课堂');
    await this.validateResources(actor, plan.steps);
    await this.requireValidBinding(dto);
    if (dto.avatarVersionId)
      await this.avatars.requireReadyForClassroom(actor, dto.avatarVersionId);
    else
      await this.avatarConfiguration.resolveVersionReference(actor, {
        classId: dto.classId,
        lessonPlanId: dto.lessonPlanId,
      });

    try {
      const runId = await this.dataSource.transaction(async (manager) => {
        const eventRepo = manager.getRepository(ClassroomEvent);
        const repeated = await eventRepo.findOne({
          where: {
            operatorType: actor.userType,
            operatorId: actor.sub,
            requestId: dto.requestId,
          },
        });
        if (repeated) {
          if (repeated.eventType !== ClassroomEventType.Start)
            throw new ConflictException('requestId 已用于其他课堂操作');
          return repeated.classroomRunId;
        }
        await this.requireValidBinding(dto, manager);
        await this.requireApprovedResources(
          manager,
          plan.steps
            .map((step) => step.resourceId)
            .filter((value): value is number => value != null),
        );
        const effectiveAvatar = dto.avatarVersionId
          ? await this.avatars.requireReadyForClassroom(
              actor,
              dto.avatarVersionId,
              manager,
            )
          : await this.avatarConfiguration.resolveVersionReference(
              actor,
              { classId: dto.classId, lessonPlanId: dto.lessonPlanId },
              manager,
            );
        const effectiveAvatarReference = effectiveAvatar
          ? 'character' in effectiveAvatar
            ? {
                characterId: effectiveAvatar.character.id,
                versionId: effectiveAvatar.version.id,
              }
            : effectiveAvatar
          : null;
        await this.ensureNoActiveConflict(manager, dto.classId, dto.deviceId);
        const now = new Date();
        const runRepo = manager.getRepository(ClassroomRun);
        let run = await runRepo.save(
          runRepo.create({
            lessonPlanId: plan.id,
            lessonPlanVersion: plan.version,
            teacherId: actor.sub,
            classId: dto.classId,
            classroomId: dto.classroomId,
            deviceId: dto.deviceId,
            avatarCharacterId: effectiveAvatarReference?.characterId ?? null,
            avatarVersionId: effectiveAvatarReference?.versionId ?? null,
            title: plan.title,
            status: ClassroomRunStatus.Prepared,
            currentStepIndex: 0,
            startedAt: null,
            pausedAt: null,
            resumedAt: null,
            endedAt: null,
            elapsedSeconds: 0,
            version: 1,
          }),
        );
        await manager.getRepository(ClassroomRunStepSnapshot).save(
          plan.steps.map((source, index) => {
            const step = source as SnapshotSourceStep;
            return manager.getRepository(ClassroomRunStepSnapshot).create({
              classroomRunId: run.id,
              originalStepId: step.id,
              stepIndex: index,
              title: step.title,
              type: step.stepType,
              content: step.content ?? step.instruction,
              expectedResponse: step.expectedResponse,
              teacherTip: step.teacherTip,
              durationSeconds: step.durationSeconds,
              resourceId: step.resourceId,
              actionConfig: step.actions?.length
                ? JSON.stringify(
                    step.actions.map((action) => ({
                      actionType: action.actionType,
                      actionName: action.actionName,
                      content: action.content,
                      targetStudentId: action.targetStudentId,
                      sortOrder: action.sortOrder,
                    })),
                  )
                : null,
              recoveryPointConfig: step.recoveryPoint
                ? JSON.stringify(step.recoveryPoint)
                : null,
            });
          }),
        );
        assertClassroomRunTransition(
          ClassroomRunStatus.Prepared,
          ClassroomRunStatus.Running,
        );
        run.status = ClassroomRunStatus.Running;
        run.startedAt = now;
        run.resumedAt = now;
        run = await runRepo.save(run);
        await this.writeEvent(
          manager,
          actor,
          run,
          ClassroomEventType.Start,
          dto,
          dto.requestId,
        );
        return run.id;
      });
      await this.snapshotService.capture(
        runId,
        ClassroomSnapshotReason.Start,
        true,
      );
      return this.get(actor, runId);
    } catch (error) {
      const repeated = await this.findDuplicate(
        actor,
        dto.requestId,
        ClassroomEventType.Start,
      );
      if (repeated) return this.get(actor, repeated.classroomRunId);
      if (this.isUniqueViolation(error))
        throw new ConflictException('该班级或设备已经存在进行中的课堂');
      throw error;
    }
  }

  async pause(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomRunOperationDto,
  ) {
    return this.transition(
      actor,
      id,
      dto,
      ClassroomRunStatus.Paused,
      ClassroomEventType.Pause,
    );
  }

  async resume(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomRunOperationDto,
  ) {
    return this.transition(
      actor,
      id,
      dto,
      ClassroomRunStatus.Running,
      ClassroomEventType.Resume,
    );
  }

  async complete(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomRunOperationDto,
  ) {
    return this.transition(
      actor,
      id,
      dto,
      ClassroomRunStatus.Completed,
      ClassroomEventType.Complete,
    );
  }

  async cancel(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomRunOperationDto,
  ) {
    return this.transition(
      actor,
      id,
      dto,
      ClassroomRunStatus.Cancelled,
      ClassroomEventType.Cancel,
    );
  }

  async changeStep(
    actor: JwtTeacherPayload,
    id: number,
    dto: ChangeClassroomStepDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.ChangeStep,
      id,
    );
    if (duplicate) {
      const current = await this.ownedRun(actor, id);
      this.assertCurrentDevice(current, dto.deviceId);
      return this.get(actor, id);
    }
    await this.ownedRun(actor, id);
    try {
      await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const run = await runRepo.findOne({ where: { id } });
        if (!run) throw new NotFoundException('课堂运行不存在');
        this.assertOwner(actor, run);
        this.assertCurrentDevice(run, dto.deviceId);
        if (run.version !== dto.version) throw this.versionConflict();
        if (run.status === ClassroomRunStatus.Paused)
          throw new ConflictException('课堂暂停时不能切换步骤');
        if (run.status !== ClassroomRunStatus.Running)
          throw new ConflictException('只有运行中的课堂可以切换步骤');
        const exists = await manager
          .getRepository(ClassroomRunStepSnapshot)
          .exists({ where: { classroomRunId: id, stepIndex: dto.stepIndex } });
        if (!exists) throw new BadRequestException('步骤索引不存在');
        const update = await runRepo.update(
          { id, version: dto.version, status: ClassroomRunStatus.Running },
          { currentStepIndex: dto.stepIndex, version: dto.version + 1 },
        );
        if (update.affected !== 1) throw this.versionConflict();
        const updated = await runRepo.findOneByOrFail({ id });
        await this.writeEvent(
          manager,
          actor,
          updated,
          ClassroomEventType.ChangeStep,
          {
            stepIndex: dto.stepIndex,
            status: updated.status,
            version: updated.version,
          },
          dto.requestId,
        );
      });
      await this.snapshotService.capture(
        id,
        ClassroomSnapshotReason.ChangeStep,
        false,
      );
      return this.get(actor, id);
    } catch (error) {
      const repeated = await this.findDuplicate(
        actor,
        dto.requestId,
        ClassroomEventType.ChangeStep,
        id,
      );
      if (repeated) return this.get(actor, id);
      throw error;
    }
  }

  async get(actor: JwtTeacherPayload, id: number) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, id);
    const steps = await this.snapshots.find({
      where: { classroomRunId: id },
      order: { stepIndex: 'ASC' },
    });
    return this.response(run, steps);
  }

  async active(actor: JwtTeacherPayload, deviceId?: number) {
    this.requireTeacher(actor);
    const runs = await this.runs.find({
      where: {
        teacherId: actor.sub,
        status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]),
        ...(deviceId ? { deviceId } : {}),
      },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(
      runs.map(async (run) => {
        await this.access.requireClassAccess(actor, run.classId);
        return this.response(run);
      }),
    );
  }

  async restore(actor: JwtTeacherPayload, id: number, deviceId: number) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, id);
    this.assertCurrentDevice(run, deviceId);
    const steps = await this.snapshots.find({
      where: { classroomRunId: id },
      order: { stepIndex: 'ASC' },
    });
    const valid = await this.snapshotService.loadLatestValid(id);
    const elapsedSeconds = this.snapshotService.currentElapsed(run);
    const base = this.response(run, steps);
    if (!valid)
      return {
        ...base,
        latestSnapshotVersion: null,
        playedResourceIds: [],
        attendanceState: {},
        rollCallState: {},
        rewardState: {},
        interactionState: {},
        playerRecoverySuggestion: {
          autoPlay: false,
          message: '没有可用快照，请教师人工确认课堂状态',
        },
        timing: this.timing(run, elapsedSeconds),
        allowedActions: this.allowedActions(run.status),
        manualInterventionRequired: true,
      };
    const currentStep = steps.find(
      (step) => step.stepIndex === valid.entity.currentStepIndex,
    );
    return {
      ...base,
      status: run.status,
      currentStepIndex: valid.entity.currentStepIndex,
      currentStep: currentStep
        ? {
            ...currentStep,
            actionConfig: this.parseJson(currentStep.actionConfig),
            recoveryPointConfig: this.parseJson(
              currentStep.recoveryPointConfig,
            ),
          }
        : null,
      latestSnapshotVersion: valid.entity.snapshotVersion,
      snapshotReason: valid.entity.reason,
      playedResourceIds: valid.playedResourceIds,
      attendanceState: valid.attendanceState,
      rollCallState: valid.rollCallState,
      rewardState: valid.rewardState,
      interactionState: valid.interactionState,
      playerRecoverySuggestion: {
        ...valid.playerState,
        autoPlay: false,
        completedResourceIds: valid.playedResourceIds,
      },
      timing: this.timing(run, elapsedSeconds),
      allowedActions: this.allowedActions(run.status),
      manualInterventionRequired: false,
    };
  }

  async takeover(
    actor: JwtTeacherPayload,
    id: number,
    dto: TakeoverClassroomRunDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.Takeover,
      id,
    );
    if (duplicate) {
      const current = await this.ownedRun(actor, id);
      return this.restore(actor, id, current.deviceId);
    }
    const run = await this.ownedRun(actor, id);
    this.assertActive(run);
    if (run.deviceId !== dto.oldDeviceId)
      throw new ConflictException('旧设备已不再拥有课堂控制权');
    await this.requireTakeoverDevice(actor, run, dto);
    try {
      await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const current = await runRepo.findOne({ where: { id } });
        if (!current) throw new NotFoundException('课堂运行不存在');
        this.assertOwner(actor, current);
        this.assertActive(current);
        if (current.deviceId !== dto.oldDeviceId)
          throw new ConflictException('旧设备已不再拥有课堂控制权');
        if (current.version !== dto.version) throw this.versionConflict();
        const update = await runRepo.update(
          { id, version: dto.version, deviceId: dto.oldDeviceId },
          { deviceId: dto.newDeviceId, version: dto.version + 1 },
        );
        if (update.affected !== 1) throw this.versionConflict();
        const updated = await runRepo.findOneByOrFail({ id });
        await manager.getRepository(ClassroomDeviceTransfer).save(
          manager.getRepository(ClassroomDeviceTransfer).create({
            classroomRunId: id,
            oldDeviceId: dto.oldDeviceId,
            newDeviceId: dto.newDeviceId,
            operatorId: actor.sub,
            reason: dto.reason.trim(),
          }),
        );
        await this.writeEvent(
          manager,
          actor,
          updated,
          ClassroomEventType.Takeover,
          {
            oldDeviceId: dto.oldDeviceId,
            newDeviceId: dto.newDeviceId,
            reason: dto.reason.trim(),
            version: updated.version,
          },
          dto.requestId,
        );
      });
      await this.snapshotService.capture(
        id,
        ClassroomSnapshotReason.Takeover,
        true,
      );
      return this.restore(actor, id, dto.newDeviceId);
    } catch (error) {
      const repeated = await this.findDuplicate(
        actor,
        dto.requestId,
        ClassroomEventType.Takeover,
        id,
      );
      if (repeated) {
        const current = await this.ownedRun(actor, id);
        return this.restore(actor, id, current.deviceId);
      }
      throw error;
    }
  }

  async recover(
    actor: JwtTeacherPayload,
    id: number,
    dto: RecoverClassroomRunDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.Recover,
      id,
    );
    if (duplicate) {
      const current = await this.ownedRun(actor, id);
      this.assertCurrentDevice(current, dto.deviceId);
      return this.restore(actor, id, dto.deviceId);
    }
    const run = await this.ownedRun(actor, id);
    this.assertCurrentDevice(run, dto.deviceId);
    this.assertActive(run);
    const valid = await this.snapshotService.loadLatestValid(id);
    if (!valid) return this.restore(actor, id, dto.deviceId);
    await this.dataSource.transaction(async (manager) => {
      const runRepo = manager.getRepository(ClassroomRun);
      const current = await runRepo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('课堂运行不存在');
      this.assertOwner(actor, current);
      this.assertCurrentDevice(current, dto.deviceId);
      this.assertActive(current);
      if (current.version !== dto.version) throw this.versionConflict();
      const elapsedSeconds = Math.max(
        valid.entity.elapsedSeconds,
        this.snapshotService.currentElapsed(current),
      );
      const now = new Date();
      const update = await runRepo.update(
        { id, version: dto.version, deviceId: dto.deviceId },
        {
          currentStepIndex: valid.entity.currentStepIndex,
          elapsedSeconds,
          resumedAt: current.status === ClassroomRunStatus.Running ? now : null,
          version: dto.version + 1,
        },
      );
      if (update.affected !== 1) throw this.versionConflict();
      const updated = await runRepo.findOneByOrFail({ id });
      await this.writeEvent(
        manager,
        actor,
        updated,
        ClassroomEventType.Recover,
        {
          restoredSnapshotVersion: valid.entity.snapshotVersion,
          version: updated.version,
        },
        dto.requestId,
      );
    });
    await this.snapshotService.capture(
      id,
      ClassroomSnapshotReason.Recover,
      true,
      this.patchFromSnapshot(valid),
    );
    return this.restore(actor, id, dto.deviceId);
  }

  async checkpoint(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomCheckpointDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.Checkpoint,
      id,
    );
    if (duplicate) {
      const current = await this.ownedRun(actor, id);
      this.assertCurrentDevice(current, dto.deviceId);
      return this.restore(actor, id, dto.deviceId);
    }
    const run = await this.ownedRun(actor, id);
    this.assertCurrentDevice(run, dto.deviceId);
    this.assertActive(run);
    if (
      dto.checkpointType === ClassroomCheckpointType.ResourceCompleted &&
      !dto.resourceId
    )
      throw new BadRequestException('资源播放完成必须提供resourceId');
    if (dto.resourceId) {
      const belongs = await this.snapshots.exists({
        where: { classroomRunId: id, resourceId: dto.resourceId },
      });
      if (!belongs) throw new BadRequestException('资源不属于当前课堂快照');
    }
    await this.dataSource.transaction(async (manager) => {
      const runRepo = manager.getRepository(ClassroomRun);
      const current = await runRepo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('课堂运行不存在');
      this.assertOwner(actor, current);
      this.assertCurrentDevice(current, dto.deviceId);
      this.assertActive(current);
      if (current.version !== dto.version) throw this.versionConflict();
      const update = await runRepo.update(
        { id, version: dto.version, deviceId: dto.deviceId },
        { version: dto.version + 1 },
      );
      if (update.affected !== 1) throw this.versionConflict();
      const updated = await runRepo.findOneByOrFail({ id });
      await this.writeEvent(
        manager,
        actor,
        updated,
        ClassroomEventType.Checkpoint,
        {
          checkpointType: dto.checkpointType,
          resourceId: dto.resourceId ?? null,
          version: updated.version,
        },
        dto.requestId,
      );
    });
    await this.snapshotService.capture(
      id,
      this.checkpointReason(dto.checkpointType),
      dto.checkpointType === ClassroomCheckpointType.RecoverableError,
      {
        playedResourceId: dto.resourceId,
        attendanceState: dto.attendanceState,
        rollCallState: dto.rollCallState,
        rewardState: dto.rewardState,
        interactionState: dto.interactionState,
        playerState: dto.playerState,
      },
    );
    return this.restore(actor, id, dto.deviceId);
  }

  async setAvatarBinding(
    actor: JwtTeacherPayload,
    id: number,
    dto: SetClassroomAvatarBindingDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.AvatarBinding,
      id,
    );
    if (duplicate) return this.get(actor, id);
    const run = await this.ownedRun(actor, id);
    this.assertCurrentDevice(run, dto.deviceId);
    this.assertActive(run);
    await this.avatarConfiguration.validateBindingTarget(
      actor,
      dto.characterId,
      dto.versionId,
    );
    await this.dataSource.transaction(async (manager) => {
      const runRepo = manager.getRepository(ClassroomRun);
      const current = await runRepo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('课堂运行不存在');
      this.assertOwner(actor, current);
      this.assertCurrentDevice(current, dto.deviceId);
      this.assertActive(current);
      if (current.version !== dto.version) throw this.versionConflict();
      await this.avatarConfiguration.upsertClassroomBinding(
        manager,
        actor,
        current,
        dto,
      );
      const update = await runRepo.update(
        { id, version: dto.version, deviceId: dto.deviceId },
        {
          avatarCharacterId: dto.characterId,
          avatarVersionId: dto.versionId,
          version: dto.version + 1,
        },
      );
      if (update.affected !== 1) throw this.versionConflict();
      const updated = await runRepo.findOneByOrFail({ id });
      await this.writeEvent(
        manager,
        actor,
        updated,
        ClassroomEventType.AvatarBinding,
        {
          operation: 'set',
          characterId: dto.characterId,
          avatarVersionId: dto.versionId,
          version: updated.version,
        },
        dto.requestId,
      );
    });
    await this.snapshotService.capture(
      id,
      ClassroomSnapshotReason.AvatarBinding,
      true,
    );
    return this.get(actor, id);
  }

  async cancelAvatarBinding(
    actor: JwtTeacherPayload,
    id: number,
    dto: CancelClassroomAvatarBindingDto,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      ClassroomEventType.AvatarBinding,
      id,
    );
    if (duplicate) return this.get(actor, id);
    const run = await this.ownedRun(actor, id);
    this.assertCurrentDevice(run, dto.deviceId);
    this.assertActive(run);
    await this.dataSource.transaction(async (manager) => {
      const runRepo = manager.getRepository(ClassroomRun);
      const current = await runRepo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('课堂运行不存在');
      this.assertOwner(actor, current);
      this.assertCurrentDevice(current, dto.deviceId);
      this.assertActive(current);
      if (current.version !== dto.version) throw this.versionConflict();
      await this.avatarConfiguration.cancelClassroomBinding(
        manager,
        actor,
        current,
        dto.reason,
      );
      const fallback = await this.avatarConfiguration.resolveVersionReference(
        actor,
        { classId: current.classId, lessonPlanId: current.lessonPlanId },
        manager,
      );
      const update = await runRepo.update(
        { id, version: dto.version, deviceId: dto.deviceId },
        {
          avatarCharacterId: fallback?.characterId ?? null,
          avatarVersionId: fallback?.versionId ?? null,
          version: dto.version + 1,
        },
      );
      if (update.affected !== 1) throw this.versionConflict();
      const updated = await runRepo.findOneByOrFail({ id });
      await this.writeEvent(
        manager,
        actor,
        updated,
        ClassroomEventType.AvatarBinding,
        {
          operation: 'cancel',
          fallbackCharacterId: fallback?.characterId ?? null,
          fallbackVersionId: fallback?.versionId ?? null,
          version: updated.version,
        },
        dto.requestId,
      );
    });
    await this.snapshotService.capture(
      id,
      ClassroomSnapshotReason.AvatarBinding,
      true,
    );
    return this.get(actor, id);
  }

  private async transition(
    actor: JwtTeacherPayload,
    id: number,
    dto: ClassroomRunOperationDto,
    target: ClassroomRunStatus,
    eventType: ClassroomEventType,
  ) {
    this.requireTeacher(actor);
    const duplicate = await this.findDuplicate(
      actor,
      dto.requestId,
      eventType,
      id,
    );
    if (duplicate) {
      const current = await this.ownedRun(actor, id);
      this.assertCurrentDevice(current, dto.deviceId);
      return this.get(actor, id);
    }
    await this.ownedRun(actor, id);
    try {
      await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const run = await runRepo.findOne({ where: { id } });
        if (!run) throw new NotFoundException('课堂运行不存在');
        this.assertOwner(actor, run);
        this.assertCurrentDevice(run, dto.deviceId);
        if (run.version !== dto.version) throw this.versionConflict();
        assertClassroomRunTransition(run.status, target);
        const now = new Date();
        const updates: Partial<ClassroomRun> = {
          status: target,
          version: dto.version + 1,
        };
        if (
          run.status === ClassroomRunStatus.Running &&
          run.resumedAt &&
          target !== ClassroomRunStatus.Running
        )
          updates.elapsedSeconds =
            run.elapsedSeconds +
            Math.max(
              0,
              Math.floor((now.getTime() - run.resumedAt.getTime()) / 1000),
            );
        if (target === ClassroomRunStatus.Paused) {
          updates.pausedAt = now;
          updates.resumedAt = null;
        } else if (target === ClassroomRunStatus.Running) {
          updates.pausedAt = null;
          updates.resumedAt = now;
        } else {
          updates.endedAt = now;
          updates.resumedAt = null;
        }
        const update = await runRepo.update(
          { id, version: dto.version, status: run.status },
          updates,
        );
        if (update.affected !== 1) throw this.versionConflict();
        const updated = await runRepo.findOneByOrFail({ id });
        await this.writeEvent(
          manager,
          actor,
          updated,
          eventType,
          {
            from: run.status,
            to: target,
            status: updated.status,
            version: updated.version,
          },
          dto.requestId,
        );
      });
      await this.snapshotService.capture(
        id,
        this.transitionSnapshotReason(eventType),
        true,
      );
      return this.get(actor, id);
    } catch (error) {
      const repeated = await this.findDuplicate(
        actor,
        dto.requestId,
        eventType,
        id,
      );
      if (repeated) return this.get(actor, id);
      throw error;
    }
  }

  private async validateResources(
    actor: JwtTeacherPayload,
    steps: LessonStep[],
  ) {
    const resourceIds = Array.from(
      new Set(
        steps
          .map((step) => step.resourceId)
          .filter((value): value is number => value != null),
      ),
    );
    for (const resourceId of resourceIds) {
      const resource = await this.resources.getOne(actor, resourceId);
      if (resource.reviewStatus !== ResourceReviewStatus.Approved)
        throw new ConflictException(
          `资源 ${resourceId} 未审核通过，不能用于正式课堂`,
        );
    }
  }

  private async requireTakeoverDevice(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: TakeoverClassroomRunDto,
  ) {
    if (dto.newDeviceId === dto.oldDeviceId)
      throw new ConflictException('新设备与当前设备相同');
    const [device, binding, occupied] = await Promise.all([
      this.devices.findOne({ where: { id: dto.newDeviceId } }),
      this.bindings.findOne({
        where: {
          deviceId: dto.newDeviceId,
          classroomId: run.classroomId,
          classId: run.classId,
          status: BindingStatus.Active,
        },
      }),
      this.runs.findOne({
        where: {
          deviceId: dto.newDeviceId,
          status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]),
        },
      }),
    ]);
    if (!device) throw new NotFoundException('新设备不存在');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException('新设备当前不可用于课堂');
    if (occupied && occupied.id !== run.id)
      throw new ConflictException('新设备已经存在进行中的课堂');
    if (actor.schoolId && device.schoolId && actor.schoolId !== device.schoolId)
      throw new ForbiddenException('新设备不属于当前园所');
    if (!binding) {
      if (!dto.teacherConfirmed)
        throw new ForbiddenException('新设备未经当前课堂授权');
      if (!actor.schoolId || device.schoolId !== actor.schoolId)
        throw new ForbiddenException('新设备未经当前课堂授权');
    }
  }

  private async requireValidBinding(
    dto: StartClassroomRunDto,
    manager?: EntityManager,
  ) {
    const classroomRepo = manager?.getRepository(Classroom) ?? this.classrooms;
    const deviceRepo = manager?.getRepository(Device) ?? this.devices;
    const bindingRepo = manager?.getRepository(DeviceBinding) ?? this.bindings;
    const [classroom, device, binding] = await Promise.all([
      classroomRepo.findOne({ where: { id: dto.classroomId } }),
      deviceRepo.findOne({ where: { id: dto.deviceId } }),
      bindingRepo.findOne({
        where: {
          deviceId: dto.deviceId,
          classroomId: dto.classroomId,
          classId: dto.classId,
          status: BindingStatus.Active,
        },
      }),
    ]);
    if (!classroom) throw new NotFoundException('教室不存在');
    if (!device) throw new NotFoundException('设备不存在');
    if (!binding) throw new ConflictException('设备、教室与班级不存在有效绑定');
    if (classroom.status !== RecordStatus.Active)
      throw new ConflictException('教室已停用');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException('设备当前不可用于课堂');
  }

  private async requireApprovedResources(
    manager: EntityManager,
    inputIds: number[],
  ) {
    const ids = Array.from(new Set(inputIds));
    if (!ids.length) return;
    const count = await manager.getRepository(TeachingResource).count({
      where: {
        id: In(ids),
        reviewStatus: ResourceReviewStatus.Approved,
        deletedAt: IsNull(),
      },
    });
    if (count !== ids.length)
      throw new ConflictException('课堂资源状态已变化，请刷新后重试');
  }

  private async ensureNoActiveConflict(
    manager: EntityManager,
    classId: number,
    deviceId: number,
  ) {
    const active = await manager.getRepository(ClassroomRun).findOne({
      where: [
        { classId, status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) },
        { deviceId, status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) },
      ],
    });
    if (active) throw new ConflictException('该班级或设备已经存在进行中的课堂');
  }

  private async ownedRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    this.assertOwner(actor, run);
    await this.access.requireClassAccess(actor, run.classId);
    return run;
  }

  private assertOwner(actor: JwtTeacherPayload, run: ClassroomRun) {
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作其他教师的课堂');
  }

  private assertCurrentDevice(run: ClassroomRun, deviceId: number) {
    if (run.deviceId !== deviceId)
      throw new ForbiddenException('当前设备已失去课堂控制权');
  }

  private assertActive(run: ClassroomRun) {
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    )
      throw new ConflictException('已结束课堂不能继续恢复或接管');
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂运行只能由教师操作');
  }

  private async findDuplicate(
    actor: JwtTeacherPayload,
    requestId: string,
    eventType: ClassroomEventType,
    classroomRunId?: number,
  ) {
    const event = await this.events.findOne({
      where: {
        operatorType: actor.userType,
        operatorId: actor.sub,
        requestId,
      },
    });
    if (!event) return null;
    if (
      event.eventType !== eventType ||
      (classroomRunId != null && event.classroomRunId !== classroomRunId)
    )
      throw new ConflictException('requestId 已用于其他课堂操作');
    return event;
  }

  private async writeEvent(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    eventType: ClassroomEventType,
    payload: unknown,
    requestId: string,
  ) {
    await manager.getRepository(ClassroomEvent).save(
      manager.getRepository(ClassroomEvent).create({
        classroomRunId: run.id,
        eventType,
        requestId,
        operatorType: actor.userType,
        operatorId: actor.sub,
        deviceId: run.deviceId,
        payload: JSON.stringify(payload),
        result: ClassroomEventResult.Success,
      }),
    );
  }

  private response(run: ClassroomRun, snapshots?: ClassroomRunStepSnapshot[]) {
    const liveElapsedSeconds =
      run.status === ClassroomRunStatus.Running && run.resumedAt
        ? run.elapsedSeconds +
          Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000))
        : run.elapsedSeconds;
    return {
      ...run,
      elapsedSeconds: liveElapsedSeconds,
      ...(snapshots
        ? {
            steps: snapshots.map((step) => ({
              ...step,
              actionConfig: this.parseJson(step.actionConfig),
              recoveryPointConfig: this.parseJson(step.recoveryPointConfig),
            })),
          }
        : {}),
    };
  }

  private timing(run: ClassroomRun, elapsedSeconds: number) {
    return {
      elapsedSeconds,
      isRunning: run.status === ClassroomRunStatus.Running,
      resumedAt: run.resumedAt,
      pausedAt: run.pausedAt,
      startedAt: run.startedAt,
    };
  }

  private allowedActions(status: ClassroomRunStatus): string[] {
    const actionName: Record<ClassroomRunStatus, string> = {
      [ClassroomRunStatus.Prepared]: 'start',
      [ClassroomRunStatus.Running]: 'resume',
      [ClassroomRunStatus.Paused]: 'pause',
      [ClassroomRunStatus.Completed]: 'complete',
      [ClassroomRunStatus.Cancelled]: 'cancel',
      [ClassroomRunStatus.Failed]: 'fail',
    };
    const actions: string[] = allowedClassroomRunTransitions(status).map(
      (value) => actionName[value],
    );
    if (status === ClassroomRunStatus.Running)
      actions.push('change_step', 'checkpoint');
    if (
      [ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(status)
    )
      actions.push('takeover', 'recover', 'avatar_binding');
    return actions;
  }

  private transitionSnapshotReason(
    eventType: ClassroomEventType,
  ): ClassroomSnapshotReason {
    const reasons: Partial<
      Record<ClassroomEventType, ClassroomSnapshotReason>
    > = {
      [ClassroomEventType.Pause]: ClassroomSnapshotReason.Pause,
      [ClassroomEventType.Resume]: ClassroomSnapshotReason.Resume,
      [ClassroomEventType.Complete]: ClassroomSnapshotReason.Complete,
      [ClassroomEventType.Cancel]: ClassroomSnapshotReason.Cancel,
    };
    return reasons[eventType] ?? ClassroomSnapshotReason.RecoverableError;
  }

  private checkpointReason(
    type: ClassroomCheckpointType,
  ): ClassroomSnapshotReason {
    return type as unknown as ClassroomSnapshotReason;
  }

  private patchFromSnapshot(
    snapshot: ValidClassroomSnapshot,
  ): ClassroomSnapshotPatch {
    return {
      attendanceState: snapshot.attendanceState,
      rollCallState: snapshot.rollCallState,
      rewardState: snapshot.rewardState,
      interactionState: snapshot.interactionState,
      playerState: snapshot.playerState,
    };
  }

  private parseJson(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private versionConflict() {
    return new ConflictException('课堂状态已变化，请刷新后重试');
  }

  private isUniqueViolation(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
