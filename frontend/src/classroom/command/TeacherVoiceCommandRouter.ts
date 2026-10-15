import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'
import { isQuestion, normalize, NEGATION_GUARDS } from './ClassroomIntentPatterns'

export type TeacherCommandSynonym = {
  id?: number
  phrase: string
  normalizedPhrase?: string
  operation: ClassroomCommandOperation
}

export type TeacherVoiceCommandMatch = {
  operation: ClassroomCommandOperation
  parameters?: Record<string, unknown>
  normalized: string
  label: string
  requiresConfirmation: boolean
  source: 'builtin' | 'custom'
}

export type TeacherVoiceRoute =
  | { kind: 'command'; match: TeacherVoiceCommandMatch }
  | { kind: 'resource_search'; keyword: string; normalized: string }
  | null

export const CUSTOM_SYNONYM_OPERATIONS: ClassroomCommandOperation[] = [
  'previous_step', 'next_step', 'pause_media', 'resume_media', 'stop_media',
  'previous_page', 'next_page', 'zoom_in', 'zoom_out', 'mute', 'unmute',
  'random_roll_call', 'start_break', 'end_break', 'complete_class',
]

export const BUILTIN_VOICE_PHRASES = [
  '上一步', 'previous', 'back', '下一步', 'next', '暂停播放', 'pause',
  '继续播放', 'resume', '停止播放', 'stop', '上一页', 'previous page',
  '下一页', 'next page', '放大', 'zoom in', '缩小', 'zoom out', '静音',
  'mute', '取消静音', 'unmute', '随机点名', 'random roll call', '进入课间',
  'start break', '结束课间', 'end break', '完成课堂', 'finish class',
].map(normalize)

function blocked(normalized: string) {
  return isQuestion(normalized) || NEGATION_GUARDS.some((word) => normalized.includes(word))
}

function command(
  normalized: string,
  operation: ClassroomCommandOperation,
  label: string,
  parameters?: Record<string, unknown>,
  requiresConfirmation = false,
  source: 'builtin' | 'custom' = 'builtin',
): TeacherVoiceRoute {
  return { kind: 'command', match: { operation, parameters, normalized, label, requiresConfirmation, source } }
}

function exact(normalized: string, values: string[]) {
  return values.some((value) => normalize(value) === normalized)
}

export function routeTeacherVoiceCommand(
  raw: string,
  synonyms: TeacherCommandSynonym[] = [],
): TeacherVoiceRoute {
  const normalized = normalize(raw)
  if (!normalized || blocked(normalized)) return null

  const custom = synonyms.find((item) =>
    (item.normalizedPhrase ?? normalize(item.phrase)) === normalized,
  )
  if (custom && CUSTOM_SYNONYM_OPERATIONS.includes(custom.operation)) {
    return command(normalized, custom.operation, `自定义口令“${custom.phrase}”`, undefined,
      ['complete_class'].includes(custom.operation), 'custom')
  }

  const stepMatch = normalized.match(/^(?:切换到|进入|跳到|go to )?(?:第)?(\d+)(?:个)?(?:步骤|环节|步|step)$/)
  if (stepMatch) {
    const stepNumber = Number(stepMatch[1])
    if (stepNumber > 0) return command(normalized, 'switch_step', `切换到第${stepNumber}步`, { stepIndex: stepNumber - 1 })
  }
  if (exact(normalized, ['上一步', '上一环节', 'previous', 'previous step', 'back']))
    return command(normalized, 'previous_step', '上一环节')
  if (exact(normalized, ['下一步', '下一环节', 'next', 'next step']))
    return command(normalized, 'next_step', '下一环节')

  if (exact(normalized, ['暂停播放', '暂停资源', 'pause', 'pause media']))
    return command(normalized, 'pause_media', '暂停资源')
  if (exact(normalized, ['继续播放', '恢复播放', 'resume', 'resume media']))
    return command(normalized, 'resume_media', '继续播放')
  if (exact(normalized, ['停止播放', '停止资源', 'stop', 'stop media']))
    return command(normalized, 'stop_media', '停止资源')

  const playMatch = normalized.match(/^(?:播放|打开|play|open)\s*(.+)$/)
  if (playMatch?.[1] && !['资源', 'media', 'resource'].includes(playMatch[1]))
    return { kind: 'resource_search', keyword: playMatch[1].trim(), normalized }

  if (exact(normalized, ['上一页', '往前翻页', 'previous page', 'page back']))
    return command(normalized, 'previous_page', '上一页')
  if (exact(normalized, ['下一页', '翻页', 'next page', 'page forward']))
    return command(normalized, 'next_page', '下一页')
  if (exact(normalized, ['放大', '放大页面', 'zoom in']))
    return command(normalized, 'zoom_in', '放大')
  if (exact(normalized, ['缩小', '缩小页面', 'zoom out']))
    return command(normalized, 'zoom_out', '缩小')
  if (exact(normalized, ['静音', 'mute'])) return command(normalized, 'mute', '静音')
  if (exact(normalized, ['取消静音', '打开声音', 'unmute'])) return command(normalized, 'unmute', '取消静音')
  if (exact(normalized, ['声音大一点', '调大音量', 'volume up']))
    return command(normalized, 'set_volume', '调大音量', { volumeDelta: 0.1 })
  if (exact(normalized, ['声音小一点', '调小音量', 'volume down']))
    return command(normalized, 'set_volume', '调小音量', { volumeDelta: -0.1 })

  if (exact(normalized, ['随机点名', '随机抽一个', 'random roll call']))
    return command(normalized, 'random_roll_call', '随机点名')
  const namedRollCall = normalized.match(/^(?:点名\s*(.+)|请\s*(.+?)\s*(?:回答|起来回答)|call on\s+(.+))$/)
  const studentName = namedRollCall?.slice(1).find(Boolean)?.trim()
  if (studentName)
    return command(normalized, 'specified_roll_call', `点名${studentName}`, { studentName }, true)
  const groupRollCall = normalized.match(/^(?:点名)?\s*(第?[一二三四五六七八九十\d]+组|group\s*\d+)\s*(?:点名)?$/)
  if (groupRollCall?.[1])
    return command(normalized, 'group_roll_call', `${groupRollCall[1]}点名`, { groupKey: groupRollCall[1].trim() }, true)

  const reward = normalized.match(/^(?:奖励|表扬|reward)\s*(.+)$/)
  if (reward?.[1])
    return command(normalized, 'reward_student', `奖励${reward[1]}`, { studentName: reward[1].trim(), stars: 1, rewardCategory: 'answer', rewardForms: ['flower'] }, true)

  if (exact(normalized, ['进入课间', '开始课间', 'start break']))
    return command(normalized, 'start_break', '进入课间', { durationSeconds: 300, contentType: 'water' })
  if (exact(normalized, ['结束课间', '继续上课', 'end break']))
    return command(normalized, 'end_break', '结束课间')
  if (exact(normalized, ['完成课堂', '结束课堂', 'finish class', 'complete class']))
    return command(normalized, 'complete_class', '完成课堂', undefined, true)
  return null
}

export function synonymConflictReason(
  phrase: string,
  synonyms: TeacherCommandSynonym[] = [],
): string | null {
  const normalized = normalize(phrase)
  if (!normalized) return '口令不能为空'
  if (blocked(normalized)) return '自定义口令不能包含否定或疑问表达'
  if (BUILTIN_VOICE_PHRASES.some((item) => item === normalized || item.includes(normalized) || normalized.includes(item)))
    return '该口令与系统内置口令冲突'
  if (synonyms.some((item) => (item.normalizedPhrase ?? normalize(item.phrase)) === normalized))
    return '该口令已经存在'
  return null
}
