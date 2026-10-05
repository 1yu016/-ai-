/**
 * DeviceCommandExecutor（Stage 6.4）—— 结构化媒体意图 → ResourcePlayer。
 *
 * 职责边界：
 *  - 只接收已结构化的 DeviceIntentMatch，不做任何自然语言理解；
 *  - 只通过 ResourcePlayer store 暴露的基础能力下发控制（requestControl /
 *    setVolume / 状态读取），禁止直接访问 HTMLVideoElement / HTMLAudioElement；
 *  - 纯前端，绝不调用 /classroom-runs 后端接口。
 *
 * 安全要求（需求 §六）：任何执行前先做状态检查。
 *  - 无当前可控制媒体（非 audio/video 或未打开）→ executed=false + 明确反馈，
 *    不得假装成功；
 *  - 无当前资源时 CLOSE_RESOURCE 为安全 no-op，但不显示“已关闭资源”假成功。
 */
import type { useResourcePlayerStore } from '@/stores/resourcePlayer'
import type { DeviceIntent, DeviceIntentMatch } from './DeviceIntent'

/** 结构化执行结果（需求 §六要求返回结构化结果，而非仅 void）。 */
export interface DeviceCommandResult {
  executed: boolean
  /** 人类可读反馈（给教师提示）。executed=false 时即“未执行”原因说明。 */
  message: string
  /** 未执行的机器可读原因（no_media / no_resource / unknown）。 */
  reason?: string
  intent: DeviceIntent
}

/** “当前没有正在播放的媒体。”统一未执行反馈。 */
export const NO_MEDIA_FEEDBACK = '当前没有正在播放的媒体。'
/** CLOSE 无资源时的反馈（安全 no-op，不显示假成功）。 */
export const NO_RESOURCE_FEEDBACK = '当前没有打开的媒体。'
/** 音量无可调整对象时的反馈。 */
export const NO_VOLUME_FEEDBACK = '当前没有可调整音量的媒体。'

export class DeviceCommandExecutor {
  constructor(
    private readonly resourcePlayer: ReturnType<typeof useResourcePlayerStore>,
  ) {}

  /** 是否存在可播放媒体（audio/video 且已打开）。 */
  hasPlayableMedia(): boolean {
    return this.resourcePlayer.hasPlayableMedia
  }

  /** 是否存在当前资源（不限媒体类型）。 */
  hasCurrentResource(): boolean {
    return this.resourcePlayer.currentResource != null
  }

  execute(match: DeviceIntentMatch): DeviceCommandResult {
    const intent = match.intent
    switch (intent) {
      case 'PAUSE_MEDIA':
        if (!this.hasPlayableMedia()) {
          return { executed: false, message: NO_MEDIA_FEEDBACK, reason: 'no_media', intent }
        }
        this.resourcePlayer.requestControl('pause')
        return { executed: true, message: '已暂停播放。', intent }
      case 'RESUME_MEDIA':
        if (!this.hasPlayableMedia()) {
          return { executed: false, message: NO_MEDIA_FEEDBACK, reason: 'no_media', intent }
        }
        this.resourcePlayer.requestControl('resume')
        return { executed: true, message: '已继续播放。', intent }
      case 'STOP_MEDIA':
        if (!this.hasPlayableMedia()) {
          return { executed: false, message: NO_MEDIA_FEEDBACK, reason: 'no_media', intent }
        }
        this.resourcePlayer.requestControl('stop')
        return { executed: true, message: '已停止播放。', intent }
      case 'CLOSE_RESOURCE':
        if (!this.hasCurrentResource()) {
          return { executed: false, message: NO_RESOURCE_FEEDBACK, reason: 'no_resource', intent }
        }
        this.resourcePlayer.requestControl('close')
        return { executed: true, message: '已关闭资源。', intent }
      case 'VOLUME_UP':
      case 'VOLUME_DOWN':
        if (!this.hasPlayableMedia()) {
          return { executed: false, message: NO_VOLUME_FEEDBACK, reason: 'no_media', intent }
        }
        // 步进 0.1，四舍五入到 1 位小数，避免浮点累积误差（0.8-0.1=0.7000000000000001）。
        const step = 0.1
        const current = this.resourcePlayer.volume
        const next = Math.round((intent === 'VOLUME_UP' ? current + step : current - step) * 10) / 10
        this.resourcePlayer.setVolume(next)
        return {
          executed: true,
          message: intent === 'VOLUME_UP' ? '音量已调大。' : '音量已调小。',
          intent,
        }
      default:
        return { executed: false, message: '未知媒体指令。', reason: 'unknown', intent }
    }
  }
}