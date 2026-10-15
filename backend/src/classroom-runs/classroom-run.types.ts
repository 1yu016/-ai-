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
  Command = 'command',
  Attendance = 'attendance',
  RollCall = 'roll_call',
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

/** 课间内容只能来自内置白名单；卡片不包含 URL、广告或可执行内容。 */
export enum ClassroomBreakContentType {
  Water = 'water',
  Toilet = 'toilet',
  Movement = 'movement',
  EyeExercise = 'eye_exercise',
  LightMusic = 'light_music',
  Safety = 'safety',
}

export const CLASSROOM_BREAK_CONTENT = {
  [ClassroomBreakContentType.Water]: {
    title: '喝水时间',
    message: '小口慢慢喝水，喝完把水杯放回原位。',
    icon: '🥤',
    avatarAction: 'encourage',
  },
  [ClassroomBreakContentType.Toilet]: {
    title: '如厕时间',
    message: '排好队、不拥挤，有需要就告诉老师。',
    icon: '🚻',
    avatarAction: 'wave',
  },
  [ClassroomBreakContentType.Movement]: {
    title: '快乐律动',
    message: '跟着老师轻轻活动，不推挤，和身边小朋友保持距离。',
    icon: '🎵',
    avatarAction: 'happy',
  },
  [ClassroomBreakContentType.EyeExercise]: {
    title: '眼睛休息一下',
    message: '看看远处，轻轻眨眼，不用手揉眼睛。',
    icon: '👀',
    avatarAction: 'idle',
  },
  [ClassroomBreakContentType.LightMusic]: {
    title: '轻音乐时间',
    message: '安静听一会儿音乐，让身体和心情都放松下来。',
    icon: '🎶',
    avatarAction: 'idle',
  },
  [ClassroomBreakContentType.Safety]: {
    title: '安全小提醒',
    message: '慢慢走、不奔跑，遇到困难马上告诉老师。',
    icon: '🛡️',
    avatarAction: 'encourage',
  },
} as const;

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
  Command = 'command',
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
  Command = 'command',
}
