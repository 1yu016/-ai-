import { CLASSROOM_OPERATIONS, decideOperation, operationPhase, policyAllowedActions } from './classroom-operation-policy';

describe('0.5-4A shared pure operation policy', () => {
  const contexts = [
    {}, { preparation: true }, { runStatus: 'running', opening: true },
    { runStatus: 'running' }, { runStatus: 'paused', opening: true },
    { runStatus: 'completed', summary: true }, { runStatus: 'cancelled' },
    { runStatus: 'failed' }, { runStatus: 'running', recovery: true },
    { runStatus: 'running', breakActive: true },
  ];
  it.each(contexts.flatMap(context => CLASSROOM_OPERATIONS.map(operation => ({ context, operation }))))(
    'allowedActions exactly agrees with first-execution decision: %j', ({ context, operation }) => {
      expect(policyAllowedActions(context).includes(operation)).toBe(decideOperation(context, operation).allowed);
    });
  const teaching = ['change_step', 'resource_start', 'tts', 'roll_call', 'reward', 'attendance_new', 'queue_edit'] as const;
  it.each(['opening', 'paused', 'summary', 'terminal', 'recovery'].flatMap(phase => teaching.map(operation => ({ phase, operation }))))(
    'rejects teaching $operation in $phase', ({ phase, operation }) => {
      const context = phase === 'opening' ? { runStatus: 'running', opening: true }
        : phase === 'paused' ? { runStatus: 'paused', opening: true }
        : phase === 'recovery' ? { runStatus: 'running', recovery: true }
        : { runStatus: 'completed', summary: phase === 'summary' };
      expect(decideOperation(context, operation).allowed).toBe(false);
    });
  it.each(teaching)('teaching permits %s subject to domain guards', operation => {
    expect(decideOperation({ runStatus: 'running' }, operation).allowed).toBe(true);
  });
  it('paused wins over an opening marker, without mutating the input', () => {
    const context = Object.freeze({ runStatus: 'paused', opening: true });
    expect(operationPhase(context)).toBe('paused');
    expect(policyAllowedActions(context)).toEqual(['query', 'resume', 'complete', 'cancel', 'safe_stop',
      'attendance_correction', 'reward_revoke', 'collective_reward_revoke', 'checkpoint']);
  });
  it.each(contexts)('verified successful replay is independent of phase: %j', context => {
    expect(decideOperation({ ...context, execution: 'committed_replay' }, 'reward').allowed).toBe(true);
  });
  it('keeps correction separate from new teaching facts during a break', () => {
    expect(decideOperation({ runStatus: 'paused' }, 'reward_revoke').reason).toBe('existing_fact_correction');
    expect(decideOperation({ runStatus: 'running', breakActive: true }, 'reward').allowed).toBe(false);
    expect(decideOperation({ runStatus: 'running', breakActive: true }, 'end_break').allowed).toBe(true);
  });
  const corrections = ['attendance_correction', 'reward_revoke', 'collective_reward_revoke'] as const;
  it.each(corrections.flatMap(operation => [
    { runStatus: 'running', opening: true }, { runStatus: 'running' },
    { runStatus: 'paused', opening: true }, { runStatus: 'paused', breakActive: true },
  ].map(context => ({ operation, context }))))('4D permits existing-fact correction: %j', ({ operation, context }) => {
    expect(decideOperation(context, operation).allowed).toBe(true);
  });
  it.each(corrections.flatMap(operation => [
    {}, { preparation: true }, { runStatus: 'completed', summary: true },
    { runStatus: 'completed' }, { runStatus: 'cancelled' }, { runStatus: 'failed' },
  ].map(context => ({ operation, context }))))('4D rejects first post-class correction: %j', ({ operation, context }) => {
    expect(decideOperation(context, operation).allowed).toBe(false);
    expect(decideOperation({ ...context, execution: 'committed_replay' }, operation).allowed).toBe(true);
  });
  it.each(corrections)('4D does not silently redefine uncertain correction rules: %s', operation => {
    for (const context of [{ runStatus: 'running', recovery: true }, { runStatus: 'prepared' }]) {
      expect(decideOperation(context, operation).reason).toBe('existing_correction_guard');
      expect(policyAllowedActions(context)).not.toContain(operation);
    }
  });
  it('keeps a legacy prepared reservation separate from READY, with only legacy cancellation guards', () => {
    expect(operationPhase({ runStatus: 'prepared' })).toBe('reserved');
    expect(policyAllowedActions({ runStatus: 'prepared' })).toEqual(['query', 'cancel', 'fail']);
    expect(policyAllowedActions({ preparation: true })).toEqual(['query', 'prepare', 'cancel_preparation', 'start']);
  });
});
