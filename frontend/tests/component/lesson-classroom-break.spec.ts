import ElementPlus from 'element-plus'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// Stage 7.4：LessonClassroomView 课间渲染优先级 + polling 生命周期。
const NOW = new Date('2026-10-02T08:00:00.000Z')
const runPayload = (over: Record<string, unknown> = {}) => ({
  id: 9,
  lessonPlanId: 3,
  deviceId: 1,
  version: 2,
  status: 'running',
  currentStepIndex: 0,
  title: '春天课堂',
  steps: [{ stepIndex: 0, title: '看一看', type: 'question', content: '你发现了什么？', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5,
  startedAt: '2026-10-02T07:00:00.000Z',
  updatedAt: '2026-10-02T08:00:00.000Z',
  ...over,
})

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · Stage 7.4 课间休息', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mountView() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView, meta: { requiresAuth: true } },
      ],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    return mount(LessonClassroomView, {
      global: { plugins: [router, ElementPlus, createPinia()], stubs: { ResourcePlayer: true } },
      attachTo: document.body,
    })
  }

  it('break active：渲染“课间休息+倒计时”，隐藏推进会教学的下一步/暂停按钮', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      if (url.includes('/rewards')) return { data: { items: [], total: 0 } } as never
      return {
        data: runPayload({
          breakStartedAt: NOW.toISOString(),
          breakEndsAt: '2026-10-02T08:03:00.000Z',
          serverNow: NOW.toISOString(),
        }),
      } as never
    })
    const wrapper = await mountView()
    await settle()

    expect(wrapper.find('[data-test="break-mode"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('课间休息')
    expect(wrapper.find('[data-test="break-countdown"]').text()).toBe('03:00')
    // 课间时推进会教学的控制按钮不可见
    expect(wrapper.text()).not.toContain('下一步')
    expect(wrapper.text()).not.toContain('暂停')
    expect(wrapper.text()).toContain('提前结束课间')
    wrapper.unmount()
  })

  it('unmount 后停止 polling：不再发起 /classroom-runs/:id 轮询 GET', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const get = vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      if (url.includes('/rewards')) return { data: { items: [], total: 0 } } as never
      return { data: runPayload() } as never
    })
    const wrapper = await mountView()
    await settle()
    const runGets = () => get.mock.calls.filter(([url]) => url === '/classroom-runs/9').length
    const afterLoad = runGets()
    expect(afterLoad).toBeGreaterThanOrEqual(1)

    // 轮询周期内持续刷新 run
    await vi.advanceTimersByTimeAsync(6000)
    await settle()
    expect(runGets()).toBeGreaterThan(afterLoad)

    // 卸载后停止轮询，计时器前进也不再发请求
    const beforeUnmount = runGets()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10_000)
    await settle()
    expect(runGets()).toBe(beforeUnmount)
  })
})
