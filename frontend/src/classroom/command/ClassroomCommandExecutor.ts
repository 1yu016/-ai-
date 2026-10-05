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

/** 结构化命令执行结果。 */
export interface CommandExecResult {
  success: boolean
  /** 人类可读的操作反馈（给教师提示） */
  message: string
  /** 触发了哪个命令，用于日志 */
  command: ClassroomIntentMatch['command']
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
        await this.lessonRun.next()
        return {
          success: true,
          message: '已进入下一环节。',
          command: 'next',
        }
      case 'previous':
        await this.lessonRun.previous()
        return {
          success: true,
          message: '已回到上一环节。',
          command: 'previous',
        }
      case 'pause':
        await this.lessonRun.pause()
        return {
          success: true,
          message: '课堂已暂停。',
          command: 'pause',
        }
      case 'resume':
        await this.lessonRun.resume()
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
}