import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { TeacherRole } from '../auth/entities/teacher.entity';
import type { AuditService } from '../platform/audit.service';
import { ResourceAiService } from './resource-ai.service';

describe('ResourceAiService', () => {
  it('rejects malformed model JSON and records a failed call without saving it', async () => {
    const writeAi = jest.fn<AuditService['writeAi']>().mockResolvedValue();
    const config = {
      get: (key: string) =>
        ({
          ARK_API_KEY: 'test-key',
          ARK_ENDPOINT_ID: 'test-model',
          AI_REQUEST_TIMEOUT_MS: '1000',
        })[key],
    } as ConfigService;
    const service = new ResourceAiService(config, {
      writeAi,
    } as unknown as AuditService);
    const internal = service as unknown as {
      client: {
        chat: {
          completions: {
            create: ReturnType<typeof jest.fn>;
          };
        };
      };
    };
    internal.client.chat.completions.create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"tags":"not-an-array"}' } }],
    });
    const actor: JwtTeacherPayload = {
      sub: 1,
      account: 'teacher',
      name: '教师',
      role: TeacherRole.Teacher,
      userType: AuthUserType.Teacher,
      tokenVersion: 0,
    };
    await expect(
      service.suggest(actor, {
        title: '春天',
        description: null,
        resourceType: 'image',
        existingTags: [],
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(writeAi).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        feature: 'resource_tagging',
      }),
    );
  });
});
