import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'
import { isQuestion, normalize, NEGATION_GUARDS } from './ClassroomIntentPatterns'
import { understandTeaching } from './TeachingLanguage'

export type TeacherCommandSynonym = {
  id?: number
  phrase: string
  normalizedPhrase?: string
  operation: ClassroomCommandOperation
}

export type TeacherVoiceCommandMatch = {
  confirmationId?: string
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
  // 口语化说法（语音唤醒后的自然表达），仍映射到同一个 random_roll_call 操作。
  if (/^(?:随机|随便|帮我|请)(?:点|抽|选|叫)(?:一|1)?(?:位|个|名)?(?:小朋友|小朋友回答|孩子|同学|幼儿|学生|人)?$/.test(normalized))
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

  if (exact(normalized, ['进入课间', '开始课间', '开始课间模式', '进入课间模式', 'start break']))
    return command(normalized, 'start_break', '进入课间', { durationSeconds: 300, contentType: 'water' })
  if (exact(normalized, ['结束课间', '继续上课', 'end break']))
    return command(normalized, 'end_break', '结束课间')
  if (exact(normalized, ['完成课堂', '结束课堂', 'finish class', 'complete class']))
    return command(normalized, 'complete_class', '完成课堂', undefined, true)
  return null
}

/**
 * 语音输入归一：本地小模型（Vosk）会把口语听成「随机点因为小朋友」这类近似文本，
 * 漏字/多字不应导致口令失效。这里只把「明确的词组合」还原成既有内置口令文本，
 * 不新增任何业务操作，也不猜测学生姓名。
 */
export function canonicalizeSpokenCommand(raw: string): string {
  const text = normalize(raw).replace(/\s+/g, '')
  if (!text) return ''
  // Preserve all uncertain/negative semantics for clarification. Never drop qualifiers.
  if (blocked(text) || /然后|还是|或者|如果|因为|老师说|他说|她说/.test(text)) return text
  if (understandTeaching(text)) return text
  // Only these complete utterances need local ASR normalization. Substring matching
  // below is deliberately gated so ordinary narration cannot become an operation.
  if (!/^(?:随机点因为小朋友|随便抽一个孩子吧|请帮我选一位同学|进入下一个环节|暂停一下播放|开始课间模式|结束课间|暂停课堂|继续上课|恢复上课|恢复课堂|继续课堂|结束课堂|完成课堂|播放当前资源|播放这个视频|暂停播放|恢复播放|继续播放|停止播放|关闭播放|停止资源|开始课间|进入课间|下课|奖励.+[一二两三四五1-5]朵小红花|表扬.+[一二两三四五1-5]朵小红花)$/.test(text)) return text
  const has = (...words: string[]) => words.some((word) => text.includes(word))

  const rollCallCue = has('随机', '随便', '任意', '任选', '帮我', '帮忙', '请')
  if (rollCallCue && has('点', '抽', '选', '叫') && has('小朋友', '孩子', '同学', '学生', '幼儿', '一个人')) {
    return '随机点一位小朋友'
  }
  if (has('下一步', '下一环节', '下个环节', '下一个环节', '下一个步骤')) return '下一步'
  if (has('上一步', '上一环节', '上个环节', '上一个环节')) return '上一步'

  const reward = text.match(/^(?:奖励|表扬)(.+?)([一二两三四五1-5])朵(?:小红花|红花)$/)
  if (reward?.[1]) return `给${reward[1]}${reward[2]}朵小红花`

  if (has('暂停') && has('播放', '视频', '音频', '资源') && !has('课堂', '上课')) return '暂停播放'
  if (has('继续播放', '恢复播放')) return '继续播放'
  if (has('停止播放', '停止资源', '关闭播放')) return '停止播放'
  if (has('播放') && has('当前资源', '这个资源', '当前', '这个视频', '这个音频')) return '播放当前资源'

  if (has('课间')) {
    return has('结束', '停止', '取消', '回来', '上课') ? '结束课间' : '开始课间模式'
  }
  if (has('暂停') && has('课堂', '上课')) return '暂停课堂'
  if (has('继续上课', '恢复上课', '恢复课堂', '继续课堂')) return '继续上课'
  if (has('结束课堂', '完成课堂', '下课')) return '结束课堂'
  return text
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
