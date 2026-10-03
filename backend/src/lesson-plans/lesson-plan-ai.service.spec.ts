import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { TeacherRole } from '../auth/entities/teacher.entity';
import type { AuditService } from '../platform/audit.service';
import { LessonPlanAiService } from './lesson-plan-ai.service';
import { LessonAgeGroup } from './lesson-plan.types';

const VALID_OUTPUT = {
  title: '春天的颜色',
  theme: '春天',
  ageGroup: '4-5',
  domain: '科学',
  estimatedMinutes: 20,
  teachingObjectives: ['观察并表达春天常见的颜色'],
  introduction: '请小朋友观察春天图片。',
  teachingProcess: [
    {
      title: '观察图片',
      stepType: 'resource',
      content: '观察图片中的颜色。',
      durationSeconds: 180,
      resourceId: 12,
    },
  ],
  interactiveQuestions: ['你发现了什么颜色？'],
  extensionActivities: ['到户外寻找春天的颜色。'],
  assessmentSuggestions: ['记录幼儿是否愿意观察和表达。'],
  resourceRecommendations: [{ resourceId: 12, reason: '适合观察颜色' }],
};

describe('LessonPlanAiService', () => {
  const actor: JwtTeacherPayload = {
    sub: 1,
    account: 'teacher',
    name: '教师',
    role: TeacherRole.Teacher,
    userType: AuthUserType.Teacher,
    tokenVersion: 0,
  };
  const input = {
    theme: '春天',
    ageGroup: LessonAgeGroup.FourToFive,
    domain: '科学',
    durationMinutes: 20,
    teachingObjectives: '观察颜色',
    resourceIds: [12],
  };

  function createService() {
    const writeAi = jest.fn<AuditService['writeAi']>().mockResolvedValue();
    const config = {
      get: (key: string) =>
        ({
          ARK_API_KEY: 'test-key',
          ARK_ENDPOINT_ID: 'test-model',
          AI_REQUEST_TIMEOUT_MS: '1000',
        })[key],
    } as ConfigService;
    const service = new LessonPlanAiService(config, {
      writeAi,
    } as unknown as AuditService);
    const internal = service as unknown as {
      openai: {
        chat: { completions: { create: ReturnType<typeof jest.fn> } };
      };
    };
    const create = jest.fn();
    internal.openai.chat.completions.create = create;
    return { service, create, writeAi };
  }

  it('validates a complete result and records model usage', async () => {
    const { service, create, writeAi } = createService();
    create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    });
    const result = await service.generate(actor, input);
    expect(result.output.title).toBe('春天的颜色');
    expect(result.totalTokens).toBe(300);
    expect(writeAi).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'lesson_plan_draft',
        status: 'success',
        model: 'test-model',
      }),
    );
  });

  it('retries malformed JSON twice and records a safe failure', async () => {
    const { service, create, writeAi } = createService();
    create.mockResolvedValue({
      choices: [{ message: { content: '{invalid-json' } }],
    });
    await expect(service.generate(actor, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(writeAi).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'invalid_output',
      }),
    );
  });

  it('retries provider timeouts and reports the timeout category', async () => {
    const { service, create, writeAi } = createService();
    create.mockRejectedValue(new Error('request timed out'));
    await expect(service.generate(actor, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(writeAi).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'timeout' }),
    );
  });

  it('rejects missing fields and resource ids outside the allowed set', async () => {
    const { service, create } = createService();
    create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...VALID_OUTPUT,
                introduction: undefined,
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...VALID_OUTPUT,
                teachingProcess: [
                  { ...VALID_OUTPUT.teachingProcess[0], resourceId: 999 },
                ],
              }),
            },
          },
        ],
      });
    await expect(service.generate(actor, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
