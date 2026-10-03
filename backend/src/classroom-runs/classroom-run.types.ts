export enum ClassroomRunStatus {
  Prepared = 'prepared',
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export enum ClassroomEventType {
  Start = 'start',
  Pause = 'pause',
  Resume = 'resume',
  Complete = 'complete',
  Cancel = 'cancel',
  ChangeStep = 'change_step',
  Fail = 'fail',
  Checkpoint = 'checkpoint',
  Takeover = 'takeover',
  Recover = 'recover',
  SnapshotFailed = 'snapshot_failed',
  AvatarBinding = 'avatar_binding',
  // Stage 7.4：课间休息开始/提前结束。
  BreakStart = 'break_start',
  BreakEnd = 'break_end',
}

export enum ClassroomEventResult {
  Success = 'success',
  Failure = 'failure',
}

export const ACTIVE_CLASSROOM_RUN_STATUSES = [
  ClassroomRunStatus.Prepared,
  ClassroomRunStatus.Running,
  ClassroomRunStatus.Paused,
] as const;

export const TERMINAL_CLASSROOM_RUN_STATUSES = [
  ClassroomRunStatus.Completed,
  ClassroomRunStatus.Cancelled,
  ClassroomRunStatus.Failed,
] as const;

export enum ClassroomSnapshotReason {
  Start = 'start',
  ChangeStep = 'change_step',
  Pause = 'pause',
  Resume = 'resume',
  Complete = 'complete',
  Cancel = 'cancel',
  ResourceCompleted = 'resource_completed',
  RollCall = 'roll_call',
  Reward = 'reward',
  RecoverableError = 'recoverable_error',
  Timed = 'timed',
  Takeover = 'takeover',
  Recover = 'recover',
  AvatarBinding = 'avatar_binding',
  // Stage 7.4：课间休息开始/提前结束。
  BreakStart = 'break_start',
  BreakEnd = 'break_end',
}

/**
 * Stage 7.4：唯一课间判定。
 * 课间 = status running && breakEndsAt 非空 && breakEndsAt > now。
 * 不能只看 breakEndsAt 非空：自然到期后字段可能尚未惰性清理。
 * now 接受 number 毫秒时间戳或 Date。
 */
export function isBreakActive(
  run: {
    status: ClassroomRunStatus;
    breakEndsAt?: Date | string | null;
  },
  now: number | Date = Date.now(),
): boolean {
  if (run.status !== ClassroomRunStatus.Running) return false;
  if (run.breakEndsAt == null) return false;
  const endsAt = new Date(run.breakEndsAt).getTime();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return Number.isFinite(endsAt) && endsAt > nowMs;
}

export enum ClassroomCheckpointType {
  ResourceCompleted = 'resource_completed',
  RollCall = 'roll_call',
  Reward = 'reward',
  RecoverableError = 'recoverable_error',
  Timed = 'timed',
}
