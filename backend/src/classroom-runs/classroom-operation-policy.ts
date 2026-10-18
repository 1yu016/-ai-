/** Derived capabilities, not a second lifecycle. Authorization and CAS remain mandatory. */
export const CLASSROOM_OPERATIONS = [
  'query', 'prepare', 'cancel_preparation', 'start', 'complete_opening', 'skip_opening',
  'pause', 'resume', 'complete', 'cancel', 'fail', 'change_step', 'resource_start',
  'media_control', 'safe_stop', 'tts', 'roll_call', 'reward', 'attendance_new',
  'attendance_correction', 'reward_revoke', 'collective_reward_revoke', 'checkpoint', 'queue_edit',
  'avatar_binding', 'takeover', 'recover', 'start_break', 'end_break', 'close_summary',
] as const;
export type ClassroomOperation = typeof CLASSROOM_OPERATIONS[number];
export function commandPolicyOperation(operation: string): ClassroomOperation | null {
  if (['reward_student', 'revoke_reward', 'attendance_update', 'random_roll_call', 'specified_roll_call', 'group_roll_call'].includes(operation))
    return null; // Canonical service decides first fact versus correction inside its transaction.
  if (['previous_step', 'next_step', 'switch_step'].includes(operation)) return 'change_step';
  if (['stop_media', 'pause_media', 'mute'].includes(operation)) return 'safe_stop';
  if (['previous_page', 'next_page', 'zoom_in', 'zoom_out', 'set_volume'].includes(operation)) return 'media_control';
  if (operation === 'speak_text') return 'tts';
  const map: Record<string, ClassroomOperation> = { pause_class: 'pause', resume_class: 'resume',
    complete_class: 'complete', cancel_class: 'cancel', start_break: 'start_break', end_break: 'end_break',
    update_presentation_queue: 'queue_edit' };
  return map[operation] ?? 'resource_start';
}
export type OperationPhase = 'idle' | 'ready' | 'reserved' | 'opening' | 'teaching' | 'paused' | 'summary' | 'terminal' | 'recovery';
export type OperationContext = {
  runStatus?: string; opening?: boolean; preparation?: boolean; summary?: boolean;
  recovery?: boolean; breakActive?: boolean; execution?: 'first' | 'committed_replay';
};
export function operationPhase(input: OperationContext): OperationPhase {
  if (!input.runStatus) return input.preparation ? 'ready' : input.summary ? 'summary' : 'idle';
  if (['completed', 'cancelled', 'failed'].includes(input.runStatus))
    return input.runStatus === 'completed' && input.summary ? 'summary' : 'terminal';
  if (input.recovery) return 'recovery';
  if (input.runStatus === 'paused') return 'paused'; // Pause always wins over opening.
  if (input.runStatus === 'prepared') return 'reserved'; // Legacy Run reservation is not READY preparation.
  return input.runStatus === 'running' ? input.opening ? 'opening' : 'teaching' : 'recovery';
}
const matrix: Record<OperationPhase, readonly ClassroomOperation[]> = {
  idle: ['query', 'prepare', 'start'],
  ready: ['query', 'prepare', 'cancel_preparation', 'start'],
  reserved: ['query', 'cancel', 'fail'],
  opening: ['query', 'complete_opening', 'skip_opening', 'pause', 'complete', 'cancel'],
  teaching: ['query', 'pause', 'complete', 'cancel', 'fail', 'change_step', 'resource_start',
    'media_control', 'safe_stop', 'tts', 'roll_call', 'reward', 'attendance_new', 'checkpoint',
    'queue_edit', 'avatar_binding', 'takeover', 'recover', 'start_break'],
  paused: ['query', 'resume', 'complete', 'cancel', 'safe_stop', 'checkpoint'],
  summary: ['query', 'close_summary', 'prepare', 'start'],
  terminal: ['query', 'prepare', 'start'],
  recovery: ['query', 'recover', 'takeover', 'safe_stop', 'complete', 'cancel'],
};
export function decideOperation(input: OperationContext, operation: ClassroomOperation) {
  const phase = operationPhase(input);
  // Only a caller that already authenticated and verified a durable digest may set replay.
  if (input.execution === 'committed_replay') return { allowed: true, phase, reason: 'committed_replay' } as const;
  if (['attendance_correction', 'reward_revoke', 'collective_reward_revoke'].includes(operation)) {
    // Corrections repair existing canonical facts; they never start student presentation.
    // Preserve existing in-class correction rights, including during a break.
    if (['opening', 'teaching', 'paused'].includes(phase))
      return { allowed: true, phase, reason: 'existing_fact_correction' } as const;
    // Recovery/prepared semantics are not approved for change. Keep domain guards;
    // do not advertise these unresolved capabilities in allowedActions.
    if (['recovery', 'reserved'].includes(phase))
      return { allowed: false, phase, reason: 'existing_correction_guard' } as const;
    return { allowed: false, phase, reason: 'phase_forbidden' } as const;
  }
  const allowed = matrix[phase].includes(operation) && (!input.breakActive ||
    ['query', 'complete', 'cancel', 'end_break'].includes(operation));
  if (operation === 'end_break' && phase === 'teaching' && input.breakActive)
    return { allowed: true, phase, reason: 'allowed' } as const;
  return { allowed, phase, reason: allowed ? 'allowed' : 'phase_forbidden' } as const;
}
export function policyAllowedActions(input: OperationContext): ClassroomOperation[] {
  return CLASSROOM_OPERATIONS.filter(operation => decideOperation({ ...input, execution: 'first' }, operation).allowed);
}
