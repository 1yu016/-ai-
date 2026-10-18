import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { BindingStatus, DeviceStatus } from '../platform/platform.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomRunStatus } from './classroom-run.types';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { assertRunOperation } from './classroom-operation-context';

export type ScreenLifecycle = {
  schemaVersion: 1;
  phase: 'opening' | 'teaching' | 'summary' | 'dismissed';
  runId: number;
  deviceId: number;
  bindingId: number;
  revision: number;
  enteredAt: string;
  expiresAt: string | null;
};
export type LifecycleTarget = {
  runId: number;
  deviceId: number;
  bindingId: number;
  expectedRevision: number;
};

/** Storage/validation only. No routes, screen projection, start hooks or effects. */
@Injectable()
export class ScreenLifecycleService {
  private readonly write: ReturnType<
    ClassroomSnapshotService['claimScreenLifecycleWriter']
  >;
  constructor(
    private readonly snapshots: ClassroomSnapshotService,
    private readonly access: PlatformAccessService,
  ) {
    this.write = snapshots.claimScreenLifecycleWriter();
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.write.transaction(work);
  }

  createOpening(
    actor: JwtTeacherPayload,
    target: LifecycleTarget,
    manager?: EntityManager,
  ) {
    return this.update(actor, target, 'opening', undefined, manager);
  }
  completeOpening(actor: JwtTeacherPayload, target: LifecycleTarget) {
    return this.update(actor, target, 'teaching');
  }
  skipOpening(actor: JwtTeacherPayload, target: LifecycleTarget) {
    return this.completeOpening(actor, target);
  }
  createSummary(
    actor: JwtTeacherPayload,
    target: LifecycleTarget,
    ttlSeconds = 20,
    manager?: EntityManager,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 120)
      throw new BadRequestException('结束展示有效期必须为 1–120 秒');
    return this.update(actor, target, 'summary', ttlSeconds, manager);
  }
  closeSummary(actor: JwtTeacherPayload, target: LifecycleTarget) {
    return this.update(actor, target, 'dismissed');
  }

  async getValid(
    actor: JwtTeacherPayload,
    target: Omit<LifecycleTarget, 'expectedRevision'>,
  ): Promise<ScreenLifecycle | null> {
    return this.write.transaction(async (manager) => {
      const run = await this.validate(actor, target, manager);
      const latest = await this.snapshots.loadLatestValid(run.id, manager);
      const lifecycle = this.parse(latest?.interactionState.screenLifecycle);
      if (!lifecycle) return null; // Compatible legacy snapshot, not an inferred opening.
      return this.isValid(lifecycle, run, target) ? lifecycle : null;
    });
  }

  private async update(
    actor: JwtTeacherPayload,
    target: LifecycleTarget,
    phase: ScreenLifecycle['phase'],
    ttl?: number,
    transactionManager?: EntityManager,
  ) {
    if (
      !Number.isInteger(target.expectedRevision) ||
      target.expectedRevision < 0
    )
      throw new BadRequestException('生命周期 revision 无效');
    const work = async (manager: EntityManager) => {
      const run = await this.validate(actor, target, manager);
      const latest = await this.snapshots.loadLatestValid(run.id, manager);
      const initializingStart =
        !latest &&
        !!transactionManager &&
        phase === 'opening' &&
        target.expectedRevision === 0;
      if (
        !initializingStart &&
        (!latest ||
          latest.entity.classroomRunId !== run.id ||
          latest.entity.deviceId !== run.deviceId)
      )
        throw new ConflictException('缺少有效的当前课堂快照');
      const raw = latest?.interactionState.screenLifecycle;
      const previous = this.parse(raw);
      if (raw !== undefined && !previous)
        throw new ConflictException('生命周期数据无效');
      // A retry of the immediately completed opening is a read-only success.
      // Binding/ownership are checked first; no revision or snapshot is appended.
      if (
        phase === 'teaching' &&
        previous?.phase === 'teaching' &&
        previous.revision === target.expectedRevision + 1 &&
        this.isValid(previous, run, target)
      )
        return previous;
      if ((previous?.revision ?? 0) !== target.expectedRevision)
        throw new ConflictException('生命周期已更新');
      if (phase === 'teaching') await assertRunOperation(run, manager, this.snapshots, 'complete_opening');
      if (
        previous &&
        (previous.runId !== target.runId ||
          previous.deviceId !== target.deviceId ||
          previous.bindingId !== target.bindingId)
      )
        throw new ConflictException('生命周期与当前绑定不一致');
      const active = [
        ClassroomRunStatus.Running,
        ClassroomRunStatus.Paused,
      ].includes(run.status);
      if ((phase === 'opening' || phase === 'teaching') && !active)
        throw new ConflictException('只有活动课堂允许开场');
      if (
        (phase === 'summary' || phase === 'dismissed') &&
        run.status !== ClassroomRunStatus.Completed
      )
        throw new ConflictException('只有已完成课堂允许结束展示');
      if (phase === 'opening' && previous)
        throw new ConflictException('不能重复创建开场');
      if (phase === 'opening' || phase === 'teaching') {
        const day = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        if (
          !run.startedAt ||
          !Number.isFinite(run.startedAt.getTime()) ||
          run.startedAt.getTime() > Date.now() ||
          day.format(run.startedAt) !== day.format(new Date())
        )
          throw new ConflictException('跨日或无效课堂不能创建或完成开场');
      }
      if (phase === 'teaching' && previous?.phase !== 'opening')
        throw new ConflictException('当前没有待完成开场');
      if (
        phase === 'summary' &&
        previous &&
        !['opening', 'teaching'].includes(previous.phase)
      )
        throw new ConflictException('不能重复创建结束展示');
      if (phase === 'dismissed' && previous?.phase !== 'summary')
        throw new ConflictException('当前没有结束展示');
      const now = new Date();
      // Summary can only be created immediately after completion, not from history.
      if (
        phase === 'summary' &&
        (!run.endedAt ||
          now.getTime() - run.endedAt.getTime() > 120000 ||
          run.endedAt.getTime() > now.getTime())
      )
        throw new ConflictException('课堂结束时间已超出展示窗口');
      const lifecycle: ScreenLifecycle = {
        schemaVersion: 1,
        phase,
        runId: run.id,
        deviceId: run.deviceId,
        bindingId: target.bindingId,
        revision: target.expectedRevision + 1,
        enteredAt: now.toISOString(),
        expiresAt: ttl
          ? new Date(now.getTime() + ttl * 1000).toISOString()
          : null,
      };
      const saved = await this.write(
        run.id,
        lifecycle,
        target.expectedRevision,
        manager,
      );
      if (!saved)
        throw new ConflictException('生命周期保存失败，请重新读取后重试');
      return lifecycle;
    };
    return transactionManager
      ? work(transactionManager)
      : this.write.transaction(work);
  }

  private async validate(
    actor: JwtTeacherPayload,
    target: Omit<LifecycleTarget, 'expectedRevision'>,
    manager: EntityManager,
  ) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('仅课堂教师可以管理展示生命周期');
    if (
      ![target.runId, target.deviceId, target.bindingId].every(
        (x) => Number.isInteger(x) && x > 0,
      )
    )
      throw new BadRequestException('课堂、设备或绑定标识无效');
    const run = await manager.findOneBy(ClassroomRun, { id: target.runId });
    if (!run) throw new NotFoundException('课堂不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权管理其他教师课堂');
    await this.access.requireClassAccess(actor, run.classId);
    const device = await manager.findOneBy(Device, { id: target.deviceId });
    if (
      !device ||
      [DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status)
    )
      throw new ConflictException('设备不可用于展示');
    const binding = await manager.findOneBy(DeviceBinding, {
      id: target.bindingId,
      status: BindingStatus.Active,
    });
    const currentBinding = await manager.findOne(DeviceBinding, {
      where: { deviceId: target.deviceId, status: BindingStatus.Active },
      order: { boundAt: 'DESC', id: 'DESC' },
    });
    if (
      !binding ||
      currentBinding?.id !== binding.id ||
      binding.deviceId !== run.deviceId ||
      target.deviceId !== run.deviceId ||
      binding.classId !== run.classId ||
      binding.classroomId !== run.classroomId
    )
      throw new ConflictException('设备绑定与课堂不一致');
    // Do not select a historical completed run once a newer run owns this device.
    const newer = await manager
      .getRepository(ClassroomRun)
      .createQueryBuilder('run')
      .where('run.deviceId = :deviceId AND run.id > :runId', {
        deviceId: run.deviceId,
        runId: run.id,
      })
      .getOne();
    if (newer) throw new ConflictException('设备已有新的课堂，旧生命周期失效');
    return run;
  }

  private parse(value: unknown): ScreenLifecycle | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const v = value as ScreenLifecycle;
    if (
      v.schemaVersion !== 1 ||
      !['opening', 'teaching', 'summary', 'dismissed'].includes(v.phase) ||
      ![v.runId, v.deviceId, v.bindingId, v.revision].every(
        (x) => Number.isInteger(x) && x > 0,
      ) ||
      typeof v.enteredAt !== 'string' ||
      !Number.isFinite(Date.parse(v.enteredAt)) ||
      (v.expiresAt !== null &&
        (typeof v.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(v.expiresAt))))
    )
      return null;
    if (v.phase === 'summary' && v.expiresAt === null) return null;
    return v;
  }

  private isValid(
    v: ScreenLifecycle,
    run: ClassroomRun,
    target: Omit<LifecycleTarget, 'expectedRevision'>,
  ) {
    const now = Date.now();
    if (
      v.runId !== run.id ||
      v.deviceId !== target.deviceId ||
      v.bindingId !== target.bindingId ||
      Date.parse(v.enteredAt) > now ||
      (v.expiresAt && Date.parse(v.expiresAt) <= now) ||
      v.phase === 'dismissed'
    )
      return false;
    if (['opening', 'teaching'].includes(v.phase)) {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return (
        [ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
          run.status,
        ) &&
        !!run.startedAt &&
        run.startedAt.getTime() <= now &&
        day.format(run.startedAt) === day.format(new Date(now))
      );
    }
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return (
      run.status === ClassroomRunStatus.Completed &&
      !!run.startedAt &&
      day.format(run.startedAt) === day.format(new Date(now)) &&
      day.format(new Date(v.enteredAt)) === day.format(new Date(now))
    );
  }
}
