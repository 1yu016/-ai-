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
}

export enum ClassroomCheckpointType {
  ResourceCompleted = 'resource_completed',
  RollCall = 'roll_call',
  Reward = 'reward',
  RecoverableError = 'recoverable_error',
  Timed = 'timed',
}
