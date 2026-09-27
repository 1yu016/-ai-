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
import { assertClassroomRunTransition } from './classroom-run.state-machine';
import {
  ACTIVE_CLASSROOM_RUN_STATUSES,
  ClassroomEventResult,
  ClassroomEventType,
  ClassroomRunStatus,
} from './classroom-run.types';
import {
  ChangeClassroomStepDto,
  ClassroomRunOperationDto,
  StartClassroomRunDto,
} from './dto/classroom-run.dto';
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
    @InjectRepository(DeviceBinding)
    private readonly bindings: Repository<DeviceBinding>,
    @InjectRepository(Classroom)
    private readonly classrooms: Repository<Classroom>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly dataSource: DataSource,
    private readonly access: PlatformAccessService,
    private readonly lessonPlans: LessonPlanService,
    private readonly resources: ResourceService,
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
    if (duplicate) return this.get(actor, id);
    await this.ownedRun(actor, id);
    try {
      await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const run = await runRepo.findOne({ where: { id } });
        if (!run) throw new NotFoundException('课堂运行不存在');
        this.assertOwner(actor, run);
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

  async active(actor: JwtTeacherPayload) {
    this.requireTeacher(actor);
    const runs = await this.runs.find({
      where: {
        teacherId: actor.sub,
        status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]),
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
    if (duplicate) return this.get(actor, id);
    await this.ownedRun(actor, id);
    try {
      await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const run = await runRepo.findOne({ where: { id } });
        if (!run) throw new NotFoundException('课堂运行不存在');
        this.assertOwner(actor, run);
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
