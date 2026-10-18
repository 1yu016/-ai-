import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClassroomRun } from '../../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshotService } from '../../src/classroom-runs/classroom-snapshot.service';
import { ScreenLifecycleService, type ScreenLifecycle } from '../../src/classroom-runs/screen-lifecycle.service';
import { ClassroomSnapshotReason } from '../../src/classroom-runs/classroom-run.types';
import { AuthUserType } from '../../src/auth/entities/refresh-token-session.entity';

/** Test-owned synthetic runs only. Uses the real opening completion, not a policy mock. */
export async function enterTeachingFixture(app: INestApplication, runId: number) {
  const db = app.get(DataSource);
  let run = await db.getRepository(ClassroomRun).findOneByOrFail({ id: runId });
  if (!run.startedAt) {
    await db.getRepository(ClassroomRun).update(runId, { startedAt: new Date() });
    run = await db.getRepository(ClassroomRun).findOneByOrFail({ id: runId });
  }
  const snapshots = app.get(ClassroomSnapshotService);
  let latest = await snapshots.loadLatestValid(runId);
  if (!latest) latest = await snapshots.capture(runId, ClassroomSnapshotReason.Start, true);
  const lifecycle = latest?.interactionState.screenLifecycle as ScreenLifecycle | undefined;
  if (lifecycle?.phase === 'opening') await app.get(ScreenLifecycleService).completeOpening(
    { sub: run.teacherId, userType: AuthUserType.Teacher } as any,
    { runId, deviceId: run.deviceId, bindingId: lifecycle.bindingId, expectedRevision: lifecycle.revision });
}
