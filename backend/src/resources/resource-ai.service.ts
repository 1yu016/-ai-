import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
  validateSync,
} from 'class-validator';
import OpenAI from 'openai';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { ResourceAgeGroup } from '../data/entities/teaching-resource.entity';
import { AuditService } from '../platform/audit.service';

export class ResourceAiSuggestion {
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags: string[];
  @IsEnum(ResourceAgeGroup) ageGroup: ResourceAgeGroup;
  @IsString() @MaxLength(3000) teachingGoals: string;
  @IsString() @MaxLength(3000) activitySuggestions: string;
}

@Injectable()
export class ResourceAiService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.model = config.get<string>('ARK_ENDPOINT_ID')?.trim() || '';
    this.client = new OpenAI({
      apiKey: config.get<string>('ARK_API_KEY')?.trim() || 'not-configured',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      timeout: Number(config.get<string>('AI_REQUEST_TIMEOUT_MS') || '90000'),
      maxRetries: 0,
    });
  }

  async suggest(
    actor: JwtTeacherPayload,
    input: {
      title: string;
      description: string | null;
      resourceType: string;
      existingTags: string[];
    },
  ): Promise<ResourceAiSuggestion> {
    if (!this.model || this.client.apiKey === 'not-configured')
      throw new BadGatewayException('AI 标注服务未配置');
    const started = Date.now();
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你只为幼儿园课程资源生成可编辑标注建议。严格返回 JSON：{"tags":[""],"ageGroup":"small|middle|large|all","teachingGoals":"","activitySuggestions":""}。禁止返回其他字段或 Markdown。',
          },
          { role: 'user', content: JSON.stringify(input) },
        ],
      });
      const raw = completion.choices[0]?.message.content || '';
      const parsed = plainToInstance(
        ResourceAiSuggestion,
        JSON.parse(raw) as unknown,
        { enableImplicitConversion: false },
      );
      const errors = validateSync(parsed, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length) throw new Error('AI 返回格式不合法');
      await this.audit.writeAi({
        actor,
        feature: 'resource_tagging',
        provider: 'volcengine',
        model: this.model,
        status: 'success',
        latencyMs: Date.now() - started,
      });
      return parsed;
    } catch (error) {
      await this.audit.writeAi({
        actor,
        feature: 'resource_tagging',
        provider: 'volcengine',
        model: this.model,
        status: 'failed',
        latencyMs: Date.now() - started,
        errorCode:
          error instanceof SyntaxError ? 'invalid_json' : 'provider_error',
      });
      throw new BadGatewayException('AI 标注生成失败，原始资源未受影响');
    }
  }
}
