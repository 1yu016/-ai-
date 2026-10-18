import { createHash } from 'node:crypto';
import type { ClassroomSnapshotService, ClassroomSnapshotPatch } from '../../src/classroom-runs/classroom-snapshot.service';
import type { ClassroomSnapshotReason } from '../../src/classroom-runs/classroom-run.types';

/** Test-only historical/corrupt Snapshot fixture. Never a production writer API. */
export async function seedSnapshotFixture(service: ClassroomSnapshotService, runId: number,
  reason: ClassroomSnapshotReason, isKey: boolean, patch: ClassroomSnapshotPatch) {
  const { rewardState, attendanceState, rollCallState, ...control } = patch;
  const current = (await service.capture(runId, reason, isKey, control))!;
  const entity = current.entity;
  const state = { classroomRunId: entity.classroomRunId, snapshotVersion: entity.snapshotVersion,
    runVersion: entity.runVersion, runStatus: entity.runStatus, currentStepIndex: entity.currentStepIndex,
    elapsedSeconds: entity.elapsedSeconds, playedResourceIds: JSON.parse(entity.playedResourceIds),
    attendanceState: attendanceState ?? JSON.parse(entity.attendanceState),
    rollCallState: rollCallState ?? JSON.parse(entity.rollCallState), rewardState: rewardState ?? JSON.parse(entity.rewardState),
    interactionState: JSON.parse(entity.interactionState), playerState: JSON.parse(entity.playerState),
    deviceId: entity.deviceId, avatarVersionId: entity.avatarVersionId, avatarCharacterId: entity.avatarCharacterId,
    reason: entity.reason, isKey: entity.isKey };
  await (service as any).snapshots.update(entity.id, { attendanceState: JSON.stringify(state.attendanceState),
    rollCallState: JSON.stringify(state.rollCallState), rewardState: JSON.stringify(state.rewardState),
    checksum: createHash('sha256').update(JSON.stringify(state)).digest('hex') });
  return service.loadLatestValid(runId);
}
