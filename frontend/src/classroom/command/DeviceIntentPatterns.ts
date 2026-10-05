/**
 * 设备媒体命令的语句模板 / 语义检测（Stage 6.4）。
 *
 * 核心原则（对应需求 §二「明确媒体语义」）：
 *  - 仅当口令带有「明确媒体对象 / 媒体动作」时才进入 Device 分支。
 *  - 裸口令“暂停 / 暂停一下 / 继续 / 继续上课”不含媒体词 → 一律返回 null，
 *    保持现有 Classroom 裸口令语义（PAUSE_CLASS / RESUME_CLASS）不变。
 *
 * 文本规范化与疑问/否定守卫由 DeviceIntentRouter 统一完成（复用
 * ClassroomIntentPatterns 的 normalize / isQuestion / NEGATION_GUARDS），
 * 本模块只关心「媒体语义检测」，保持单一职责。
 */
import { DeviceIntent } from './DeviceIntent'

/** 表征“媒体动作 / 媒体对象”的词。出现其一即为明确的媒体语义。 */
const MEDIA_ACTION_WORDS = [
  '播放',
  '视频',
  '音频',
  '媒体',
  '音乐',
  '动画',
  '故事',
  '绘本',
  '歌曲',
  '儿歌',
]

/** CLOSE_RESOURCE 允许的“对象”词（关闭资源/播放器/媒体…）。 */
const CLOSE_TARGET_WORDS = ['资源', '播放器', '媒体', '视频', '音频']

/** VOLUME 允许的“声音来源”词。 */
const VOLUME_SOURCE_WORDS = ['声音', '音量', '媒体', '视频', '音频']

/** 调大音量的措辞集合。 */
const VOLUME_UP_TERMS = ['大一点', '调大', '增大', '大些', '开大', '大声']
/** 调小音量的措辞集合。 */
const VOLUME_DOWN_TERMS = ['小一点', '调小', '减小', '小些', '关小', '小声']

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

/**
 * 纯语义检测：把规范化文本判为一个 DeviceIntent；无法明确判定返回 null。
 * 调用方（DeviceIntentRouter）已先做了疑问 / 否定守卫，此处只关心媒体语义。
 */
export function detectDeviceIntent(normalized: string): DeviceIntent | null {
  // 暂停 + 明确媒体 → PAUSE_MEDIA（“暂停视频 / 暂停播放 / 暂停音频”）
  if (normalized.includes('暂停') && hasAny(normalized, MEDIA_ACTION_WORDS)) {
    return DeviceIntent.PAUSE_MEDIA
  }
  // 恢复 / 继续 + 明确媒体 → RESUME_MEDIA（“继续播放 / 继续视频 / 恢复播放”）
  const resumeMedia =
    normalized.includes('恢复') ||
    normalized.includes('接着') ||
    normalized.includes('继续')
  if (
    resumeMedia &&
    (hasAny(normalized, MEDIA_ACTION_WORDS) ||
      normalized.includes('播放'))
  ) {
    return DeviceIntent.RESUME_MEDIA
  }
  // 停止 + 明确媒体 → STOP_MEDIA（“停止播放 / 停止视频”）
  if (normalized.includes('停止') && hasAny(normalized, MEDIA_ACTION_WORDS)) {
    return DeviceIntent.STOP_MEDIA
  }
  // 关闭 + 资源/播放器/媒体 → CLOSE_RESOURCE（“关闭资源 / 关闭播放器”）
  if (normalized.includes('关闭') && hasAny(normalized, CLOSE_TARGET_WORDS)) {
    return DeviceIntent.CLOSE_RESOURCE
  }
  // 声音来源 + 调大 → VOLUME_UP（“声音大一点 / 媒体声音大一点”）
  if (
    hasAny(normalized, VOLUME_SOURCE_WORDS) &&
    hasAnyTerm(normalized, VOLUME_UP_TERMS)
  ) {
    return DeviceIntent.VOLUME_UP
  }
  // 声音来源 + 调小 → VOLUME_DOWN（“声音小一点”）
  if (
    hasAny(normalized, VOLUME_SOURCE_WORDS) &&
    hasAnyTerm(normalized, VOLUME_DOWN_TERMS)
  ) {
    return DeviceIntent.VOLUME_DOWN
  }
  return null
}

/** 供单测导出。 */
export {
  MEDIA_ACTION_WORDS,
  CLOSE_TARGET_WORDS,
  VOLUME_SOURCE_WORDS,
  VOLUME_UP_TERMS,
  VOLUME_DOWN_TERMS,
}