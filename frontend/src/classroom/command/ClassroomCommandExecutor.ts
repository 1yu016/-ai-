/**
 * 结构化课堂命令执行器 — 严格遵守后端权威原则。
 *
 * 设计：Executor 仅接受预定义的结构化 intent + command，不做自然语言理解。
 * 它直接把命令映射到 lessonRun store 已有的方法，最终落到 existing 后端 API。
 * 遵循「最大化复用已有后端接口」原则，绝不新增写入口。
 *
 * 当前：
 *  - 权威状态修改 → 必须调用 lessonRun 方法，最终落到后端 POST /classroom-runs API。
 *  - 前端设备/UI 指令 → 调用 resourcePlayer / lessonRun 本地已有方法，不写后端。
 */
import type { useLessonRunStore } from '@/stores/lessonRun'
import type { useResourcePlayerStore } from '@/stores/resourcePlayer'
import type { ClassroomIntentMatch } from './ClassroomIntent'
import type { TeacherVoiceCommandMatch } from './TeacherVoiceCommandRouter'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'

/** 结构化命令执行结果。 */
export interface CommandExecResult {
  success: boolean
  /** 人类可读的操作反馈（给教师提示） */
  message: string
  /** 触发了哪个命令，用于日志 */
  command: ClassroomIntentMatch['command'] | ClassroomCommandOperation
}

/**
 * Executor 构造：依赖注入 lessonRun 与 resourcePlayer store，
 * 保证测试易注入 mock。
 */
export class ClassroomCommandExecutor {
  constructor(
    private readonly lessonRun: ReturnType<typeof useLessonRunStore>,
    private readonly resourcePlayer: ReturnType<typeof useResourcePlayerStore>,
  ) {}

  /**
   * 执行本地匹配到的结构化命令。
   * 遵循后端权威原则：所有权威命令都通过 lessonRun → existing API。
   */
  async execute(match: ClassroomIntentMatch): Promise<CommandExecResult> {
    const command = match.command
    if (!command) {
      return {
        success: false,
        message: '无法识别这条指令，请重新说一遍。',
        command: null,
      }
    }

    switch (command) {
      case 'next':
        await this.lessonRun.next('voice')
        return {
          success: true,
          message: '已进入下一环节。',
          command: 'next',
        }
      case 'previous':
        await this.lessonRun.previous('voice')
        return {
          success: true,
          message: '已回到上一环节。',
          command: 'previous',
        }
      case 'pause':
        await this.lessonRun.pause('voice')
        return {
          success: true,
          message: '课堂已暂停。',
          command: 'pause',
        }
      case 'resume':
        await this.lessonRun.resume('voice')
        return {
          success: true,
          message: '继续上课。',
          command: 'resume',
        }
      case 'reset':
        this.lessonRun.repeat()
        return {
          success: true,
          message: '本环节已重置。',
          command: 'reset',
        }
      default:
        return {
          success: false,
          message: `指令 ${command} 未实现。`,
          command,
        }
    }
  }

  /**
   * 教师点击录音后的结构化指令统一入口。所有状态变更先写入课堂命令总线，
   * 服务端成功后才同步本机播放器，避免出现“界面成功、后端未保存”。
   */
  async executeVoice(match: TeacherVoiceCommandMatch): Promise<CommandExecResult> {
    if (match.operation === 'previous_step') {
      await this.lessonRun.previous('voice')
      return { success: true, message: '已回到上一环节。', command: match.operation }
    }
    if (match.operation === 'next_step') {
      await this.lessonRun.next('voice')
      return { success: true, message: '已进入下一环节。', command: match.operation }
    }
    if (match.operation === 'switch_step') {
      await this.lessonRun.move(Number(match.parameters?.stepIndex ?? 0), 'voice')
      return { success: true, message: `已执行：${match.label}。`, command: match.operation }
    }
    if (match.operation === 'start_break') {
      await this.lessonRun.startBreak(match.parameters as never, 'voice')
      return { success: true, message: '已进入课间。', command: match.operation }
    }
    if (match.operation === 'end_break') {
      await this.lessonRun.endBreak('voice')
      return { success: true, message: '课间已结束。', command: match.operation }
    }
    if (match.operation === 'complete_class') {
      await this.lessonRun.complete('voice')
      return { success: true, message: '课堂已完成。', command: match.operation }
    }
    const run = this.lessonRun.run
    if (!run) return { success: false, message: '当前没有进行中的课堂。', command: match.operation }
    const mediaOperations: ClassroomCommandOperation[] = [
      'open_resource', 'play_resource', 'pause_media', 'resume_media', 'stop_media',
      'previous_page', 'next_page', 'zoom_in', 'zoom_out', 'set_volume', 'mute', 'unmute',
    ]
    const parameters = { ...(match.parameters ?? {}) }
    if (match.operation === 'set_volume' && typeof parameters.volumeDelta === 'number') {
      parameters.volume = Math.max(0, Math.min(1, this.resourcePlayer.volume + parameters.volumeDelta))
      delete parameters.volumeDelta
    }
    await this.lessonRun.command(
      match.operation,
      parameters,
      'voice',
      mediaOperations.includes(match.operation) ? run.deviceId : undefined,
    )
    switch (match.operation) {
      case 'pause_media': this.resourcePlayer.requestControl('pause'); break
      case 'resume_media': this.resourcePlayer.requestControl('resume'); break
      case 'stop_media': this.resourcePlayer.requestControl('stop'); break
      case 'previous_page': this.resourcePlayer.requestControl('previous'); break
      case 'next_page': this.resourcePlayer.requestControl('next'); break
      case 'zoom_in': this.resourcePlayer.setZoom(this.resourcePlayer.zoom + 0.25); break
      case 'zoom_out': this.resourcePlayer.setZoom(this.resourcePlayer.zoom - 0.25); break
      case 'set_volume': this.resourcePlayer.setVolume(Number(parameters.volume)); break
      case 'mute': this.resourcePlayer.setMuted(true); break
      case 'unmute': this.resourcePlayer.setMuted(false); break
    }
    return { success: true, message: `已执行：${match.label}。`, command: match.operation }
  }
}
