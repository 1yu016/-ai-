import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ClassroomSummaryDraftSource } from './entities/classroom-summary-draft.entity';

export type ClassroomSummaryContent = {
  classroomSummary: string;
  participation: string;
  interestPoints: string[];
  commonQuestions: string[];
  teachingStrategies: string[];
};

export type ClassroomSummaryResult = ClassroomSummaryContent & {
  source: ClassroomSummaryDraftSource;
};

export const UNSAFE_CHILD_ASSESSMENT =
  /(?:注意力差|不专心|不聪明|笨|智力|智商|能力低|落后|差生|问题儿童|坏孩子|品行差|不听话|多动症|自闭症|抑郁|焦虑症|心理疾病|医疗诊断|心理诊断)/i;

@Injectable()
export class ClassroomSummaryAiService {
  private readonly logger = new Logger(ClassroomSummaryAiService.name);
  private readonly client: OpenAI | null;
  private readonly modelId: string | null;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('CLASSROOM_SUMMARY_AI_ENABLED') !== 'false';
    const apiKey = config.get<string>('ARK_API_KEY')?.trim();
    this.modelId = config.get<string>('ARK_ENDPOINT_ID')?.trim() || null;
    this.client = enabled && apiKey && this.modelId
      ? new OpenAI({
          apiKey,
          baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
          timeout: Number(
            config.get<string>('CLASSROOM_SUMMARY_AI_TIMEOUT_MS') || '8000',
          ),
          maxRetries: 0,
        })
      : null;
  }

  async generate(
    aggregate: Record<string, unknown>,
    fallback: ClassroomSummaryContent,
  ): Promise<ClassroomSummaryResult> {
    if (!this.client || !this.modelId)
      return { source: ClassroomSummaryDraftSource.SafeRules, ...fallback };
    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelId,
        messages: [
          {
            role: 'system',
            content:
              '你是幼儿园课堂记录助手。只根据匿名课堂汇总生成教师可编辑的总结草稿。严格输出JSON：{"classroomSummary":"...","participation":"...","interestPoints":["..."],"commonQuestions":["..."],"teachingStrategies":["..."]}。内容积极、客观、可核查。禁止医疗、心理、智力、人格和品行诊断；禁止能力排名、负面标签和对个人作推断。每个数组最多5项。',
          },
          { role: 'user', content: JSON.stringify(aggregate) },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 900,
      });
      const content = completion.choices[0]?.message?.content?.trim() || '';
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('模型未返回JSON');
      const parsed = JSON.parse(content.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
      const result: ClassroomSummaryContent = {
        classroomSummary: this.safeText(parsed.classroomSummary, 2000),
        participation: this.safeText(parsed.participation, 2000),
        interestPoints: this.safeList(parsed.interestPoints, 300),
        commonQuestions: this.safeList(parsed.commonQuestions, 300),
        teachingStrategies: this.safeList(parsed.teachingStrategies, 500),
      };
      if (!result.classroomSummary || !result.participation)
        throw new Error('模型总结字段不完整');
      return { source: ClassroomSummaryDraftSource.Ai, ...result };
    } catch (error) {
      this.logger.warn(
        `课堂总结AI降级：${error instanceof Error ? error.message : String(error)}`,
      );
      return { source: ClassroomSummaryDraftSource.SafeRules, ...fallback };
    }
  }

  assertSafe(content: ClassroomSummaryContent): void {
    if (UNSAFE_CHILD_ASSESSMENT.test(JSON.stringify(content)))
      throw new Error('总结包含不允许的儿童诊断或负面标签');
  }

  private safeText(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    const text = value.trim().slice(0, max);
    return UNSAFE_CHILD_ASSESSMENT.test(text) ? '' : text;
  }

  private safeList(value: unknown, max: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, max))
      .filter((item) => item.length > 0 && !UNSAFE_CHILD_ASSESSMENT.test(item))
      .slice(0, 5);
  }
}
