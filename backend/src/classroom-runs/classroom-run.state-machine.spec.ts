import { ConflictException } from '@nestjs/common';
import {
  allowedClassroomRunTransitions,
  assertClassroomRunTransition,
} from './classroom-run.state-machine';
import { ClassroomRunStatus } from './classroom-run.types';

describe('classroom run state machine', () => {
  it.each([
    [ClassroomRunStatus.Prepared, ClassroomRunStatus.Running],
    [ClassroomRunStatus.Running, ClassroomRunStatus.Paused],
    [ClassroomRunStatus.Paused, ClassroomRunStatus.Running],
    [ClassroomRunStatus.Running, ClassroomRunStatus.Completed],
    [ClassroomRunStatus.Paused, ClassroomRunStatus.Completed],
    [ClassroomRunStatus.Running, ClassroomRunStatus.Cancelled],
    [ClassroomRunStatus.Paused, ClassroomRunStatus.Cancelled],
    [ClassroomRunStatus.Running, ClassroomRunStatus.Failed],
    [ClassroomRunStatus.Paused, ClassroomRunStatus.Failed],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertClassroomRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ClassroomRunStatus.Completed,
    ClassroomRunStatus.Cancelled,
    ClassroomRunStatus.Failed,
  ])('protects terminal status %s', (status) => {
    expect(allowedClassroomRunTransitions(status)).toEqual([]);
    expect(() =>
      assertClassroomRunTransition(status, ClassroomRunStatus.Running),
    ).toThrow(ConflictException);
  });

  it('rejects skipping directly from prepared to a terminal state', () => {
    expect(() =>
      assertClassroomRunTransition(
        ClassroomRunStatus.Prepared,
        ClassroomRunStatus.Completed,
      ),
    ).toThrow(ConflictException);
  });
});
