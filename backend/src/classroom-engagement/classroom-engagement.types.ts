export enum RewardType {
  Answer = 'answer',
  Cooperation = 'cooperation',
  Focus = 'focus',
  Labor = 'labor',
  Exploration = 'exploration',
  Progress = 'progress',
}

export enum RewardRecordStatus {
  Active = 'active',
  Reversed = 'reversed',
}

export enum HonorType {
  TodayStar = 'today_star',
  CooperationStar = 'cooperation_star',
  ExplorationStar = 'exploration_star',
  LaborStar = 'labor_star',
  Collective = 'collective',
}

export enum HonorStatus {
  Draft = 'draft',
  Published = 'published',
  Revoked = 'revoked',
}

export enum CollectiveGoalStatus {
  Active = 'active',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum GrowthEventType {
  Reward = 'reward',
  RewardReversal = 'reward_reversal',
  TeacherAdjustment = 'teacher_adjustment',
  GoalCompleted = 'goal_completed',
}

export enum BreakType {
  Water = 'water',
  Toilet = 'toilet',
  Activity = 'activity',
  EyeExercise = 'eye_exercise',
  Custom = 'custom',
}

export enum BreakRunStatus {
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Cancelled = 'cancelled',
  AutoTerminated = 'auto_terminated',
}

export const ACTIVE_BREAK_STATUSES = [
  BreakRunStatus.Running,
  BreakRunStatus.Paused,
] as const;
