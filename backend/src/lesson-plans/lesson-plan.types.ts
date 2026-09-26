export enum LessonAgeGroup {
  ThreeToFour = '3-4',
  FourToFive = '4-5',
  FiveToSix = '5-6',
}

export enum LessonPlanStatus {
  Draft = 'draft',
  Ready = 'ready',
  Archived = 'archived',
}

export enum LessonStepType {
  Introduction = 'introduction',
  TeacherTalk = 'teacher_talk',
  Question = 'question',
  Resource = 'resource',
  Activity = 'activity',
  Transition = 'transition',
  Summary = 'summary',
}

export enum LessonRunStatus {
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export type LessonStepSnapshot = {
  id: number;
  sortOrder: number;
  title: string;
  stepType: LessonStepType;
  instruction: string;
  expectedResponse: string | null;
  teacherTip: string | null;
  resourceId: number | null;
  durationSeconds: number;
  resource: Record<string, unknown> | null;
};
