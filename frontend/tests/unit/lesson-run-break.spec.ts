import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'

// Stage 7.4：课间休息 —— 权威数据来自 run.breakEndsAt + serverNow 时钟校准，倒计时按 breakEndsAt 计算而非每秒自减。
const NOW = new Date('2026-10-02T08:00:00.000Z')
const running = (): ClassroomRunPayload => ({
  id: 9,
  lessonPlanId: 3,
  classId: 1,
  deviceId: 1,
  version: 1,
  status: 'running',
  currentStepIndex: 0,
  title: '春天课堂',
  steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '看一看', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5,
  startedAt: '2026-10-02T07:00:00.000Z',
  updatedAt: '2026-10-02T08:00:00.000Z',
})
const inBreak = (endsOffsetSeconds = 300, serverNow = NOW.toISOString()): ClassroomRunPayload => ({
  ...running(),
  version: 2,
  breakStartedAt: NOW.toISOString(),
  breakEndsAt: new Date(NOW.getTime() + endsOffsetSeconds * 1000).toISOString(),
  serverNow,
})

describe('lessonRun store · Stage 7.4 课间休息', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('开始课间：POST /break 成功后才进入课间，并应用后端新 run/version', async () => {
    const store = useLessonRunStore()
    store.adoptRun(running())
    expect(store.isBreakActive).toBe(false)
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: inBreak(300) } as never)
    await store.startBreak(300)
    expect(post).toHaveBeenCalledWith(
      '/classroom-commands',
      expect.objectContaining({ expectedVersion: 1, operation: 'start_break', parameters: { durationSeconds: 300, contentType: 'water' }, requestId: expect.any(String) }),
    )
    expect(store.isBreakActive).toBe(true)
    // 成功响应应用后端返回的 version，前端不自猜 +1
    expect(store.run?.version).toBe(2)
  })

  it('POST 失败：UI 不进入课间（breakEndsAt 仍为 null）', async () => {
    const store = useLessonRunStore()
    store.adoptRun(running())
    vi.spyOn(http, 'post').mockRejectedValue(new Error('network down'))
    await expect(store.startBreak(300)).rejects.toThrow('network down')
    expect(store.isBreakActive).toBe(false)
    expect(store.run?.breakEndsAt).toBeNull()
  })

  it('倒计时按 breakEndsAt 计算（非每秒--）：时间跳过 30 秒后 remaining 精确减少 30 秒', async () => {
    const store = useLessonRunStore()
    store.adoptRun(inBreak(180))
    expect(store.breakRemainingSeconds).toBe(180)
    // 浏览器休眠/卡顿：计时器不准确也不影响，重算基于 breakEndsAt
    vi.advanceTimersByTime(30_000)
    expect(store.breakRemainingSeconds).toBe(150)
  })

  it('serverNow 偏移生效：服务器比本机快 60s 时 remaining 少算 60s', () => {
    const store = useLessonRunStore()
    const serverNow = new Date(NOW.getTime() + 60_000).toISOString()
    store.adoptRun(inBreak(180, serverNow))
    // breakEndsAt = NOW+180，有效现在 = NOW+60 → remaining = 120（本地无偏移会是 180）
    expect(store.breakRemainingSeconds).toBe(120)
  })

  it('刷新 load 后恢复课间：不重置剩余时间，isBreakActive 立即为 true', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: inBreak(300) } as never)
    const store = useLessonRunStore()
    await store.load(9)
    expect(store.isBreakActive).toBe(true)
    expect(store.breakRemainingSeconds).toBe(300)
  })

  it('提前结束课间：POST /break/end 成功后退出课间', async () => {
    const store = useLessonRunStore()
    store.adoptRun(inBreak(300))
    expect(store.isBreakActive).toBe(true)
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      data: { ...running(), version: 3, breakStartedAt: null, breakEndsAt: null },
    } as never)
    await store.endBreak()
    expect(post).toHaveBeenCalledWith(
      '/classroom-commands',
      expect.objectContaining({ expectedVersion: 2, operation: 'end_break', requestId: expect.any(String) }),
    )
    expect(store.isBreakActive).toBe(false)
    expect(store.run?.breakEndsAt).toBeNull()
    expect(store.run?.version).toBe(3)
  })

  it('polling 收到另一设备开始的课间：当前页面自动进入课间', async () => {
    const store = useLessonRunStore()
    store.adoptRun(running())
    vi.spyOn(http, 'get').mockResolvedValue({ data: inBreak(300) } as never)
    store.startPolling(200)
    await vi.advanceTimersByTimeAsync(200)
    expect(store.isBreakActive).toBe(true)
  })

  it('polling 收到提前结束：当前页面自动退出课间', async () => {
    const store = useLessonRunStore()
    store.adoptRun(inBreak(300))
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { ...running(), version: 4, breakStartedAt: null, breakEndsAt: null },
    } as never)
    store.startPolling(200)
    await vi.advanceTimersByTimeAsync(200)
    expect(store.isBreakActive).toBe(false)
  })
})
