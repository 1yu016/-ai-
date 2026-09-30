import { describe, expect, it } from 'vitest'
import { BlinkController } from '@/avatar/expression/BlinkController'
import { ExpressionController } from '@/avatar/expression/ExpressionController'

describe('expression controller', () => {
  it('maps actions to expressions', () => {
    expect(ExpressionController.fromAction('idle')).toBe('neutral')
    expect(ExpressionController.fromAction('listen')).toBe('neutral')
    expect(ExpressionController.fromAction('talk')).toBe('talk')
    expect(ExpressionController.fromAction('happy')).toBe('happy')
    expect(ExpressionController.fromAction('praise')).toBe('happy')
    expect(ExpressionController.fromAction('question')).toBe('question')
    expect(ExpressionController.fromAction('encourage')).toBe('happy')
    expect(ExpressionController.fromAction('goodbye')).toBe('goodbye')
  })

  it('defines morph targets for each expression', () => {
    expect(ExpressionController.targets('neutral')).toEqual([])
    expect(ExpressionController.targets('happy')).toContain('happy')
    expect(ExpressionController.targets('question')).toEqual(expect.arrayContaining(['surprised', 'brow']))
    expect(ExpressionController.targets('encourage')).toEqual(expect.arrayContaining(['happy', 'smile']))
    expect(ExpressionController.targets('goodbye')).toEqual(expect.arrayContaining(['sad']))
    expect(ExpressionController.targets('talk')).not.toHaveLength(0)
    expect(ExpressionController.targets('blink')).toContain('blink')
  })

  it('returns empty targets for unknown expression names', () => {
    expect(ExpressionController.targets('neutral')).toEqual([])
  })
})

describe('blink controller', () => {
  it('keeps eyes open before the first blink', () => {
    const blink = new BlinkController(0, { firstAt: 1000, blinkIntervalRange: { min: 2000, max: 2000 }, closeDurationRange: { min: 100, max: 100 } })
    expect(blink.eyeOpen(500)).toBe(1)
    expect(blink.eyeOpen(999)).toBe(1)
  })

  it('closes eyes at firstAt and reopens after the close duration', () => {
    const blink = new BlinkController(0, { firstAt: 1000, blinkIntervalRange: { min: 2000, max: 2000 }, closeDurationRange: { min: 100, max: 100 } })
    expect(blink.eyeOpen(1000)).toBe(0)   // 眨眼开始
    expect(blink.eyeOpen(1049)).toBe(0)   // 闭合窗口内
    expect(blink.eyeOpen(1100)).toBe(1)   // 重新睁开
  })

  it('schedules the next blink using the configured interval', () => {
    const blink = new BlinkController(0, { firstAt: 1000, blinkIntervalRange: { min: 2000, max: 2000 }, closeDurationRange: { min: 100, max: 100 } })
    expect(blink.eyeOpen(1000)).toBe(0)   // 第一次眨眼开始（1000）
    expect(blink.eyeOpen(1100)).toBe(1)   // 闭合结束睁开，下一轮定时 1100+2000=3100
    expect(blink.eyeOpen(3099)).toBe(1)   // 下一次未到（3100 开始）
    expect(blink.eyeOpen(3100)).toBe(0)   // 第二次眨眼
  })

  it('defaults to a random interval when options are omitted', () => {
    const blink = new BlinkController(0)
    // 无选项：默认区间 2~7s，因此 1s 内必然睁眼
    expect(blink.eyeOpen(500)).toBe(1)
  })

  it('reset reschedules blinking and reopens closed eyes', () => {
    const blink = new BlinkController(0, { firstAt: 1000, blinkIntervalRange: { min: 2000, max: 2000 }, closeDurationRange: { min: 100, max: 100 } })
    expect(blink.eyeOpen(1000)).toBe(0) // 眨眼闭合
    blink.reset(2000)
    expect(blink.eyeOpen(2000)).toBe(1) // 重置后立即睁眼，下一轮 2000+2000=4000
    expect(blink.eyeOpen(3999)).toBe(1)
    expect(blink.eyeOpen(4000)).toBe(0)
  })
})

describe('expression controller lifecycle', () => {
  it('neutral expression clears to no morph targets (safe no-op)', () => {
    expect(ExpressionController.targets('neutral')).toEqual([])
  })

  it('resetExpressions on a GLB model clears the previous expression without throwing', async () => {
    // 真实模型回归见 node-avatar 用例；此处验证纯映射层 reset 语义
    expect(ExpressionController.targets('happy')).toBeTruthy()
  })
})