import { ConflictException } from '@nestjs/common';
import { ClassroomRunStatus } from './classroom-run.types';

const TRANSITIONS: Readonly<Record<ClassroomRunStatus, ClassroomRunStatus[]>> =
  {
    [ClassroomRunStatus.Prepared]: [ClassroomRunStatus.Running],
    [ClassroomRunStatus.Running]: [
      ClassroomRunStatus.Paused,
      ClassroomRunStatus.Completed,
      ClassroomRunStatus.Cancelled,
      ClassroomRunStatus.Failed,
    ],
    [ClassroomRunStatus.Paused]: [
      ClassroomRunStatus.Running,
      ClassroomRunStatus.Completed,
      ClassroomRunStatus.Cancelled,
      ClassroomRunStatus.Failed,
    ],
    [ClassroomRunStatus.Completed]: [],
    [ClassroomRunStatus.Cancelled]: [],
    [ClassroomRunStatus.Failed]: [],
  };

export function assertClassroomRunTransition(
  from: ClassroomRunStatus,
  to: ClassroomRunStatus,
): void {
  if (!TRANSITIONS[from].includes(to))
    throw new ConflictException(`课堂状态不能从 ${from} 转换为 ${to}`);
}

export function allowedClassroomRunTransitions(
  status: ClassroomRunStatus,
): readonly ClassroomRunStatus[] {
  return TRANSITIONS[status];
}
