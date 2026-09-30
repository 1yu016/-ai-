// 自动眨眼控制器：随机间隔触发、随机闭合时长。
// - 纯逻辑（基于注入的 now 毫秒时间），可单测。
// - 只影响眼睛 morph，不阻塞 talk / 其它动作。

export interface BlinkRange {
  min: number
  max: number
}

export interface BlinkControllerOptions {
  /** 第一次眨眼的时刻（ms），测试可注入；默认按随机间隔计算 */
  firstAt?: number
  /** 眨眼间隔区间（ms） */
  blinkIntervalRange?: BlinkRange
  /** 眼睛闭合时长区间（ms） */
  closeDurationRange?: BlinkRange
}

const DEFAULT_INTERVAL: BlinkRange = { min: 2000, max: 7000 }
const DEFAULT_CLOSE: BlinkRange = { min: 100, max: 250 }

function randomIn(range: BlinkRange): number {
  return range.min + Math.random() * (range.max - range.min)
}

export class BlinkController {
  private readonly interval: BlinkRange
  private readonly closeDuration: BlinkRange
  private nextBlinkAt: number
  private blinkEndAt = 0

  constructor(now = 0, options?: BlinkControllerOptions) {
    this.interval = options?.blinkIntervalRange ?? DEFAULT_INTERVAL
    this.closeDuration = options?.closeDurationRange ?? DEFAULT_CLOSE
    this.nextBlinkAt = options?.firstAt ?? now + randomIn(this.interval)
  }

  /**
   * 返回当前眼睛睁开权重：1 = 睁眼，0 = 完全闭合。
   * 在眨眼闭合窗口内返回 0，结束后安排下一次随机眨眼。
   */
  eyeOpen(now: number): number {
    if (this.blinkEndAt > 0) {
      if (now >= this.blinkEndAt) {
        this.blinkEndAt = 0
        this.nextBlinkAt = now + randomIn(this.interval)
        return 1
      }
      return 0
    }
    if (now >= this.nextBlinkAt) {
      this.blinkEndAt = now + randomIn(this.closeDuration)
      return 0
    }
    return 1
  }
}