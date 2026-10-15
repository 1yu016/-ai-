import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

type SuggestionResult = {
  source: 'ai' | 'safe_rules';
  teachingSuggestions: string[];
  activitySuggestions: string[];
};

const UNSAFE_LABEL = /(?:差生|笨|智力低|能力低|落后|问题儿童|坏孩子|不听话|排名|倒数|诊断|多动症|自闭症)/i;

@Injectable()
export class QuestionMapAiService {
  private readonly logger = new Logger(QuestionMapAiService.name);
  private readonly client: OpenAI | null;
  private readonly modelId: string | null;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('QUESTION_MAP_AI_ENABLED') !== 'false';
    const apiKey = config.get<string>('ARK_API_KEY')?.trim();
    this.modelId = config.get<string>('ARK_ENDPOINT_ID')?.trim() || null;
    this.client = enabled && apiKey && this.modelId
      ? new OpenAI({
          apiKey,
          baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
          timeout: Number(config.get<string>('AI_REQUEST_TIMEOUT_MS') || '90000'),
          maxRetries: 0,
        })
      : null;
  }

  async generate(
    aggregate: {
      total: number;
      topics: Array<{ name: string; count: number }>;
      domains: Array<{ name: string; count: number }>;
    },
    fallback: Omit<SuggestionResult, 'source'>,
  ): Promise<SuggestionResult> {
    if (!this.client || !this.modelId || aggregate.total === 0)
      return { source: 'safe_rules', ...fallback };
    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelId,
        messages: [
          {
            role: 'system',
            content: '你是幼儿园教师备课助手。输入只包含当前教师有权班级的匿名聚合统计。输出严格JSON：{"teachingSuggestions":["..."],"activitySuggestions":["..."]}。每组最多3条。建议必须积极、客观、可操作；禁止幼儿排名、能力比较、负面标签、医疗心理诊断，也不要推断个人隐私。',
          },
          { role: 'user', content: JSON.stringify(aggregate) },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 500,
      });
      const content = completion.choices[0]?.message?.content?.trim() || '';
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('模型未返回JSON');
      const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
      const teachingSuggestions = this.safeList(parsed.teachingSuggestions);
      const activitySuggestions = this.safeList(parsed.activitySuggestions);
      if (!teachingSuggestions.length) throw new Error('模型建议为空');
      return { source: 'ai', teachingSuggestions, activitySuggestions };
    } catch (error) {
      this.logger.warn(`问题地图AI建议降级：${error instanceof Error ? error.message : String(error)}`);
      return { source: 'safe_rules', ...fallback };
    }
  }

  private safeList(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 180 && !UNSAFE_LABEL.test(item))
      .slice(0, 3);
  }
}
