import { jest } from '@jest/globals';
import { HeuristicAssistantService } from './heuristic-assistant.service';

describe('heuristic TTS phase gate (no network in forbidden phases)', () => {
  it.each(['paused', 'opening', 'completed', 'recovery'])('%s cannot synthesize or mark a draft played', async phase => {
    const service = Object.create(HeuristicAssistantService.prototype) as any;
    const run = { id: 1, teacherId: 1, deviceId: 1, version: 1,
      status: phase === 'paused' ? 'paused' : phase === 'completed' ? 'completed' : 'running', startedAt: new Date() };
    const binding = { id: 1, deviceId: 1 };
    const manager = { connection: { hasMetadata: () => false }, getRepository: () => ({ findOne: async () => binding }) };
    const tts = jest.fn();
    const save = jest.fn();
    Object.assign(service, {
      requireOwnedDraft: async () => ({ id: 1, classroomRunId: 1, status: 'confirmed', responseText: '固定候选' }),
      requireActiveOwnedRun: async () => run, runs: { manager }, drafts: { save }, audio: { tts },
      operationSnapshots: { loadLatestValid: async () => phase === 'recovery' ? null : ({
        entity: { deviceId: 1 }, interactionState: phase === 'opening' ? { screenLifecycle: {
          schemaVersion: 1, phase: 'opening', runId: 1, deviceId: 1, bindingId: 1,
          revision: 1, enteredAt: new Date().toISOString(), expiresAt: null,
        } } : {},
      }) },
    });
    await expect(service.play({ sub: 1, userType: 'teacher' }, 1)).rejects.toMatchObject({ status: 409 });
    expect(tts).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
});
