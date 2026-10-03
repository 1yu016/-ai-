import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuditService } from '../platform/audit.service';
import {
  AiLessonPlanDraftOutputDto,
  AiLessonPlanDraftRequestDto,
} from './dto/lesson-plan.dto';

const VOLC_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const MAX_ATTEMPTS = 2;
const MAX_RESULT_CHARACTERS = 30_000;
const UNSAFE_GENERATED_CONTENT =
  /(?:javascript:|https?:\/\/|<\/?script|\bfunction\s*\(|=>|window\.|document\.)/i;

export const LESSON_PREPARATION_SYSTEM_PROMPT = `你是幼儿园教师的AI备课助手。只输出一个JSON对象，不输出Markdown或解释。
必须包含 title、theme、ageGroup、domain、estimatedMinutes、teachingObjectives、introduction、teachingProcess、interactiveQuestions、extensionActivities、assessmentSuggestions、resourceRecommendations。
teachingProcess 每项必须包含 title、stepType、content、durationSeconds，可选 resourceId。stepType 只允许 introduction、teacher_talk、question、resource、activity、transition、summary。
resourceId 只能从输入的 resourceIds 中选择；没有合适资源时不要推荐。总步骤时长应接近课程时长。
内容须适合3至6岁儿童，不得包含儿童个人隐私、URL、HTML、JavaScript、代码或未定义字段。`;

export type LessonAiGeneration = {
  output: AiLessonPlanDraftOutputDto;
  provider: string;
  model: string;
  requestId: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  attempts: number;
};

@Injectable()
export class LessonPlanAiService {
  private readonly logger = new Logger(LessonPlanAiService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly audit: AuditService,
  ) {
    const apiKey = config.get<string>('ARK_API_KEY');
    this.model = config.get<string>('ARK_ENDPOINT_ID') ?? '';
    if (!apiKey || !this.model)
      throw new Error('缺少环境变量 ARK_API_KEY / ARK_ENDPOINT_ID');
    this.openai = new OpenAI({
      apiKey,
      baseURL: VOLC_BASE_URL,
      timeout: Number(config.get<string>('AI_REQUEST_TIMEOUT_MS') || '90000'),
      maxRetries: 0,
    });
  }

  get providerName(): string {
    return 'volcengine-ark';
  }

  get modelName(): string {
    return this.model;
  }

  async generate(
    actor: JwtTeacherPayload,
    input: AiLessonPlanDraftRequestDto,
  ): Promise<LessonAiGeneration> {
    const started = Date.now();
    const requestId = randomUUID();
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: LESSON_PREPARATION_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(input) },
          ],
          stream: false,
          temperature: 0.3,
          max_tokens: 1800,
        });
        const output = this.parseOutput(
          completion.choices[0]?.message?.content,
          input,
        );
        const usage = completion.usage;
        const result: LessonAiGeneration = {
          output,
          provider: 'volcengine-ark',
          model: this.model,
          requestId,
          latencyMs: Date.now() - started,
          promptTokens: usage?.prompt_tokens ?? null,
          completionTokens: usage?.completion_tokens ?? null,
          totalTokens: usage?.total_tokens ?? null,
          attempts: attempt,
        };
        await this.audit.writeAi({
          actor,
          feature: 'lesson_plan_draft',
          provider: result.provider,
          model: result.model,
          requestId,
          status: 'success',
          latencyMs: result.latencyMs,
          metadata: {
            attempts: attempt,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.totalTokens,
          },
        });
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `AI备课第${attempt}次生成失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const latencyMs = Date.now() - started;
    await this.audit.writeAi({
      actor,
      feature: 'lesson_plan_draft',
      provider: 'volcengine-ark',
      model: this.model,
      requestId,
      status: 'failed',
      latencyMs,
      errorCode: this.errorCode(lastError),
      metadata: { attempts: MAX_ATTEMPTS },
    });
    throw new ServiceUnavailableException(
      'AI备课暂时不可用，请稍后重试或使用手动备课',
    );
  }

  private parseOutput(
    content: string | null | undefined,
    input: AiLessonPlanDraftRequestDto,
  ): AiLessonPlanDraftOutputDto {
    if (!content) throw new Error('模型未返回内容');
    if (content.length > MAX_RESULT_CHARACTERS) throw new Error('模型结果过长');
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型未返回JSON对象');
    const result = plainToInstance(
      AiLessonPlanDraftOutputDto,
      JSON.parse(content.slice(start, end + 1)) as unknown,
    );
    const errors = validateSync(result, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) throw new Error('模型返回格式未通过校验');
    if (UNSAFE_GENERATED_CONTENT.test(JSON.stringify(result)))
      throw new Error('模型返回了链接或可执行代码');
    const allowed = new Set(input.resourceIds);
    const referenced = [
      ...result.teachingProcess
        .map((step) => step.resourceId)
        .filter((id): id is number => id != null),
      ...result.resourceRecommendations.map((item) => item.resourceId),
    ];
    if (referenced.some((id) => !allowed.has(id)))
      throw new Error('模型引用了未授权资源');
    result.theme = input.theme.trim();
    result.ageGroup = input.ageGroup;
    result.domain = input.domain.trim();
    return result;
  }

  private errorCode(error: unknown): string {
    const status = (error as { status?: number } | null)?.status;
    if (status === 429) return 'rate_limited';
    // SDK/Jest may create errors in another JavaScript realm, where
    // `instanceof Error` is false. Read the public message defensively.
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '').toLowerCase()
        : String(error ?? '').toLowerCase();
    if (message.includes('timeout') || message.includes('timed out'))
      return 'timeout';
    if (message.includes('json') || message.includes('格式'))
      return 'invalid_output';
    return 'provider_error';
  }
}
