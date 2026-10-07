import { http } from '@/api/http'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

export type ClassroomCommandSource =
  | 'screen'
  | 'mobile'
  | 'voice'
  | 'ai_director'
  | 'teacher_panel'

export type ClassroomCommandOperation =
  | 'previous_step'
  | 'next_step'
  | 'switch_step'
  | 'pause_class'
  | 'resume_class'
  | 'open_resource'
  | 'play_resource'
  | 'pause_media'
  | 'resume_media'
  | 'stop_media'
  | 'previous_page'
  | 'next_page'
  | 'zoom_in'
  | 'zoom_out'
  | 'set_volume'
  | 'mute'
  | 'unmute'
  | 'speak_text'
  | 'display_artwork'
  | 'attendance_update'
  | 'random_roll_call'
  | 'specified_roll_call'
  | 'group_roll_call'
  | 'reward_student'
  | 'revoke_reward'
  | 'start_break'
  | 'end_break'
  | 'complete_class'
  | 'cancel_class'

export type CommandRun = {
  id: number
  deviceId: number
  version: number
}

export type ClassroomCommandResult<T = unknown> = {
  requestId: string
  runId: number
  operation: ClassroomCommandOperation
  source: ClassroomCommandSource
  targetDeviceId: number | null
  status: 'success'
  result: T
  classroomState: ClassroomRunPayload
}

export function classroomRequestId(prefix = 'command'): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function executeClassroomCommand<T = unknown>(
  run: CommandRun,
  operation: ClassroomCommandOperation,
  options: {
    source?: ClassroomCommandSource
    deviceId?: number
    targetDeviceId?: number
    parameters?: Record<string, unknown>
    requestId?: string
  } = {},
): Promise<ClassroomCommandResult<T>> {
  const requestId = options.requestId ?? classroomRequestId(operation)
  const { data } = await http.post<ClassroomCommandResult<T> | ClassroomRunPayload>(
    '/classroom-commands',
    {
      requestId,
      runId: run.id,
      deviceId: options.deviceId ?? run.deviceId,
      expectedVersion: run.version,
      source: options.source ?? 'screen',
      operation,
      ...(options.targetDeviceId == null
        ? {}
        : { targetDeviceId: options.targetDeviceId }),
      ...(options.parameters ? { parameters: options.parameters } : {}),
    },
  )
  // 兼容旧测试夹具及过渡期网关：正式新接口返回命令信封；若旧兼容层直接
  // 返回课堂状态，则只在客户端归一化，不改变服务端权威状态。
  if ('classroomState' in data) return data
  return {
    requestId,
    runId: run.id,
    operation,
    source: options.source ?? 'screen',
    targetDeviceId: options.targetDeviceId ?? null,
    status: 'success',
    result: null as T,
    classroomState: data,
  }
}
