import { ConflictException, ForbiddenException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { LessonPlanService } from '../lesson-plans/lesson-plan.service';
import { Device } from '../platform/entities/device.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Classroom } from '../platform/entities/classroom.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { deviceHeartbeatTimeoutMs, deviceOnlineStatus } from '../platform/device-online-policy';
import { BindingStatus, DeviceStatus, RecordStatus } from '../platform/platform.types';
import { ACTIVE_CLASSROOM_RUN_STATUSES } from './classroom-run.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import type { StartClassroomRunDto } from './dto/classroom-run.dto';
import type { CreateScreenPreparationDto } from './dto/screen-preparation.dto';
import { ScreenHandoffService } from './screen-handoff.service';

type Preparation = CreateScreenPreparationDto & {
  preparationId: string; revision: number; deviceId: number; teacherId: number;
  bindingId: number; courseTitle: string; createdAt: string; expiresAt: string;
};
export const READY_WELCOME = '欢迎小朋友，老师准备好后我们一起开始。';

/** Single-process, bounded TTL context. No Run, Snapshot or Device writes. */
@Injectable()
export class ScreenPreparationService {
  private readonly contexts = new Map<number, Preparation>();
  private readonly requests = new Map<string, { context: Preparation; fingerprint: string; forgetAt: number }>();
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  readonly ttlMs: number;
  constructor(
    @InjectRepository(ClassroomRun) private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceBinding) private readonly bindings: Repository<DeviceBinding>,
    @InjectRepository(Classroom) private readonly rooms: Repository<Classroom>,
    private readonly access: PlatformAccessService,
    private readonly plans: LessonPlanService,
    private readonly config: ConfigService,
    private readonly handoffs: ScreenHandoffService,
  ) {
    const seconds = Number(config.get('SCREEN_PREPARATION_TTL_SECONDS') ?? 300);
    this.ttlMs = (Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 300) * 1000;
  }

  // Preparation, cancellation and *all* start callers share the same short-lived gate.
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { this.prune(); return await work(); } finally { release(); }
  }
  @Interval('screen-preparation-expiry', 30_000)
  prune() {
    const now = Date.now();
    for (const [id, context] of this.contexts) if (Date.parse(context.expiresAt) <= now) this.contexts.delete(id);
    for (const [id, entry] of this.requests) if (entry.forgetAt <= now) this.requests.delete(id);
  }
  private teacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('只有教师可以准备课堂');
  }
  private publicContext(context: Preparation) {
    return {
      preparationId: context.preparationId, revision: context.revision,
      deviceId: context.deviceId, classId: context.classId, classroomId: context.classroomId,
      lessonPlanId: context.lessonPlanId, lessonPlanVersion: context.lessonPlanVersion,
      courseTitle: context.courseTitle, welcomeText: READY_WELCOME,
      createdAt: context.createdAt, expiresAt: context.expiresAt,
      serverNow: new Date(Date.now()).toISOString(),
    };
  }
  private async target(actor: JwtTeacherPayload, deviceId: number, dto: { classId: number; classroomId: number }, bindingId?: number) {
    this.teacher(actor);
    const group = await this.access.requireClassAccess(actor, dto.classId);
    const [device, room, binding] = await Promise.all([
      this.devices.findOneBy({ id: deviceId }), this.rooms.findOneBy({ id: dto.classroomId }),
      this.bindings.findOneBy({ deviceId, classId: dto.classId, classroomId: dto.classroomId, status: BindingStatus.Active }),
    ]);
    if (!binding || (bindingId != null && binding.id !== bindingId) || group.status !== RecordStatus.Active || room?.status !== RecordStatus.Active)
      throw new ConflictException('设备绑定或班级、教室已失效，请重新准备');
    if (!device || deviceOnlineStatus(device, deviceHeartbeatTimeoutMs(this.config.get('DEVICE_HEARTBEAT_TIMEOUT_SECONDS'))) !== DeviceStatus.Online)
      throw new ConflictException('大屏离线、停用或故障，请检查设备后重试');
    if (actor.schoolId && device.schoolId && actor.schoolId !== device.schoolId) throw new ForbiddenException('设备不属于当前园所');
    return binding;
  }
  private async busy(deviceId: number, classId: number) {
    return this.runs.exists({ where: [
      { deviceId, status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) },
      { classId, status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) },
    ] });
  }

  create(actor: JwtTeacherPayload, deviceId: number, dto: CreateScreenPreparationDto) {
    return this.exclusive(async () => {
      const binding = await this.target(actor, deviceId, dto);
      if (await this.busy(deviceId, dto.classId)) throw new ConflictException('设备或班级已有活动课堂，不能进入准备状态');
      const plan = await this.plans.get(actor, dto.lessonPlanId);
      if (!plan.steps.length || plan.version !== dto.lessonPlanVersion) throw new ConflictException('教案为空或版本已变化，请刷新后重新准备');
      const key = `${actor.sub}:${dto.requestId}`;
      const fingerprint = JSON.stringify([deviceId, dto.classId, dto.classroomId, dto.lessonPlanId, dto.lessonPlanVersion]);
      const previous = this.requests.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ConflictException('请求编号已用于其他准备操作');
        if (this.contexts.get(deviceId)?.preparationId !== previous.context.preparationId) throw new GoneException('原准备已取消、过期或消费，请重新准备');
        return this.publicContext(previous.context);
      }
      if ([...this.contexts.values()].some(c => c.deviceId === deviceId || c.classId === dto.classId)) throw new ConflictException('设备或班级已被准备占用，请先取消原准备');
      const context: Preparation = { ...dto, deviceId, teacherId: actor.sub, bindingId: binding.id,
        preparationId: randomUUID(), revision: ++this.revision, courseTitle: plan.title,
        createdAt: new Date(Date.now()).toISOString(), expiresAt: new Date(Date.now() + this.ttlMs).toISOString() };
      this.handoffs.revokeDevice(deviceId);
      this.contexts.set(deviceId, context);
      this.requests.set(key, { context, fingerprint, forgetAt: Date.now() + this.ttlMs + 10 * 60_000 });
      return this.publicContext(context);
    });
  }
  private async valid(actor: JwtTeacherPayload, deviceId: number) {
    const context = this.contexts.get(deviceId);
    if (!context) return null;
    if (context.teacherId !== actor.sub) throw new ForbiddenException('设备已由其他教师准备');
    await this.target(actor, deviceId, context, context.bindingId);
    const plan = await this.plans.get(actor, context.lessonPlanId);
    if (plan.version !== context.lessonPlanVersion || !plan.steps.length) {
      this.contexts.delete(deviceId);
      throw new ConflictException('教案已变化，请重新准备');
    }
    // Recheck deadline after asynchronous validation; reads never renew it.
    if (Date.parse(context.expiresAt) <= Date.now()) { this.contexts.delete(deviceId); return null; }
    return context;
  }
  get(actor: JwtTeacherPayload, deviceId: number) {
    return this.exclusive(async () => {
      this.teacher(actor);
      const binding = await this.bindings.findOneBy({ deviceId, status: BindingStatus.Active });
      if (!binding) throw new ConflictException('设备未有效绑定');
      await this.access.requireClassAccess(actor, binding.classId);
      const context = await this.valid(actor, deviceId);
      return { preparation: context ? this.publicContext(context) : null, serverNow: new Date().toISOString() };
    });
  }
  cancel(actor: JwtTeacherPayload, deviceId: number, id: string, revision: number) {
    return this.exclusive(async () => {
      this.teacher(actor);
      const binding = await this.bindings.findOneBy({ deviceId, status: BindingStatus.Active });
      if (!binding) throw new ConflictException('设备未有效绑定');
      await this.access.requireClassAccess(actor, binding.classId);
      const context = this.contexts.get(deviceId);
      if (!context || context.preparationId !== id) return { cancelled: true };
      if (context.teacherId !== actor.sub) throw new ForbiddenException('不能取消其他教师的准备');
      if (context.revision !== revision) throw new ConflictException('准备版本已变化');
      this.contexts.delete(deviceId);
      return { cancelled: true };
    });
  }
  // Called under exclusive() by ClassroomRunService, after durable request replay.
  async assertStart(actor: JwtTeacherPayload, dto: StartClassroomRunDto) {
    const context = this.contexts.get(dto.deviceId);
    const other = [...this.contexts.values()].find(c => c.classId === dto.classId && c.deviceId !== dto.deviceId);
    if (other) throw new ConflictException('班级已准备到其他大屏');
    if (!context) {
      if (dto.preparationId || dto.preparationRevision != null) throw new GoneException('准备已失效，请重新准备');
      return; // Preserve legacy callers only when no preparation owns the target.
    }
    if (context.teacherId !== actor.sub) throw new ForbiddenException('设备已由其他教师准备');
    if (dto.preparationId !== context.preparationId || dto.preparationRevision !== context.revision || dto.classId !== context.classId || dto.classroomId !== context.classroomId || dto.lessonPlanId !== context.lessonPlanId)
      throw new ConflictException('开课请求与当前准备不一致，请重新确认');
    if (!await this.valid(actor, dto.deviceId)) throw new GoneException('准备已过期，请重新准备');
  }
  consume(deviceId: number) { this.contexts.delete(deviceId); }

  screenWhenIdle(actor: JwtTeacherPayload, deviceId: number) {
    return this.exclusive(async () => {
      // Priority recheck inside the same gate as preparation/start, never hide a Run.
      const active = await this.runs.findOne({ where: { deviceId, status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) } });
      if (active) {
        if (active.teacherId !== actor.sub) throw new ConflictException('设备已有其他教师的活动课堂');
        return { retryActive: true as const };
      }
      const context = await this.valid(actor, deviceId);
      return { page: context ? 'ready' as const : 'idle' as const, deviceId, classroomState: null,
        preparation: context ? this.publicContext(context) : null, serverNow: new Date().toISOString() };
    });
  }
}
