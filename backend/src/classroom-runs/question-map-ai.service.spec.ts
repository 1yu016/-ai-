import { ConfigService } from '@nestjs/config';
import { QuestionMapAiService } from './question-map-ai.service';

function serviceWithResponse(content: string) {
  const service = new QuestionMapAiService(
    new ConfigService({ QUESTION_MAP_AI_ENABLED: 'false' }),
  );
  const mutable = service as unknown as {
    client: {
      chat: {
        completions: {
          create: () => Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
    modelId: string;
  };
  mutable.modelId = 'test-model';
  mutable.client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
  };
  return service;
}

const aggregate = {
  total: 3,
  topics: [{ name: '科学探索', count: 3 }],
  domains: [{ name: '科学', count: 3 }],
};
const fallback = {
  teachingSuggestions: ['安全降级建议'],
  activitySuggestions: ['安全观察活动'],
};

describe('QuestionMapAiService', () => {
  it('accepts structured positive suggestions generated from anonymous aggregates', async () => {
    const service = serviceWithResponse(JSON.stringify({
      teachingSuggestions: ['请幼儿先观察云朵，再说出自己的发现。'],
      activitySuggestions: ['云朵观察记录'],
    }));
    await expect(service.generate(aggregate, fallback)).resolves.toEqual({
      source: 'ai',
      teachingSuggestions: ['请幼儿先观察云朵，再说出自己的发现。'],
      activitySuggestions: ['云朵观察记录'],
    });
  });

  it('rejects rankings and negative labels and falls back safely', async () => {
    const service = serviceWithResponse(JSON.stringify({
      teachingSuggestions: ['把能力低的幼儿做成倒数排名。'],
      activitySuggestions: ['公布差生名单'],
    }));
    await expect(service.generate(aggregate, fallback)).resolves.toEqual({
      source: 'safe_rules',
      ...fallback,
    });
  });
});
