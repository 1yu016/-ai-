/**
 * 课堂命令总编排（Stage 6.4）—— 文本口令与 ASR 文本的共用入口。
 *
 * 目标（需求 §八/§十）：无论文本输入还是语音识别文本，都进入同一条命令管线：
 *
 *   text
 *     ├─ ① 明确媒体语义        → DeviceCommandExecutor
 *     ├─ ② 课堂状态命令        → ClassroomCommandExecutor
 *     └─ ③ 无明确本地意图      → /ai/command fallback（5s timeout + allowlist）
 *
 * 关键：Device 与 Classroom 不是「谁先执行谁」的硬先后，而是基于明确语义判定 ——
 * Device 分支只在口令含明确媒体对象/动作时命中（见 DeviceIntentRouter），
 * 裸口令“暂停/暂停一下/继续/继续上课”不含媒体词 → 交由 ② 保持 PAUSE_CLASS/RESUME_CLASS。
 */
import {
  runAiCommandFallback,
  type AiCommandFallbackDeps,
  type AiCommandOutcome,
  type CommandRuntimeExecutors,
} from './classroomAiFallback'
import { resolveIntent } from './ClassroomIntentRouter'
import { ClassroomIntent } from './ClassroomIntent'
import { resolveDeviceIntent } from './DeviceIntentRouter'
import {
  routeTeacherVoiceCommand,
  type TeacherCommandSynonym,
} from './TeacherVoiceCommandRouter'

export type { CommandRuntimeExecutors }

/** 统一返回类型（与 AiCommandOutcome 一致，含 device_executed）。 */
export type CommandRuntimeOutcome = AiCommandOutcome

export interface CommandRuntimeInput {
  /** 原始口令（文本或 ASR 文本） */
  text: string
  /** 命令会话 id（迟到响应防护） */
  runId: number
  /** 传入 /ai/command 的 { text, context } */
  body: { text: string; context: unknown }
  executors: CommandRuntimeExecutors
  deps: AiCommandFallbackDeps
  timeoutMs?: number
  customSynonyms?: TeacherCommandSynonym[]
}

/** 未听清/空口令的统一提示（供语音与文本共用）。 */
export const EMPTY_COMMAND_HINT = '没有听清，请再说一次。'

/**
 * 单入口管线。任何教室命令（文本或语音）都应通过此函数，禁止另建 Router。
 */
export async function orchestrateCommand(
  input: CommandRuntimeInput,
): Promise<CommandRuntimeOutcome> {
  const text = input.text.trim()
  if (!text) {
    return { kind: 'failed', hint: EMPTY_COMMAND_HINT }
  }

  // 新版教师课堂口令：中英文确定性规则和自定义同义词优先。
  const teacherRoute = routeTeacherVoiceCommand(text, input.customSynonyms)
  if (teacherRoute?.kind === 'command') {
    if (teacherRoute.match.requiresConfirmation) {
      return {
        kind: 'confirmation_required',
        intent: teacherRoute.match.operation,
        message: '该指令涉及点名、奖励或结束课堂，请教师确认后执行。',
        match: teacherRoute.match,
      }
    }
    const result = await input.executors.classroom.executeVoice(teacherRoute.match)
    const intent = teacherRoute.match.operation === 'next_step'
      ? ClassroomIntent.NEXT_STEP
      : teacherRoute.match.operation === 'previous_step'
        ? ClassroomIntent.PREVIOUS_STEP
        : teacherRoute.match.operation
    return { kind: 'executed', intent, message: result.message }
  }
  if (teacherRoute?.kind === 'resource_search') {
    input.body = {
      text: `播放${teacherRoute.keyword}`,
      context: (input.body as { context?: unknown }).context,
    }
  }

  // ① 明确媒体语义 → Device（纯前端，不写后端）。
  const deviceMatch = resolveDeviceIntent(text)
  if (deviceMatch) {
    const mapped = {
      PAUSE_MEDIA: { operation: 'pause_media' },
      RESUME_MEDIA: { operation: 'resume_media' },
      STOP_MEDIA: { operation: 'stop_media' },
      CLOSE_RESOURCE: { operation: 'stop_media' },
      VOLUME_UP: { operation: 'set_volume', parameters: { volumeDelta: 0.1 } },
      VOLUME_DOWN: { operation: 'set_volume', parameters: { volumeDelta: -0.1 } },
    }[deviceMatch.intent] as Pick<import('./TeacherVoiceCommandRouter').TeacherVoiceCommandMatch, 'operation' | 'parameters'>
    const result = await input.executors.classroom.executeVoice({
      ...mapped,
      normalized: deviceMatch.normalized,
      label: deviceMatch.intent,
      requiresConfirmation: false,
      source: 'builtin',
    })
    return {
      kind: 'device_executed',
      intent: deviceMatch.intent,
      executed: result.success,
      message: result.message,
    }
  }

  // ② 课堂状态命令 → Classroom → 现有 /classroom-runs 后端。
  const classroomMatch = resolveIntent(text)
  if (classroomMatch.local && classroomMatch.command) {
    const result = await input.executors.classroom.execute(classroomMatch)
    return {
      kind: 'executed',
      intent: classroomMatch.intent,
      message: result.message,
    }
  }

  // ③ 复杂表达 → /ai/command fallback（5s timeout / 迟到防护 / allowlist / safe failure）。
  return runAiCommandFallback(
    input.runId,
    text,
    input.body,
    input.deps,
    input.executors,
    input.timeoutMs,
  )
}
