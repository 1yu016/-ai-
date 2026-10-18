type State = Record<string, unknown>;

/** Command identity, never resource identity, correlates a player's report. */
export function mergePresentationObservation(control: State, report: State): State {
  if (typeof control.presentationCommandId !== 'string' || !control.presentationCommandId ||
      report.presentationCommandId !== control.presentationCommandId ||
      !Number.isSafeInteger(control.presentationRevision) ||
      report.presentationRevision !== control.presentationRevision) return control;
  const observation: State = {};
  if (typeof report.completed === 'boolean') observation.completed = report.completed;
  for (const key of ['currentTime', 'duration', 'pageIndex', 'pageCount']) {
    const value = report[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= (key.startsWith('page') ? 1 : 0) &&
        (!key.startsWith('page') || Number.isSafeInteger(value))) observation[key] = value;
  }
  if (['loading', 'ready', 'playing', 'paused', 'ended', 'error'].includes(String(report.status)))
    observation.status = report.status;
  // Structured codes only: never persist arbitrary URLs, exception text or HTML.
  if (typeof report.errorCode === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(report.errorCode))
    observation.errorCode = report.errorCode;
  return { ...control, ...Object.fromEntries(Object.entries(observation).filter(([key]) =>
    ['currentTime', 'duration', 'pageIndex', 'pageCount'].includes(key))),
    observation: { ...(control.observation as State), ...observation,
      presentationCommandId: control.presentationCommandId, presentationRevision: control.presentationRevision } };
}

export function applyPresentationControl(previous: State, patch: State, runVersion: number): State {
  const next = { ...patch };
  if (typeof patch.presentationCommandId === 'string' && patch.presentationCommandId &&
      patch.presentationCommandId !== previous.presentationCommandId) {
    next.presentationRevision = runVersion;
    delete next.observation;
  } else if (previous.presentationRevision !== undefined) next.presentationRevision = previous.presentationRevision;
  return next;
}

export function readablePresentation(state: State): State {
  if (!Object.keys(state).length) return state;
  return typeof state.presentationCommandId === 'string' && Number.isSafeInteger(state.presentationRevision)
    ? state : { ...state, autoPlay: false };
}
