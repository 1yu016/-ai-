import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import type {
  AuthenticatedRequest,
  OptionallyAuthenticatedRequest,
} from '../auth/auth.types';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ChatPersistenceService } from '../data/chat-persistence.service';
import { resolveDataOwner } from '../data/owner.types';
import {
  type ResourceResponse,
  type ResourceSearchResult,
  ResourceService,
} from '../resources/resource.service';
import { AiService } from './ai.service';
import { AudioService, type UploadedAudioFile } from './audio.service';
import { ClassroomDirectorService } from './classroom-director.service';
import { ChatDto } from './dto/chat.dto';
import {
  ClassroomCommandDto,
  ClassroomCommandIntent,
  type CommandModelResultDto,
} from './dto/command.dto';
import {
  AssistantSuggestedActionType,
  ClassroomAssistantDto,
  type ClassroomAssistantModelResultDto,
} from './dto/classroom-assistant.dto';
import { TtsDto } from './dto/tts.dto';
import { VoiceChatDto } from './dto/voice-chat.dto';
import {
  LessonPlanDraftRequestDto,
  LessonPlanDraftResultDto,
} from './dto/lesson-plan-draft.dto';
import {
  ClassroomDirectorDecisionDto,
  ClassroomDirectorRequestDto,
} from './dto/classroom-director.dto';
import {
  HeuristicAssistantDecisionDto,
  HeuristicAssistantRequestDto,
} from './dto/heuristic-assistant.dto';
import { HeuristicAssistantService } from './heuristic-assistant.service';
import { ClassroomCommandService } from './classroom-command.service';
import {
  ClassroomCommandV2RequestDto,
  DownloadClassroomRulesQueryDto,
  ExecuteClassroomCommandDto,
  SaveClassroomCommandRuleDto,
  UploadOfflineCommandLogsDto,
} from './dto/classroom-command-v2.dto';

type VoiceChatResponseDto = {
  userText: string;
  aiReplyText: string;
  audioDataUrl?: string;
  sessionId?: number;
};

type ChatResponseDto = {
  reply: string;
  sessionId?: number;
};

type CommandMatchStatus =
  'not_required' | 'matched' | 'multiple' | 'low_confidence' | 'not_found';

type CommandResponseDto = CommandModelResultDto & {
  matchStatus: CommandMatchStatus;
  resource?: ResourceResponse;
  candidates?: ResourceSearchResult[];
};

const RESOURCE_COMMANDS = new Set<ClassroomCommandIntent>([
  ClassroomCommandIntent.SearchResource,
  ClassroomCommandIntent.OpenResource,
  ClassroomCommandIntent.PlayResource,
]);

const DIRECT_COMMAND_CONFIDENCE = 0.75;
const DIRECT_RESOURCE_SCORE = 800;

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly audioService: AudioService,
    private readonly chatPersistenceService: ChatPersistenceService,
    private readonly resourceService: ResourceService,
    private readonly classroomDirectorService: ClassroomDirectorService,
    private readonly heuristicAssistantService: HeuristicAssistantService,
    private readonly classroomCommandService: ClassroomCommandService,
  ) {}

  @Post('classroom-command')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  classroomCommandV2(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ClassroomCommandV2RequestDto,
  ) {
    return this.classroomCommandService.recognize(request.user, dto);
  }

  @Post('classroom-command/execute')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  executeClassroomCommand(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ExecuteClassroomCommandDto,
  ) {
    return this.classroomCommandService.execute(request.user, dto);
  }

  @Post('classroom-command/rules')
  @UseGuards(AuthGuard, ThrottlerGuard)
  saveClassroomCommandRule(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveClassroomCommandRuleDto,
  ) {
    return this.classroomCommandService.saveRule(request.user, dto);
  }

  @Get('classroom-command/rules/download')
  @UseGuards(AuthGuard, ThrottlerGuard)
  downloadClassroomCommandRules(
    @Req() request: AuthenticatedRequest,
    @Query() query: DownloadClassroomRulesQueryDto,
  ) {
    return this.classroomCommandService.downloadRules(request.user, query);
  }

  @Post('classroom-command/offline-logs')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  uploadOfflineClassroomCommandLogs(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UploadOfflineCommandLogsDto,
  ) {
    return this.classroomCommandService.uploadOfflineLogs(request.user, dto);
  }

  @Post('classroom-director')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  classroomDirector(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ClassroomDirectorRequestDto,
  ) {
    return this.classroomDirectorService.suggest(request.user, dto);
  }

  @Post('classroom-director/:suggestionId/decision')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  classroomDirectorDecision(
    @Req() request: AuthenticatedRequest,
    @Param('suggestionId', ParseIntPipe) suggestionId: number,
    @Body() dto: ClassroomDirectorDecisionDto,
  ) {
    return this.classroomDirectorService.decide(
      request.user,
      suggestionId,
      dto,
    );
  }

  @Post('heuristic-assistant')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  heuristicAssistant(
    @Req() request: AuthenticatedRequest,
    @Body() dto: HeuristicAssistantRequestDto,
  ) {
    return this.heuristicAssistantService.create(request.user, dto);
  }

  @Get('heuristic-assistant/:draftId')
  @UseGuards(AuthGuard, ThrottlerGuard)
  heuristicAssistantDraft(
    @Req() request: AuthenticatedRequest,
    @Param('draftId', ParseIntPipe) draftId: number,
  ) {
    return this.heuristicAssistantService.getOne(request.user, draftId);
  }

  @Post('heuristic-assistant/:draftId/decision')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  heuristicAssistantDecision(
    @Req() request: AuthenticatedRequest,
    @Param('draftId', ParseIntPipe) draftId: number,
    @Body() dto: HeuristicAssistantDecisionDto,
  ) {
    return this.heuristicAssistantService.decide(request.user, draftId, dto);
  }

  @Post('heuristic-assistant/:draftId/play')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  heuristicAssistantPlay(
    @Req() request: AuthenticatedRequest,
    @Param('draftId', ParseIntPipe) draftId: number,
  ) {
    return this.heuristicAssistantService.play(request.user, draftId);
  }

  /**
   * 与幼儿园 AI 助教对话
   * 请求体：{ text: string, history?: Array<{ role, content }> }
   * 返回体：{ reply: string }
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalAuthGuard, ThrottlerGuard)
  async chat(
    @Body() dto: ChatDto,
    @Req() request: OptionallyAuthenticatedRequest,
  ): Promise<ChatResponseDto> {
    const reply = await this.aiService.chat(dto.text, dto.history ?? []);
    const owner = resolveDataOwner(request.user, dto.visitorId);
    if (!owner) {
      return { reply };
    }

    const sessionId = await this.chatPersistenceService.saveExchange(owner, {
      sessionId: dto.sessionId,
      text: dto.text,
      reply,
    });
    return { reply, sessionId };
  }

  @Post('command')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ThrottlerGuard)
  async command(
    @Body() dto: ClassroomCommandDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CommandResponseDto> {
    const result = await this.aiService.classifyCommand(
      dto.text.trim(),
      dto.context,
    );
    const requiresConfirmation =
      result.requiresConfirmation ||
      result.confidence < DIRECT_COMMAND_CONFIDENCE;

    if (!RESOURCE_COMMANDS.has(result.intent)) {
      this.logger.log(
        `ai.command teacher=${request.user.sub} intent=${result.intent} confidence=${result.confidence.toFixed(2)}`,
      );
      return {
        ...result,
        requiresConfirmation,
        matchStatus: 'not_required',
        reply:
          requiresConfirmation &&
          result.intent !== ClassroomCommandIntent.Unknown
            ? '我不太确定这条指令，请教师确认后再执行。'
            : result.reply,
      };
    }

    const keyword = result.keyword?.trim();
    if (!keyword) {
      return {
        ...result,
        requiresConfirmation: true,
        matchStatus: 'not_found',
        reply: '请告诉我要查找或播放的资源名称。',
      };
    }

    let matches: ResourceSearchResult[];
    try {
      matches = await this.resourceService.search(
        request.user.sub,
        keyword,
        result.resourceType,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `ai.command.search.failed teacher=${request.user.sub}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('课堂指令处理失败，请稍后重试');
    }
    const candidates = matches.slice(0, 5);
    if (candidates.length === 0) {
      this.logger.log(
        `ai.command teacher=${request.user.sub} intent=${result.intent} match=not_found`,
      );
      return {
        ...result,
        requiresConfirmation: true,
        matchStatus: 'not_found',
        reply: `没有找到“${keyword}”，请试试资源的完整标题或别名。`,
      };
    }

    if (result.intent === ClassroomCommandIntent.SearchResource) {
      this.logger.log(
        `ai.command teacher=${request.user.sub} intent=${result.intent} candidates=${candidates.length}`,
      );
      return {
        ...result,
        requiresConfirmation: true,
        matchStatus: candidates.length > 1 ? 'multiple' : 'matched',
        reply: '找到了以下资源，请选择：',
        candidates,
      };
    }

    const topMatch = candidates[0]!;
    const canExecuteDirectly =
      matches.length === 1 &&
      !requiresConfirmation &&
      topMatch.score >= DIRECT_RESOURCE_SCORE;
    if (!canExecuteDirectly) {
      const lowConfidence =
        requiresConfirmation || topMatch.score < DIRECT_RESOURCE_SCORE;
      this.logger.log(
        `ai.command teacher=${request.user.sub} intent=${result.intent} match=${lowConfidence ? 'low_confidence' : 'multiple'} candidates=${candidates.length}`,
      );
      return {
        ...result,
        requiresConfirmation: true,
        matchStatus: lowConfidence ? 'low_confidence' : 'multiple',
        reply:
          matches.length > 1
            ? '找到了以下资源，请选择：'
            : '我找到了一个可能的资源，请教师确认后再执行。',
        candidates,
      };
    }

    const { score: _score, ...resource } = topMatch;
    this.logger.log(
      `ai.command teacher=${request.user.sub} intent=${result.intent} resource=${resource.id}`,
    );
    return {
      ...result,
      requiresConfirmation: false,
      matchStatus: 'matched',
      resource,
    };
  }

  @Post('classroom-assistant')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ThrottlerGuard)
  async classroomAssistant(
    @Body() dto: ClassroomAssistantDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ClassroomAssistantModelResultDto> {
    const result = await this.aiService.classroomAssistant(dto);
    const action = result.suggestedAction;
    if (
      action?.type === AssistantSuggestedActionType.RecommendResource &&
      action.resourceId
    ) {
      try {
        await this.resourceService.getOne(request.user.sub, action.resourceId);
      } catch {
        this.logger.warn(
          `ai.classroom-assistant.invalid-resource teacher=${request.user.sub} resource=${action.resourceId}`,
        );
        result.suggestedAction = null;
        result.requiresTeacherConfirmation = true;
        result.teacherTip = '推荐的资源当前不可用，请教师手动选择课堂素材。';
      }
    }
    this.logger.log(
      `ai.classroom-assistant teacher=${request.user.sub} ability=${result.ability ?? 'unknown'} action=${result.suggestedAction?.type ?? 'none'}`,
    );
    return result;
  }

  @Post('lesson-plan-draft')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ThrottlerGuard)
  async lessonPlanDraft(
    @Body() dto: LessonPlanDraftRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<LessonPlanDraftResultDto> {
    await Promise.all(
      dto.resourceIds.map((id) =>
        this.resourceService.getOne(request.user.sub, id),
      ),
    );
    return this.aiService.lessonPlanDraft(dto);
  }

  @Post('asr')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  async asr(
    @UploadedFile() file: UploadedAudioFile,
  ): Promise<{ text: string }> {
    const text = await this.audioService.asr(file);
    return { text };
  }

  @Post('tts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async tts(@Body() dto: TtsDto): Promise<{ audioUrl: string }> {
    const audioUrl = await this.audioService.tts(dto.text);
    return { audioUrl };
  }

  /**
   * 完整语音对话：音频识别 -> AI 回复 -> 语音合成。
   * WebM 格式兼容及上游 ASR 错误由 AudioService 处理。
   */
  @Post('voice-chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalAuthGuard, ThrottlerGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  async voiceChat(
    @UploadedFile() file: UploadedAudioFile,
    @Body() dto: VoiceChatDto,
    @Req() request: OptionallyAuthenticatedRequest,
  ): Promise<VoiceChatResponseDto> {
    if (!file) {
      throw new BadRequestException(
        '请使用 multipart/form-data 上传 file 字段',
      );
    }

    try {
      const userText = await this.audioService.asr(file);
      const aiReplyText = await this.aiService.chat(userText);
      const audioDataUrl = await this.audioService.tts(aiReplyText);
      const owner = resolveDataOwner(request.user, dto.visitorId);
      const sessionId = owner
        ? await this.chatPersistenceService.saveExchange(owner, {
            sessionId: dto.sessionId,
            text: userText,
            reply: aiReplyText,
          })
        : undefined;

      return {
        userText,
        aiReplyText,
        audioDataUrl,
        sessionId,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('语音对话处理失败，请稍后重试', {
        cause: error,
      });
    }
  }
}
