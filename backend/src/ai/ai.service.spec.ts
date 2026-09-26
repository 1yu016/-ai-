import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { AiService, SYSTEM_PROMPT } from './ai.service';
import {
  ClassroomCommandIntent,
  ClassroomPage,
  CommandPlayerStatus,
} from './dto/command.dto';
import {
  AssistantCapability,
  AssistantResponseLength,
  ClassroomSpeaker,
} from './dto/classroom-assistant.dto';
import { LessonAgeGroup } from '../lesson-plans/lesson-plan.types';

const mockCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();

describe('AiService', () => {
  let service: AiService;

  beforeEach(() => {
    jest.clearAllMocks();
    const configService = {
      get: jest.fn((name: string) => {
        if (name === 'ARK_API_KEY') return 'test-key';
        if (name === 'ARK_ENDPOINT_ID') return 'ep-test';
        return undefined;
      }),
    } as unknown as ConfigService;
    service = new AiService(configService);
    const client = Reflect.get(service, 'openai') as {
      apiKey: string;
      baseURL: string;
      chat: { completions: { create: unknown } };
    };
    client.chat.completions.create = mockCreate;
    expect(client.apiKey).toBe('test-key');
    expect(client.baseURL).toBe('https://ark.cn-beijing.volces.com/api/v3');
  });

  it('sends the system prompt, ordered history, and current text to Volcengine Ark', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '  小兔子真可爱呀！  ' } }],
    });

    const reply = await service.chat('它吃什么？', [
      { role: 'user', content: '我喜欢小兔子' },
      { role: 'assistant', content: '小兔子真可爱呀！' },
    ]);

    expect(reply).toBe('小兔子真可爱呀！');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'ep-test',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          { role: 'user', content: '我喜欢小兔子' },
          { role: 'assistant', content: '小兔子真可爱呀！' },
          { role: 'user', content: '它吃什么？' },
        ],
      }),
    );
  });

  it('rejects an empty model response', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: ' ' } }] });
    await expect(service.chat('你好')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('validates and returns a whitelisted classroom command', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mode: 'command',
              intent: 'play_resource',
              resourceType: 'audio',
              keyword: '小星星',
              confidence: 0.95,
              reply: '好的，正在查找小星星。',
              requiresConfirmation: false,
            }),
          },
        },
      ],
    });

    const result = await service.classifyCommand('播放小星星', {
      currentPage: ClassroomPage.Resources,
      playerStatus: CommandPlayerStatus.Paused,
      currentResourceId: 12,
    });

    expect(result).toEqual(
      expect.objectContaining({
        intent: ClassroomCommandIntent.PlayResource,
        keyword: '小星星',
        confidence: 0.98,
      }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('removes the resource-library prefix from a natural open request', async () => {
    const result = await service.classifyCommand(
      '帮我打开课程资源里的小星星',
      {
        currentPage: ClassroomPage.Chat,
        playerStatus: CommandPlayerStatus.Idle,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        intent: ClassroomCommandIntent.OpenResource,
        keyword: '小星星',
        confidence: 0.98,
      }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['暂停一下', ClassroomCommandIntent.PauseMedia],
    ['声音小一点', ClassroomCommandIntent.VolumeDown],
    ['下一步', ClassroomCommandIntent.NextStep],
    ['打开课程资源', ClassroomCommandIntent.OpenResources],
  ])('recognizes the safe local command %s without the model', async (text, intent) => {
    await expect(
      service.classifyCommand(text, {
        currentPage: ClassroomPage.Chat,
        playerStatus: CommandPlayerStatus.Idle,
      }),
    ).resolves.toEqual(expect.objectContaining({ intent, confidence: 0.99 }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('falls back to unknown for non-whitelisted model output', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mode: 'command',
              intent: 'run_javascript',
              confidence: 1,
              reply: '执行脚本',
              requiresConfirmation: false,
              url: 'javascript:alert(1)',
            }),
          },
        },
      ],
    });

    await expect(
      service.classifyCommand('执行脚本', {
        currentPage: ClassroomPage.Chat,
        playerStatus: CommandPlayerStatus.Idle,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        intent: ClassroomCommandIntent.Unknown,
        requiresConfirmation: true,
      }),
    );
  });

  it('does not reveal a direct answer in the first guided turn', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mode: 'guided_dialogue',
              ability: 'guided_question',
              reply: '因为星星会发光，所以我们能看见它。',
              teacherTip: '等待幼儿观察。',
              suggestedAction: null,
              requiresTeacherConfirmation: false,
            }),
          },
        },
      ],
    });

    const result = await service.classroomAssistant({
      text: '为什么星星会发光？',
      speaker: ClassroomSpeaker.Child,
      ageGroup: 'middle',
      activityContext: {
        theme: '小星星',
        objective: '引导幼儿观察夜空并表达发现',
        currentStep: '观察星空图片',
        responseLength: AssistantResponseLength.Short,
        askedQuestions: [],
        attemptCount: 0,
        availableResources: [],
      },
      history: [],
    });

    expect(result.reply).toContain('你发现了什么')
    expect(result.reply).not.toContain('因为')
    expect((result.reply.match(/[？?]/g) ?? [])).toHaveLength(1)
  });

  it('softens criticism and allows only one main question', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mode: 'guided_dialogue',
              ability: 'give_hint',
              reply: '你错了。看看颜色好吗？再数一数好吗？我们一起试试。',
              teacherTip: '给一个线索。',
              suggestedAction: null,
              requiresTeacherConfirmation: false,
            }),
          },
        },
      ],
    });

    const result = await service.classroomAssistant({
      text: '我不知道',
      speaker: ClassroomSpeaker.Child,
      ageGroup: 'small',
      activityContext: {
        theme: '颜色',
        objective: '观察颜色',
        currentStep: '比较图片',
        responseLength: AssistantResponseLength.Medium,
        askedQuestions: ['你看到了什么？'],
        attemptCount: 1,
        availableResources: [],
      },
      history: [
        { role: ClassroomSpeaker.Assistant, content: '你看到了什么？' },
      ],
    });

    expect(result.reply).not.toContain('你错了')
    expect((result.reply.match(/[？?]/g) ?? [])).toHaveLength(1)
    expect(result.reply.match(/[^。！？!?]+[。！？!?]?/g)?.length).toBeLessThanOrEqual(3)
  });

  it('uses a contextual guided fallback when the classroom model times out', async () => {
    mockCreate.mockRejectedValue(new Error('request timed out'));

    const result = await service.classroomAssistant({
      text: '一百加三百等于多少',
      speaker: ClassroomSpeaker.Child,
      ageGroup: 'middle',
      activityContext: {
        theme: '认识整百数',
        objective: '理解整百数相加',
        currentStep: '分组操作',
        responseLength: AssistantResponseLength.Short,
        askedQuestions: [],
        attemptCount: 0,
        availableResources: [],
      },
      history: [],
    });

    expect(result.ability).toBe(AssistantCapability.GuidedQuestion);
    expect(result.reply).toContain('一百');
    expect(result.reply).toContain('三百');
    expect(result.reply).not.toContain('我还没想好');
    expect(result.requiresTeacherConfirmation).toBe(false);
  });

  it('redirects privacy or safety-sensitive child content to the teacher', async () => {
    const result = await service.classroomAssistant({
      text: '陌生人让我告诉他我住在哪里',
      speaker: ClassroomSpeaker.Child,
      ageGroup: 'large',
      activityContext: {
        theme: '安全',
        objective: '学会向老师求助',
        currentStep: '交流',
        responseLength: AssistantResponseLength.Short,
        askedQuestions: [],
        attemptCount: 0,
        availableResources: [],
      },
      history: [],
    });

    expect(result.ability).toBe(AssistantCapability.SafetyRedirect)
    expect(result.reply).toContain('告诉老师')
    expect(mockCreate).not.toHaveBeenCalled()
  });

  it('requires teacher confirmation for a valid resource recommendation', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mode: 'guided_dialogue',
              ability: 'recommend_resource',
              reply: '我们看看星空图片，再说说你发现了什么呀？',
              teacherTip: '由教师确认后打开素材。',
              suggestedAction: {
                type: 'recommend_resource',
                resourceId: 12,
                description: '推荐星空图片',
              },
              requiresTeacherConfirmation: false,
            }),
          },
        },
      ],
    });

    const result = await service.classroomAssistant({
      text: '推荐一个素材',
      speaker: ClassroomSpeaker.Teacher,
      ageGroup: 'middle',
      tool: AssistantCapability.RecommendResource,
      activityContext: {
        theme: '小星星',
        objective: '观察星空',
        currentStep: '观察',
        responseLength: AssistantResponseLength.Short,
        askedQuestions: [],
        attemptCount: 0,
        availableResources: [{ id: 12, title: '星空图片', type: 'image' }],
      },
      history: [],
    });

    expect(result.suggestedAction?.resourceId).toBe(12)
    expect(result.requiresTeacherConfirmation).toBe(true)
  });

  it('rejects invalid JSON returned for a lesson-plan draft', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{invalid-json' } }],
    });
    await expect(
      service.lessonPlanDraft({
        theme: '春天',
        ageGroup: LessonAgeGroup.FourToFive,
        durationMinutes: 20,
        objectives: '观察颜色',
        resourceIds: [],
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('accepts a lesson-plan JSON object wrapped in model prose', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '草稿如下：```json\n{"title":"春天","theme":"春天","ageGroup":"4-5","estimatedMinutes":20,"objectives":"观察颜色","steps":[{"title":"看一看","stepType":"introduction","instruction":"看看春天有哪些颜色。","durationSeconds":120}]}\n```' } }],
    });

    const result = await service.lessonPlanDraft({
      theme: '春天',
      ageGroup: LessonAgeGroup.FourToFive,
      durationMinutes: 20,
      objectives: '观察颜色',
      resourceIds: [],
    });

    expect(result.title).toBe('春天');
    expect(result.steps).toHaveLength(1);
    expect(mockCreate.mock.calls.at(-1)?.[0]).not.toHaveProperty('response_format');
  });

  it('turns a lesson-plan model timeout into a friendly gateway error', async () => {
    mockCreate.mockRejectedValue(new Error('request timed out'));
    await expect(
      service.lessonPlanDraft({
        theme: '春天',
        ageGroup: LessonAgeGroup.FourToFive,
        durationMinutes: 20,
        objectives: '观察颜色',
        resourceIds: [],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'AI 暂时无法生成有效教案草稿，请稍后重试或手动备课',
      }),
    });
  });
});
