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
import { resolveDeviceIntent } from './DeviceIntentRouter'

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

  // ① 明确媒体语义 → Device（纯前端，不写后端）。
  const deviceMatch = resolveDeviceIntent(text)
  if (deviceMatch) {
    const result = input.executors.device.execute(deviceMatch)
    return {
      kind: 'device_executed',
      intent: deviceMatch.intent,
      executed: result.executed,
      message: result.message,
      ...(result.reason ? { reason: result.reason } : {}),
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