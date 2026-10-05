import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AiController } from './ai/ai.controller';
import { AuthController } from './auth/auth.controller';
import { EmotionController } from './data/emotion.controller';

function guardsFor(target: object, methodName: string): unknown[] {
  const method = Reflect.get(target, methodName) as object;
  return (Reflect.getMetadata(GUARDS_METADATA, method) as unknown[]) ?? [];
}

describe('public endpoint throttling metadata', () => {
  it.each(['chat', 'asr', 'tts', 'voiceChat'])(
    'protects AiController.%s with ThrottlerGuard',
    (methodName) => {
      expect(guardsFor(AiController.prototype, methodName)).toContain(
        ThrottlerGuard,
      );
    },
  );

  it('protects EmotionController.report with ThrottlerGuard', () => {
    expect(guardsFor(EmotionController.prototype, 'report')).toContain(
      ThrottlerGuard,
    );
  });

  it.each(['login', 'adminLogin', 'refresh'])(
    'rate limits AuthController.%s',
    (methodName) => {
      expect(guardsFor(AuthController.prototype, methodName)).toContain(
        ThrottlerGuard,
      );
    },
  );

  it('does not rate limit the authenticated profile endpoint', () => {
    expect(guardsFor(AuthController.prototype, 'profile')).not.toContain(
      ThrottlerGuard,
    );
  });
});
