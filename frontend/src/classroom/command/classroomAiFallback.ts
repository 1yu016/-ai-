/**
 * AI Command Fallback 控制器（仅限 POST /ai/command 的显式超时与安全失败）。
 *
 * 设计目标：复杂自然语言只能走 LLM fallback，但课堂命令是有副作用操作，
 * 因此这里对“等待 AI”做最保守的处理：
 *  - 显式超时（默认 5s），超时即安全失败，绝不执行课堂命令；
 *  - 任何错误（超时/网络/5xx/格式非法）都按“未执行”处理；
 *  - 绝不自动重试（防服务端已生效导致重复执行）；
 *  - 迟到响应防护：请求已失效（新指令已发起/已超时）时，即使后端随后返回，
 *    也拒绝执行。
 *
 * 本模块不含 Vue/axios 业务绑定，便于单测注入假 post 与时间。
 */
import { classifyAiIntent } from './ClassroomIntentRouter'
import { ClassroomIntent, type ClassroomIntentMatch } from './ClassroomIntent'
import { ClassroomCommandExecutor } from './ClassroomCommandExecutor'
import { classifyAiDeviceIntent } from './DeviceIntentRouter'
import type { DeviceCommandExecutor } from './DeviceCommandExecutor'
import type { DeviceIntent } from './DeviceIntent'
import {
  isResourceIntent,
  type ResourceIntent,
  type ResourceCommandResult,
} from './ResourceCommand'
import {
  buildResourceResult,
  evaluateResourceCommand,
} from './ResourceCommandCoordinator'
import type { TeacherVoiceCommandMatch } from './TeacherVoiceCommandRouter'

/** 仅对 /ai/command 生效的显式超时（毫秒）。不要改为全局。 */
export const AI_COMMAND_TIMEOUT_MS = 5000

/** 教师侧统一安全失败提示：不含 timeout/axios/ms 等技术词。 */
export const AI_COMMAND_FAILURE_HINT = '未能识别该课堂指令，未执行。你可以换一种说法再试一次。'

/** 请求进行中的提示。 */
export const AI_COMMAND_PENDING_HINT = '正在识别课堂指令…'

/**
 * 对 /ai/command 发起请求并应用“未执行即安全”的失败策略。
 * deps 注入可测性：post 负责真实网络 + 应用 timeout 配置；isCurrent 负责迟到防护。
 */
export interface AiCommandFallbackDeps {
  /** 真正的请求器（生产里指向 http.post('/ai/command', body, { timeout })） */
  post: (url: string, body: unknown, config?: { timeout?: number }) => Promise<unknown>
  /** 该 runId 的请求是否仍是当前有效请求（用于丢弃迟到响应） */
  isCurrent: (runId: number) => boolean
}

export type AiCommandOutcome =
  | { kind: 'executed'; intent: string; message: string }
  | {
      kind: 'device_executed'
      intent: DeviceIntent
      executed: boolean
      message: string
      reason?: string
    }
  | {
      kind: 'confirmation_required'
      intent: string
      message: string
      match: TeacherVoiceCommandMatch
    }
  | {
      kind: 'resource_pending'
      intent: ResourceIntent
      result: ResourceCommandResult
    }
  | { kind: 'unsupported'; intent: string; reply: string }
  | { kind: 'failed'; hint: string }

/** 命令编排所需的两个执行器（classroom 课堂状态 / device 媒体）。 */
export interface CommandRuntimeExecutors {
  classroom: ClassroomCommandExecutor
  device: DeviceCommandExecutor
}

/** 兼容参数：允许仅传单个 classroom executor（旧调用方），或 (classroom+device) 组合。 */
type ExecutorArg = ClassroomCommandExecutor | CommandRuntimeExecutors

function isExecutorGroup(arg: ExecutorArg): arg is CommandRuntimeExecutors {
  return 'classroom' in arg
}

/**
 * 执行一次 /ai/command fallback：
 *  - 先归类返回：白名单内 → Executor → executed；
 *  - 白名单外 → unsupported（不执行）；
 *  - 任何错误/超时 → failed（不执行）。
 *
 * 仅当 isCurrent(runId) 才允许继续后续任何执行操作（迟到防护）。
 */
export async function runAiCommandFallback(
  runId: number,
  raw: string,
  body: unknown,
  deps: AiCommandFallbackDeps,
  executors: ExecutorArg,
  timeoutMs = AI_COMMAND_TIMEOUT_MS,
): Promise<AiCommandOutcome> {
  try {
    const res = await deps.post('/ai/command', body, { timeout: timeoutMs })
    // 迟到防护：请求已失效（超时过程中用户又发起新指令，或组件已切换），丢弃结果。
    if (!deps.isCurrent(runId)) {
      return { kind: 'failed', hint: AI_COMMAND_FAILURE_HINT }
    }
    const data = res as {
      intent?: unknown
      reply?: unknown
      keyword?: unknown
      matchStatus?: unknown
      resource?: unknown
      candidates?: unknown
      requiresConfirmation?: unknown
    }
    const intent = typeof data?.intent === 'string' ? data.intent : 'unknown'

    // ① 媒体设备意图 → DeviceCommandExecutor（仅当调用方提供了 device 执行器）。
    if (isExecutorGroup(executors)) {
      const deviceVerdict = classifyAiDeviceIntent(intent)
      if (deviceVerdict.allowed) {
        const operation = {
          PAUSE_MEDIA: 'pause_media', RESUME_MEDIA: 'resume_media', STOP_MEDIA: 'stop_media',
          CLOSE_RESOURCE: 'stop_media', VOLUME_UP: 'set_volume', VOLUME_DOWN: 'set_volume',
        }[deviceVerdict.match.intent] as TeacherVoiceCommandMatch['operation']
        return {
          kind: 'confirmation_required',
          intent,
          message: '该操作由 AI 判读，需要教师确认后执行。',
          match: {
            operation,
            parameters: intent === 'volume_up' ? { volumeDelta: 0.1 } : intent === 'volume_down' ? { volumeDelta: -0.1 } : undefined,
            normalized: raw,
            label: intent,
            requiresConfirmation: true,
            source: 'builtin',
          },
        }
      }
    }

    // ② 资源意图（search/open/play_resource）→ Resource 确认流程，不进 DeviceCommandExecutor。
    //    安全句（疑问/否定）在此被拦截；其余一律生成“待确认结果”，绝不自动执行。
    if (isResourceIntent(intent)) {
      const safety = evaluateResourceCommand(intent, raw)
      if (!safety.allowed) {
        return { kind: 'failed', hint: safety.message }
      }
      const result = buildResourceResult(data, safety.intent)
      if (!result) {
        return { kind: 'failed', hint: AI_COMMAND_FAILURE_HINT }
      }
      return { kind: 'resource_pending', intent: safety.intent, result }
    }

    // ③ 课堂状态意图 → ClassroomCommandExecutor（白名单内）。
    const verdict = classifyAiIntent(intent, raw)
    if (verdict.allowed) {
      if (!isExecutorGroup(executors)) {
        const result = await executors.execute(verdict.match)
        return { kind: 'executed', intent, message: result.message }
      }
      const operation = verdict.match.command === 'next' ? 'next_step' : 'previous_step'
      return {
        kind: 'confirmation_required',
        intent,
        message: '该操作由 AI 判读，需要教师确认后执行。',
        match: {
          operation,
          normalized: raw,
          label: intent,
          requiresConfirmation: true,
          source: 'builtin',
        },
      }
    }
    const reply = typeof data?.reply === 'string' ? data.reply : ''
    // ④ 白名单外（open_resources/open_chat/start_activity 等）→ unsupported，不执行。
    return { kind: 'unsupported', intent, reply }
  } catch {
    // 超时 / ECONNABORTED / 网络 / 5xx / 格式非法 —— 统一安全失败。
    return { kind: 'failed', hint: AI_COMMAND_FAILURE_HINT }
  }
}

/** 便捷判断：某 runId 仍有效（供迟到防护断言/组件内使用）。 */
export function isActiveCommandRun(currentRunId: number, staleRunId: number): boolean {
  return currentRunId === staleRunId
}

/** 供测试断言：失败结果绝不携带可执行意图。 */
export function isExecutableOutcome(outcome: AiCommandOutcome): outcome is { kind: 'executed'; intent: string; message: string } {
  return outcome.kind === 'executed'
}

// 仅为单元测试引用类型，保持 ClassroomIntentMatch / ClassroomIntent 被消费以避免未使用告警。
export type { ClassroomIntentMatch }
export { ClassroomIntent }
