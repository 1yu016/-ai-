import { ClassroomEventType, ClassroomRunStatus } from './classroom-run.types';
import { analyzeStepTimings, completedResourceIds } from './classroom-analysis';

describe('classroom analysis', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const event = (id: number, eventType: ClassroomEventType, seconds: number, payload: unknown = {}) => ({
    id,
    eventType,
    createdAt: new Date(start.getTime() + seconds * 1000),
    payload: JSON.stringify(payload),
  });

  it('calculates per-step active time and excludes pause and break intervals', () => {
    const result = analyzeStepTimings({
      startedAt: start, endedAt: new Date(start.getTime() + 200_000), status: ClassroomRunStatus.Completed, elapsedSeconds: 200,
    }, [
      { stepIndex: 0, title: '观察', durationSeconds: 100 },
      { stepIndex: 1, title: '交流', durationSeconds: 100 },
    ], [
      event(1, ClassroomEventType.Pause, 40),
      event(2, ClassroomEventType.Resume, 70),
      event(3, ClassroomEventType.ChangeStep, 120, { stepIndex: 1 }),
      event(4, ClassroomEventType.BreakStart, 150),
      event(5, ClassroomEventType.BreakEnd, 180),
      event(6, ClassroomEventType.Complete, 200),
    ]);
    expect(result.timings.map((item) => item.actualSeconds)).toEqual([90, 50]);
    expect(result.timings.map((item) => item.variance)).toEqual(['within_plan', 'short']);
  });

  it('marks steps without event coverage unknown and reports index jumps explicitly', () => {
    const result = analyzeStepTimings({
      startedAt: start, endedAt: new Date(start.getTime() + 10_000), status: ClassroomRunStatus.Completed, elapsedSeconds: 10,
    }, [0, 1, 2].map((stepIndex) => ({ stepIndex, title: `环节${stepIndex}`, durationSeconds: 100 })), [
      event(1, ClassroomEventType.ChangeStep, 2, { stepIndex: 2 }),
      event(2, ClassroomEventType.Complete, 10),
    ]);
    expect(result.timings[1]?.coverage).toBe('incomplete');
    expect(result.indexJumps.map(({ from, to }) => [from, to])).toEqual([[0, 2]]);
  });

  it('counts only completed playback checkpoints with a valid resource id', () => {
    const events = [
      event(1, ClassroomEventType.Checkpoint, 1, { checkpointType: 'resource_completed', resourceId: 9 }),
      event(2, ClassroomEventType.Checkpoint, 2, { checkpointType: 'command', resourceId: 9 }),
      event(3, ClassroomEventType.Checkpoint, 3, { checkpointType: 'resource_completed', resourceId: -1 }),
    ];
    expect(completedResourceIds(events)).toEqual([9]);
  });
});
