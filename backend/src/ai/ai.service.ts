import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import OpenAI from 'openai';
import type { ChatMessageDto } from './dto/chat.dto';
import {
  type ClassroomCommandContextDto,
  ClassroomCommandIntent,
  CommandModelResultDto,
} from './dto/command.dto';
import {
  AssistantCapability,
  type ClassroomAssistantDto,
  ClassroomAssistantModelResultDto,
  ClassroomSpeaker,
} from './dto/classroom-assistant.dto';
import { LessonPlanDraftRequestDto, LessonPlanDraftResultDto } from './dto/lesson-plan-draft.dto';

const VOLC_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const SYSTEM_PROMPT = `你是“幼儿园课程资源智能助手”，也是一名温柔的幼儿园 AI 助教。
你要用简短、自然、口语化的中文回答，适合教师在课堂中使用，也适合小朋友理解。
个人资源按歌曲音乐、故事绘本、视频动画、教案课件、图片卡片、游戏活动、手工美术和练习材料分类。
当用户想查找、打开或播放资源时，系统会先使用真实资源库执行；你不得编造资源、文件路径或执行结果。
对一般育儿、课程和陪伴问题提供简洁、有帮助的回答。`;

export const COMMAND_SYSTEM_PROMPT = `你是幼儿园课堂指令分类器。只把教师的话转换为结构化指令，不回答普通聊天内容，也不执行任何操作。
只允许以下 intent：search_resource、open_resource、play_resource、pause_media、resume_media、stop_media、close_resource、volume_up、volume_down、open_chat、open_resources、start_activity、next_step、previous_step、unknown。
resourceType 只允许 image、audio、video、document。无法明确判断时使用 unknown，并将 requiresConfirmation 设为 true。
资源操作应提取简短 keyword，例如“帮我播放小星星”提取“小星星”；普通聊天必须返回 unknown。
禁止返回 URL、JavaScript、代码、HTML、文件路径或任何未定义字段。
仅返回一个 JSON 对象，格式：{"mode":"command","intent":"play_resource","resourceType":"audio","keyword":"小星星","confidence":0.95,"reply":"好的，正在查找小星星。","requiresConfirmation":false}`;

export const CLASSROOM_ASSISTANT_SYSTEM_PROMPT = `你是由幼儿园教师控制的“启发式课堂 AI 助教”，服务对象是 3～6 岁儿童。系统会在每次请求中提供 ageGroup、activityContext、history、speaker、text 和教师选择的 tool。你要紧扣活动主题、教学目标与当前课堂环节，帮助儿童通过观察、比较、尝试和表达自己发现答案；不能代替儿童思考，也不能代替教师作出教育、安全或播放决定。

能力规则：
- guided_question：生成一个启发问题；没有儿童回答时，从当前环节的观察点开始。
- give_hint：只给当前提示层级对应的线索，不直接替儿童回答。
- follow_up：紧扣儿童刚才的回答继续追问，不重复 askedQuestions 中的问题。
- encourage：具体肯定儿童的努力、观察或表达，并邀请继续尝试。
- summarize：用适龄口语总结当前环节的发现，不扩展到未经课堂验证的结论。
- recommend_resource：只能从 availableResources 中选择真实资源，并交给教师确认。
- classroom_command：只能提出白名单课堂操作建议，必须由教师确认，不能声称已经执行。
- safety_redirect：停止普通教学引导，明确让儿童马上告诉现场老师。

必须遵守：
1. 一次只问一个主要问题，reply 使用幼儿能理解的自然中文，通常为 1～3 句，并服从 responseLength。
2. 优先邀请儿童“看一看、比一比、数一数、摸一摸、试一试、说一说”。
3. 儿童回答错误时，不能说“你错了”“不对”；先肯定愿意思考，再给一个可执行的线索。
4. attemptCount=0 时只从观察问题开始，不直接公布答案；=1 给比较或小提示；=2 给二选一；=3 才能简短解释，并建议用动作、图片或实物验证。
5. 鼓励努力、观察和表达，禁止使用“聪明”“笨”等能力标签，禁止排名、性格判断和心理诊断。
6. 禁止询问或诱导儿童提供姓名、地址、电话、家庭情况、照片等隐私信息。
7. 涉及危险、健康、陌生人、受伤或异常情况时，必须使用 safety_redirect，让儿童马上找现场老师。
8. 禁止编造资源、URL、文件路径、代码、课堂执行结果或系统状态。
9. 所有内容都是供教师预览的草稿；没有 suggestedAction 时无需确认，存在任何 suggestedAction 时 requiresTeacherConfirmation 必须为 true。
10. ability 通常应与教师选择的 tool 一致；仅在隐私或安全场景下可以改为 safety_redirect，无法判断时使用 unknown。

仅返回一个 JSON 对象，不要输出 Markdown、解释或其他文字：
{"mode":"guided_dialogue","ability":"guided_question","reply":"你先看看图片里的星星，它们像什么呀？","teacherTip":"等待幼儿描述外观，再继续追问。","suggestedAction":null,"requiresTeacherConfirmation":false}

suggestedAction 只能是 null，或 {"type":"recommend_resource","resourceId":12,"description":"推荐星空图片"}，或 {"type":"classroom_command","commandIntent":"pause_media","description":"建议暂停媒体"}。`;

export const LESSON_PLAN_DRAFT_SYSTEM_PROMPT = `你是幼儿园教师的备课助手。只生成可编辑的教案草稿 JSON，不执行、不保存任何操作。
内容必须适合 3～6 岁儿童，固定生成 5 个精炼步骤，单个 instruction 不超过 80 个汉字。question 步骤每步只允许一个主要问题，总时长尽量接近 durationMinutes。
用户只需要提供活动主题。未提供 objectives 时，你要根据主题和年龄段自动编写清晰、可观察的教学目标；提供了 objectives 时，应当尊重并完善教师的目标。
stepType 只允许 introduction、teacher_talk、question、resource、activity、transition、summary。resourceId 只能从 resourceIds 中选择；没有合适资源时不要生成 resource 步骤。
禁止输出 URL、HTML、JavaScript、儿童姓名、住址、电话、照片、家庭情况或未定义字段。
只返回一个 JSON 对象：{"title":"","theme":"","ageGroup":"4-5","estimatedMinutes":25,"objectives":"","steps":[{"title":"","stepType":"introduction","instruction":"","expectedResponse":"","teacherTip":"","durationSeconds":120}]}。`;

const CHILD_PRIVACY_OR_SAFETY_PATTERN =
  /(?:我叫|我的名字|我住在|家庭住址|电话号码|手机号|发照片|给你照片|陌生人|有人让我|受伤|流血|吃药|不舒服|很疼|肚子疼|头疼)/;
const OUTPUT_PRIVACY_PATTERN =
  /(?:你叫什么名字|告诉我你的名字|你住在哪里|告诉我地址|电话号码|手机号|发一张照片|家庭情况)/;
const DIRECT_ANSWER_PATTERN = /(?:答案是|因为|其实是|所以|正确答案)/;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ARK_API_KEY');
    const endpointId = this.configService.get<string>('ARK_ENDPOINT_ID');
    if (!apiKey || !endpointId) {
      throw new Error(
        '缺少环境变量 ARK_API_KEY / ARK_ENDPOINT_ID,请在 backend/.env 中配置后再启动服务',
      );
    }
    this.openai = new OpenAI({
      apiKey,
      baseURL: VOLC_BASE_URL,
      timeout: Number(
        this.configService.get<string>('AI_REQUEST_TIMEOUT_MS') || '90000',
      ),
      maxRetries: 0,
    });
  }

  /**
   * 携带对话历史调用 火山方舟豆包
   * @param text 本轮用户（小朋友）说的话
   * @param history 之前的对话记录，按时间顺序排列
   * @returns AI 回复的纯文本
   */
  async chat(text: string, history: ChatMessageDto[] = []): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map<OpenAI.Chat.Completions.ChatCompletionMessageParam>(
        (msg) =>
          msg.role === 'user'
            ? { role: 'user', content: msg.content }
            : { role: 'assistant', content: msg.content },
      ),
      { role: 'user', content: text },
    ];

    const modelId = this.configService.get<string>('ARK_ENDPOINT_ID')!;
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: modelId,
      messages,
      stream: false,
      temperature: 0.8,
      max_tokens: 300,
    };

    try {
      const completion = await this.openai.chat.completions.create(params);
      const reply = completion.choices[0]?.message?.content?.trim();
      if (!reply) {
        throw new BadGatewayException('AI 助教没有返回回复，请稍后重试');
      }
      return reply;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      this.logger.error(
        '调用 火山方舟 失败',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'AI 助教暂时开小差了，请稍后再试哦～',
      );
    }
  }

  async classifyCommand(
    text: string,
    context: ClassroomCommandContextDto,
  ): Promise<CommandModelResultDto> {
    const localResult = this.parseLocalCommand(text);
    if (localResult) return localResult;

    const modelId = this.configService.get<string>('ARK_ENDPOINT_ID')!;
    try {
      const completion = await this.openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: COMMAND_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ text, context }),
          },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 300,
      });
      const content = completion.choices[0]?.message?.content?.trim();
      return this.parseCommandResult(content);
    } catch (error) {
      this.logger.error(
        '课堂指令模型调用失败',
        error instanceof Error ? error.stack : String(error),
      );
      return this.unknownCommand('课堂指令暂时无法识别，请稍后再试。');
    }
  }

  async classroomAssistant(
    dto: ClassroomAssistantDto,
  ): Promise<ClassroomAssistantModelResultDto> {
    if (CHILD_PRIVACY_OR_SAFETY_PATTERN.test(dto.text)) {
      return this.safetyRedirect();
    }

    const modelId = this.configService.get<string>('ARK_ENDPOINT_ID')!;
    try {
      const completion = await this.openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: CLASSROOM_ASSISTANT_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(dto) },
        ],
        stream: false,
        temperature: 0.4,
        max_tokens: 300,
      });
      const content = completion.choices[0]?.message?.content?.trim();
      return this.parseClassroomAssistantResult(content, dto);
    } catch (error) {
      this.logger.error(
        '课堂助教模型调用失败',
        error instanceof Error ? error.stack : String(error),
      );
      return this.fallbackAssistantResult(dto);
    }
  }

  async lessonPlanDraft(dto: LessonPlanDraftRequestDto): Promise<LessonPlanDraftResultDto> {
    const modelId = this.configService.get<string>('ARK_ENDPOINT_ID')!;
    try {
      const completion = await this.openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: LESSON_PLAN_DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(dto) },
        ],
        stream: false,
        temperature: 0.4,
        max_tokens: 700,
      });
      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('模型未返回内容');
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('模型未返回 JSON 对象');
      const result = plainToInstance(
        LessonPlanDraftResultDto,
        JSON.parse(content.slice(start, end + 1)) as unknown,
      );
      const errors = validateSync(result, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) throw new Error('模型返回格式未通过校验');
      const allowed = new Set(dto.resourceIds);
      if (result.steps.some((step) => step.resourceId && !allowed.has(step.resourceId))) throw new Error('模型引用了未授权资源');
      result.theme = dto.theme.trim();
      result.ageGroup = dto.ageGroup;
      return result;
    } catch (error) {
      this.logger.error('AI 教案草稿生成失败', error instanceof Error ? error.stack : String(error));
      throw new BadGatewayException('AI 暂时无法生成有效教案草稿，请稍后重试或手动备课');
    }
  }

  private parseCommandResult(content: string | null | undefined) {
    if (!content) return this.unknownCommand();
    try {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start < 0 || end <= start) return this.unknownCommand();
      const parsed: unknown = JSON.parse(content.slice(start, end + 1));
      const result = plainToInstance(CommandModelResultDto, parsed);
      const errors = validateSync(result, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length > 0) {
        this.logger.warn('课堂指令模型返回未通过 DTO 校验');
        return this.unknownCommand();
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `课堂指令模型返回无法解析：${error instanceof Error ? error.message : String(error)}`,
      );
      return this.unknownCommand();
    }
  }

  private parseLocalCommand(text: string): CommandModelResultDto | null {
    const normalized = text.trim().replace(/[。！!，,]+$/g, '');
    const directCommands: Array<{
      pattern: RegExp;
      intent: ClassroomCommandIntent;
      reply: string;
    }> = [
      { pattern: /^(?:请)?(?:暂停|暂停一下|暂停播放|停一下)$/, intent: ClassroomCommandIntent.PauseMedia, reply: '准备暂停当前媒体。' },
      { pattern: /^(?:请)?(?:继续|继续播放|恢复播放)$/, intent: ClassroomCommandIntent.ResumeMedia, reply: '准备继续播放。' },
      { pattern: /^(?:请)?(?:停止|停止播放|结束播放)$/, intent: ClassroomCommandIntent.StopMedia, reply: '准备停止当前媒体。' },
      { pattern: /^(?:请)?(?:关闭|关闭资源|关掉资源)$/, intent: ClassroomCommandIntent.CloseResource, reply: '准备关闭当前资源。' },
      { pattern: /^(?:请)?(?:声音|音量).*(?:大一点|调大|增大)$/, intent: ClassroomCommandIntent.VolumeUp, reply: '准备调大音量。' },
      { pattern: /^(?:请)?(?:声音|音量).*(?:小一点|调小|减小)$/, intent: ClassroomCommandIntent.VolumeDown, reply: '准备调小音量。' },
      { pattern: /^(?:请)?(?:下一步|下一个环节)$/, intent: ClassroomCommandIntent.NextStep, reply: '准备进入下一步。' },
      { pattern: /^(?:请)?(?:上一步|前一个环节|返回上一步)$/, intent: ClassroomCommandIntent.PreviousStep, reply: '准备返回上一步。' },
      { pattern: /^(?:请)?(?:开始活动|开始游戏)$/, intent: ClassroomCommandIntent.StartActivity, reply: '准备开始课堂活动。' },
      { pattern: /^(?:请)?(?:打开)?(?:课程资源|资源库|资源页面)$/, intent: ClassroomCommandIntent.OpenResources, reply: '准备打开课程资源。' },
      { pattern: /^(?:请)?(?:打开)?(?:聊天|聊天页面|课堂助教)$/, intent: ClassroomCommandIntent.OpenChat, reply: '准备打开聊天页面。' },
    ];
    for (const command of directCommands) {
      if (command.pattern.test(normalized)) {
        return {
          mode: 'command',
          intent: command.intent,
          confidence: 0.99,
          reply: command.reply,
          requiresConfirmation: false,
        };
      }
    }

    const resourceCommand = normalized.match(
      /^(?:请|帮我|麻烦你?)?\s*(搜索|查找|找一下|打开|播放|播一下|放一下|播|放)\s*(?:一下|一首|一个)?\s*(.*)$/,
    );
    if (!resourceCommand) return null;
    const verb = resourceCommand[1];
    const keyword = resourceCommand[2]
      ?.trim()
      .replace(/^(?:课程资源|资源库|资源页面)(?:里的|中的|里|中)?\s*/, '')
      .trim();
    const intent =
      verb === '搜索' || verb === '查找' || verb === '找一下'
        ? ClassroomCommandIntent.SearchResource
        : verb === '打开'
          ? ClassroomCommandIntent.OpenResource
          : ClassroomCommandIntent.PlayResource;
    return {
      mode: 'command',
      intent,
      keyword: keyword || undefined,
      confidence: keyword ? 0.98 : 0.7,
      reply: keyword
        ? `正在查找“${keyword}”。`
        : '请告诉我要操作的资源名称。',
      requiresConfirmation: !keyword,
    };
  }

  private parseClassroomAssistantResult(
    content: string | null | undefined,
    dto: ClassroomAssistantDto,
  ): ClassroomAssistantModelResultDto {
    if (!content) return this.fallbackAssistantResult(dto);
    try {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start < 0 || end <= start) return this.fallbackAssistantResult(dto);
      const parsed: unknown = JSON.parse(content.slice(start, end + 1));
      const result = plainToInstance(ClassroomAssistantModelResultDto, parsed);
      const errors = validateSync(result, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length > 0) {
        this.logger.warn('课堂助教模型返回未通过 DTO 校验');
        return this.fallbackAssistantResult(dto);
      }

      if (OUTPUT_PRIVACY_PATTERN.test(result.reply)) {
        return this.safetyRedirect();
      }

      result.ability ??= dto.tool ?? AssistantCapability.GuidedQuestion;
      result.reply = this.sanitizeGuidedReply(result.reply, dto);
      result.teacherTip = this.limitText(result.teacherTip, 220);

      const action = result.suggestedAction;
      if (action?.resourceId) {
        const resourceExists = dto.activityContext.availableResources.some(
          (resource) => resource.id === action.resourceId,
        );
        if (!resourceExists) result.suggestedAction = null;
      }
      if (
        action?.type === 'classroom_command' &&
        (!action.commandIntent ||
          action.commandIntent === ClassroomCommandIntent.Unknown)
      ) {
        result.suggestedAction = null;
      }
      if (result.suggestedAction) {
        result.requiresTeacherConfirmation = true;
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `课堂助教模型返回无法解析：${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallbackAssistantResult(dto);
    }
  }

  private sanitizeGuidedReply(
    value: string,
    dto: ClassroomAssistantDto,
  ): string {
    let reply = value
      .replace(/你错了|答错了|不对/g, '我们再一起看看')
      .replace(/真聪明|你好聪明/g, '你观察得很认真')
      .replace(/笨/g, '继续试试看')
      .replace(/\s+/g, ' ')
      .trim();
    const firstInteraction =
      dto.speaker === ClassroomSpeaker.Child &&
      dto.activityContext.attemptCount === 0 &&
      !dto.history.some((item) => item.role === ClassroomSpeaker.Assistant);
    if (
      firstInteraction &&
      (DIRECT_ANSWER_PATTERN.test(reply) || !/[？?]/.test(reply))
    ) {
      reply = `你先看看和“${dto.activityContext.theme}”有关的画面，你发现了什么呀？`;
    }

    let questionCount = 0;
    reply = reply.replace(/[？?]/g, (mark) => {
      questionCount += 1;
      return questionCount === 1 ? mark : '。';
    });
    const sentences = reply.match(/[^。！？!?]+[。！？!?]?/g) ?? [reply];
    const maximum = { short: 90, medium: 150, long: 220 }[
      dto.activityContext.responseLength
    ];
    return this.limitText(sentences.slice(0, 3).join(''), maximum);
  }

  private limitText(value: string, maximum: number): string {
    const trimmed = value.trim();
    if (trimmed.length <= maximum) return trimmed;
    return `${trimmed.slice(0, Math.max(1, maximum - 1)).replace(/[，、；：]$/, '')}。`;
  }

  private safetyRedirect(): ClassroomAssistantModelResultDto {
    return {
      mode: 'guided_dialogue',
      ability: AssistantCapability.SafetyRedirect,
      reply: '这件事要马上告诉老师，请老师来陪你一起处理。',
      teacherTip: '请教师立即了解情况，并根据园所安全流程进行判断和处理。',
      suggestedAction: null,
      requiresTeacherConfirmation: false,
    };
  }

  private fallbackAssistantResult(
    dto: ClassroomAssistantDto,
  ): ClassroomAssistantModelResultDto {
    const arithmetic = dto.text.match(
      /([0-9零〇一二两三四五六七八九十百千万]+)\s*(?:\+|＋|加)\s*([0-9零〇一二两三四五六七八九十百千万]+)/,
    );
    const reply = arithmetic
      ? `你可以把${arithmetic[1]}和${arithmetic[2]}分别想成两堆小积木，再把它们合起来数一数，一共有多少呀？`
      : `你先看一看和“${dto.activityContext.theme}”有关的内容，你发现了什么呀？`;
    return {
      mode: 'guided_dialogue',
      ability: AssistantCapability.GuidedQuestion,
      reply: this.limitText(reply, 150),
      teacherTip: arithmetic
        ? '可引导幼儿把两个数分组表示，再由幼儿自己说出合起来的结果。'
        : '可从观察、比较或动手操作开始，并根据幼儿的回答继续追问。',
      suggestedAction: null,
      requiresTeacherConfirmation: false,
    };
  }

  private unknownCommand(
    reply = '我没有理解这条课堂指令，请换一种更明确的说法。',
  ): CommandModelResultDto {
    return {
      mode: 'command',
      intent: ClassroomCommandIntent.Unknown,
      confidence: 0,
      reply,
      requiresConfirmation: true,
    };
  }
}
