import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
import { Device } from '../src/platform/entities/device.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { BindingStatus, DeviceStatus } from '../src/platform/platform.types';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
} from '../src/classroom-runs/classroom-run.types';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import type { JwtTeacherPayload } from '../src/auth/auth.types';
import type { PlatformAccessService } from '../src/platform/platform-access.service';

describe('internal screen lifecycle storage (isolated SQLite)', () => {
  let db: DataSource;
  let snapshots: ClassroomSnapshotService;
  let lifecycle: ScreenLifecycleService;
  const actor = { sub: 1, userType: AuthUserType.Teacher } as JwtTeacherPayload;
  const target = { runId: 1, deviceId: 1, bindingId: 1, expectedRevision: 0 };
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [
        ClassroomRun,
        ClassroomSnapshot,
        ClassroomEvent,
        Device,
        DeviceBinding,
      ],
    }).initialize();
    await db
      .getRepository(Device)
      .save({
        id: 1,
        deviceCode: 'isolated',
        name: 'test',
        status: DeviceStatus.Offline,
      });
    await db
      .getRepository(DeviceBinding)
      .save({
        id: 1,
        deviceId: 1,
        classroomId: 1,
        classId: 1,
        boundByType: AuthUserType.Teacher,
        boundBy: 1,
        boundAt: new Date(),
        status: BindingStatus.Active,
      });
    await db
      .getRepository(ClassroomRun)
      .save({
        id: 1,
        lessonPlanId: 1,
        lessonPlanVersion: 1,
        teacherId: 1,
        classId: 1,
        classroomId: 1,
        deviceId: 1,
        title: 'test',
        status: ClassroomRunStatus.Running,
        startedAt: new Date(),
      });
    snapshots = new ClassroomSnapshotService(
      db.getRepository(ClassroomRun),
      db.getRepository(ClassroomSnapshot),
      db.getRepository(ClassroomEvent),
    );
    lifecycle = new ScreenLifecycleService(snapshots, {
      requireClassAccess: async () => ({}),
    } as unknown as PlatformAccessService);
    await snapshots.capture(1, ClassroomSnapshotReason.Start, true, {
      interactionState: { question: 'original' },
      attendanceState: { present: [1] },
      rewardState: { stars: 3 },
      rollCallState: { last: 1 },
    });
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('supports legacy, opening, completion and rejects stale revision', async () => {
    expect(await lifecycle.getValid(actor, target)).toBeNull();
    expect((await lifecycle.createOpening(actor, target)).revision).toBe(1);
    await expect(lifecycle.completeOpening(actor, target)).rejects.toThrow(
      '生命周期已更新',
    );
    expect(
      (
        await lifecycle.completeOpening(actor, {
          ...target,
          expectedRevision: 1,
        })
      ).phase,
    ).toBe('teaching');
    expect((await lifecycle.getValid(actor, target))?.revision).toBe(2);
    expect(
      (await db.getRepository(ClassroomRun).findOneByOrFail({ id: 1 }))
        .currentStepIndex,
    ).toBe(0);
  });
  it('ordinary writes cannot replace lifecycle and preserve other state', async () => {
    await lifecycle.createOpening(actor, target);
    await snapshots.capture(1, ClassroomSnapshotReason.Timed, false, {
      interactionState: { screenLifecycle: { revision: 999 }, question: 'new' },
    });
    const saved = await snapshots.loadLatestValid(1);
    expect(saved?.interactionState.question).toBe('new');
    expect((await lifecycle.getValid(actor, target))?.revision).toBe(1);
    expect(saved?.attendanceState).toEqual({ present: [1] });
    expect(saved?.rewardState).toEqual({ stars: 3 });
    expect(saved?.rollCallState).toEqual({ last: 1 });
    expect(() => snapshots.claimScreenLifecycleWriter()).toThrow(
      'already registered',
    );
  });
  it('serializes concurrent same-revision updates and checkpoint preservation', async () => {
    const results = await Promise.allSettled([
      lifecycle.createOpening(actor, target),
      lifecycle.createOpening(actor, target),
      snapshots.capture(1, ClassroomSnapshotReason.Timed, false, {
        interactionState: { screenLifecycle: { revision: 999 } },
      }),
    ]);
    expect(
      results.slice(0, 2).filter((x) => x.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.slice(0, 2).filter((x) => x.status === 'rejected'),
    ).toHaveLength(1);
    expect((await lifecycle.getValid(actor, target))?.revision).toBe(1);
  });
  it('creates bounded summary only after completion and closes it', async () => {
    await expect(lifecycle.createSummary(actor, target)).rejects.toThrow(
      '已完成',
    );
    await db
      .getRepository(ClassroomRun)
      .update(1, { status: ClassroomRunStatus.Completed, endedAt: new Date() });
    const summary = await lifecycle.createSummary(actor, target, 20);
    expect(summary.expiresAt).not.toBeNull();
    expect((await lifecycle.getValid(actor, target))?.phase).toBe('summary');
    await lifecycle.closeSummary(actor, { ...target, expectedRevision: 1 });
    expect(await lifecycle.getValid(actor, target)).toBeNull();
    await expect(
      lifecycle.createSummary(actor, { ...target, expectedRevision: 2 }),
    ).rejects.toThrow('重复');
  });
  it('expires summary without a timer or database deletion', async () => {
    await db
      .getRepository(ClassroomRun)
      .update(1, { status: ClassroomRunStatus.Completed, endedAt: new Date() });
    const summary = await lifecycle.createSummary(actor, target, 1);
    const originalNow = Date.now;
    Date.now = () => Date.parse(summary.expiresAt!) + 1;
    try {
      expect(await lifecycle.getValid(actor, target)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
    expect(
      (await snapshots.loadLatestValid(1))?.interactionState,
    ).toHaveProperty('screenLifecycle');
  });
  it('rejects wrong actor, device and binding', async () => {
    await expect(
      lifecycle.createOpening({ ...actor, sub: 2 }, target),
    ).rejects.toThrow('其他教师');
    await expect(
      lifecycle.createOpening(actor, { ...target, deviceId: 2 }),
    ).rejects.toThrow();
    await expect(
      lifecycle.createOpening(actor, { ...target, bindingId: 2 }),
    ).rejects.toThrow('绑定');
  });
  it('invalidates old binding and cannot resurrect it using a new binding', async () => {
    await lifecycle.createOpening(actor, target);
    await db
      .getRepository(DeviceBinding)
      .update(1, { status: BindingStatus.Unbound });
    await expect(lifecycle.getValid(actor, target)).rejects.toThrow('绑定');
    await db
      .getRepository(DeviceBinding)
      .save({
        id: 2,
        deviceId: 1,
        classroomId: 1,
        classId: 1,
        boundByType: AuthUserType.Teacher,
        boundBy: 1,
        boundAt: new Date(),
        status: BindingStatus.Active,
      });
    expect(
      await lifecycle.getValid(actor, { ...target, bindingId: 2 }),
    ).toBeNull();
  });
  it('new run supersedes old lifecycle without rewriting history', async () => {
    await lifecycle.createOpening(actor, target);
    await db
      .getRepository(ClassroomRun)
      .update(1, { status: ClassroomRunStatus.Completed, endedAt: new Date() });
    await db
      .getRepository(ClassroomRun)
      .save({
        id: 2,
        lessonPlanId: 1,
        lessonPlanVersion: 1,
        teacherId: 1,
        classId: 1,
        classroomId: 1,
        deviceId: 1,
        title: 'new',
        status: ClassroomRunStatus.Running,
        startedAt: new Date(),
      });
    await expect(lifecycle.getValid(actor, target)).rejects.toThrow('新的课堂');
    await expect(
      lifecycle.createSummary(actor, { ...target, expectedRevision: 1 }),
    ).rejects.toThrow('新的课堂');
    await snapshots.capture(2, ClassroomSnapshotReason.Start, true);
    expect(
      (await lifecycle.createOpening(actor, { ...target, runId: 2 })).revision,
    ).toBe(1);
    expect(
      (await snapshots.loadLatestValid(1))?.interactionState,
    ).toHaveProperty('screenLifecycle');
  });
  it('survives service recreation without resetting revision', async () => {
    await lifecycle.createOpening(actor, target);
    const restoredSnapshots = new ClassroomSnapshotService(
      db.getRepository(ClassroomRun),
      db.getRepository(ClassroomSnapshot),
      db.getRepository(ClassroomEvent),
    );
    const restored = new ScreenLifecycleService(restoredSnapshots, {
      requireClassAccess: async () => ({}),
    } as unknown as PlatformAccessService);
    expect((await restored.getValid(actor, target))?.revision).toBe(1);
    expect(
      (
        await restored.completeOpening(actor, {
          ...target,
          expectedRevision: 1,
        })
      ).revision,
    ).toBe(2);
  });
  it('does not create a lifecycle for yesterday or historical completion', async () => {
    await db
      .getRepository(ClassroomRun)
      .update(1, { startedAt: new Date(Date.now() - 86400000) });
    await expect(lifecycle.createOpening(actor, target)).rejects.toThrow(
      '跨日',
    );
    await db
      .getRepository(ClassroomRun)
      .update(1, {
        status: ClassroomRunStatus.Completed,
        endedAt: new Date(Date.now() - 180000),
      });
    await expect(lifecycle.createSummary(actor, target)).rejects.toThrow(
      '展示窗口',
    );
  });
});
