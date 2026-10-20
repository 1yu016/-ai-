import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AiController } from '../src/ai/ai.controller';
import { AiService } from '../src/ai/ai.service';
import { AudioService } from '../src/ai/audio.service';
import { ChatPersistenceService } from '../src/data/chat-persistence.service';
import { ResourceService } from '../src/resources/resource.service';
import { ClassroomDirectorService } from '../src/ai/classroom-director.service';
import { HeuristicAssistantService } from '../src/ai/heuristic-assistant.service';
import { ClassroomCommandService } from '../src/ai/classroom-command.service';
import { AuthGuard } from '../src/auth/auth.guard';
import { OptionalAuthGuard } from '../src/auth/optional-auth.guard';

describe('D9 actual HTTP disconnect propagation (no database or remote services)', () => {
  it('client abort reaches the active provider AbortSignal; no success is fabricated', async () => {
    let reached!: () => void, observed!: () => void;
    const ready = new Promise<void>(r => { reached = r; });
    const cancelled = new Promise<void>(r => { observed = r; });
    const audio = { tts: async (_text: string, signal: AbortSignal) => {
      reached();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { observed(); reject(Error('SYNTHETIC_PROVIDER_CANCELLED')); }, { once: true }));
      throw Error('Unexpected success');
    } };
    const fixture = await Test.createTestingModule({ controllers: [AiController], providers: [
      ...[AiService, ChatPersistenceService, ResourceService, ClassroomDirectorService, HeuristicAssistantService, ClassroomCommandService].map(provide => ({ provide, useValue: {} })),
      { provide: AudioService, useValue: audio },
    ] }).overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => false })
      .overrideGuard(OptionalAuthGuard).useValue({ canActivate: () => false }).compile();
    const app = fixture.createNestApplication(); app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = fetch(`${await app.getUrl()}/ai/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '合成测试' }), signal: abort.signal });
      await ready; abort.abort();
      await expect(request).rejects.toThrow();
      await Promise.race([cancelled, new Promise((_r, reject) => { timer = setTimeout(() => reject(Error('Abort was not forwarded')), 2000); })]);
    } finally { clearTimeout(timer); abort.abort(); await app.close(); }
  });
});
