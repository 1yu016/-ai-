import { ClassroomEventType, ClassroomRunStatus } from './classroom-run.types';

export type AnalysisEvent = {
  id: number;
  eventType: ClassroomEventType;
  createdAt: Date | string;
  payload: string | null;
};

export type AnalysisStep = {
  stepIndex: number;
  title: string;
  durationSeconds: number;
};

export type AnalysisRun = {
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  status: ClassroomRunStatus;
  elapsedSeconds: number;
};

export type StepTiming = AnalysisStep & {
  actualSeconds: number | null;
  deviationSeconds: number | null;
  variance: 'short' | 'within_plan' | 'over' | 'unknown';
  coverage: 'measured' | 'incomplete';
};

const MAX_STEP_VARIANCE = 0.25;

function parsePayload(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Derives teaching time from persisted Run events; pause and break intervals are excluded. */
export function analyzeStepTimings(
  run: AnalysisRun,
  steps: AnalysisStep[],
  events: AnalysisEvent[],
  now = new Date(),
): { timings: StepTiming[]; indexJumps: Array<{ from: number; to: number; at: Date }> } {
  const orderedSteps = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const startMs = run.startedAt ? new Date(run.startedAt).getTime() : NaN;
  if (!Number.isFinite(startMs) || !orderedSteps.length) {
    return {
      timings: orderedSteps.map((step) => ({ ...step, actualSeconds: null, deviationSeconds: null, variance: 'unknown', coverage: 'incomplete' })),
      indexJumps: [],
    };
  }

  const terminalTime = run.endedAt ? new Date(run.endedAt).getTime() : now.getTime();
  const elapsedByStep = new Map<number, number>();
  const seen = new Set<number>();
  const indexJumps: Array<{ from: number; to: number; at: Date }> = [];
  let currentStep = orderedSteps[0]!.stepIndex;
  let cursor = startMs;
  let active = true;

  const addInterval = (until: number) => {
    const end = Math.max(cursor, Math.min(until, terminalTime));
    if (active && end > cursor && orderedSteps.some((step) => step.stepIndex === currentStep)) {
      elapsedByStep.set(currentStep, (elapsedByStep.get(currentStep) ?? 0) + end - cursor);
      seen.add(currentStep);
    }
    cursor = end;
  };

  const relevant = [...events]
    .map((event) => ({ event, at: new Date(event.createdAt).getTime() }))
    .filter(({ at }) => Number.isFinite(at) && at >= startMs && at <= terminalTime)
    .sort((a, b) => a.at - b.at || a.event.id - b.event.id);

  for (const { event, at } of relevant) {
    if (at < cursor) continue;
    addInterval(at);
    if (event.eventType === ClassroomEventType.ChangeStep) {
      const target = Number(parsePayload(event.payload).stepIndex);
      if (Number.isInteger(target) && orderedSteps.some((step) => step.stepIndex === target)) {
        if (Math.abs(target - currentStep) > 1)
          indexJumps.push({ from: currentStep, to: target, at: new Date(at) });
        currentStep = target;
      }
    } else if (event.eventType === ClassroomEventType.Pause || event.eventType === ClassroomEventType.BreakStart) {
      active = false;
    } else if (event.eventType === ClassroomEventType.Resume || event.eventType === ClassroomEventType.BreakEnd) {
      active = true;
    } else if ([ClassroomEventType.Complete, ClassroomEventType.Cancel, ClassroomEventType.Fail].includes(event.eventType)) {
      active = false;
    }
  }
  if (run.status === ClassroomRunStatus.Running) addInterval(terminalTime);

  const timings = orderedSteps.map((step): StepTiming => {
    if (!seen.has(step.stepIndex))
      return { ...step, actualSeconds: null, deviationSeconds: null, variance: 'unknown', coverage: 'incomplete' };
    const actualSeconds = Math.round((elapsedByStep.get(step.stepIndex) ?? 0) / 1000);
    const deviationSeconds = actualSeconds - step.durationSeconds;
    const ratio = step.durationSeconds > 0 ? actualSeconds / step.durationSeconds : null;
    const variance = ratio === null ? 'unknown' : ratio < 1 - MAX_STEP_VARIANCE ? 'short' : ratio > 1 + MAX_STEP_VARIANCE ? 'over' : 'within_plan';
    return { ...step, actualSeconds, deviationSeconds, variance, coverage: 'measured' };
  });
  return { timings, indexJumps };
}

export function completedResourceIds(events: AnalysisEvent[]): number[] {
  return events
    .filter((event) => event.eventType === ClassroomEventType.Checkpoint)
    .map((event) => parsePayload(event.payload))
    .filter((payload) => payload.checkpointType === 'resource_completed')
    .map((payload) => Number(payload.resourceId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}
