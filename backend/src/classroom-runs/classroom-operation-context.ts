import { ConflictException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { BreakRun } from '../classroom-engagement/entities/break-run.entity';
import { ACTIVE_BREAK_STATUSES } from '../classroom-engagement/classroom-engagement.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { BindingStatus } from '../platform/platform.types';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { decideOperation, type ClassroomOperation, type OperationContext } from './classroom-operation-policy';

/** Same-manager reads only; never starts a transaction or enters a Snapshot queue. */
export async function readOperationContext(run: ClassroomRun, manager: EntityManager,
  snapshots: ClassroomSnapshotService): Promise<OperationContext> {
  const input: OperationContext = { runStatus: run.status,
    breakActive: !!run.breakStartedAt && !!run.breakEndsAt };
  if (!['running', 'paused'].includes(run.status)) return input;
  if (manager.connection.hasMetadata(BreakRun)) input.breakActive ||= await manager.getRepository(BreakRun).existsBy({
    classroomRunId: run.id, status: In([...ACTIVE_BREAK_STATUSES]),
  });
  const latest = await snapshots.loadLatestValid(run.id, manager);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  if (!latest || latest.entity.deviceId !== run.deviceId || !run.startedAt ||
    !Number.isFinite(run.startedAt.getTime()) || run.startedAt.getTime() > Date.now() ||
    day.format(run.startedAt) !== day.format(new Date())) return { ...input, recovery: true };
  const raw = latest.interactionState.screenLifecycle;
  if (raw === undefined) return input; // Legacy Snapshot: never invent an opening.
  const v = raw as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || v.schemaVersion !== 1 ||
    v.runId !== run.id || v.deviceId !== run.deviceId ||
    !Number.isSafeInteger(v.bindingId) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 ||
    !['opening', 'teaching'].includes(String(v.phase)) || typeof v.enteredAt !== 'string' ||
    !Number.isFinite(Date.parse(v.enteredAt)) || Date.parse(v.enteredAt) > Date.now() ||
    (v.expiresAt !== null && (typeof v.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(v.expiresAt)) || Date.parse(v.expiresAt) <= Date.now())))
    return input; // Invalid/expired lifecycle projects no opening, matching ScreenLifecycle.getValid().
  const binding = await manager.getRepository(DeviceBinding).findOne({
    where: { deviceId: run.deviceId, status: BindingStatus.Active }, order: { boundAt: 'DESC', id: 'DESC' } });
  if (!binding || binding.id !== v.bindingId || binding.classId !== run.classId || binding.classroomId !== run.classroomId)
    return input; // A stale lifecycle cannot follow a device rebind or takeover.
  return { ...input, opening: v.phase === 'opening' };
}

export async function assertRunOperation(run: ClassroomRun, manager: EntityManager,
  snapshots: ClassroomSnapshotService, operation: ClassroomOperation) {
  const context = await readOperationContext(run, manager, snapshots);
  const decision = decideOperation(context, operation);
  // No new policy for correction semantics; retain their existing domain/terminal guards.
  if (decision.reason === 'existing_correction_guard') return;
  if (!decision.allowed) throw new ConflictException({ code: 'CLASSROOM_OPERATION_FORBIDDEN',
    phase: decision.phase, operation, message: '当前课堂阶段不允许此操作' });
}
