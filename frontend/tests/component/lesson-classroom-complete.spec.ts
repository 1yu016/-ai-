import { ElMessageBox } from 'element-plus'
import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { platformApi } from '@/api/platform'
import * as checkpoint from '@/services/classroomCheckpoint'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// Stage：complete 成功后跳转课堂总结页，失败留在课堂页（#10 / #11）。
const runPayload = {
  id: 9, lessonPlanId: 3, classId: 1, deviceId: 1, version: 2,
  status: 'running', currentStepIndex: 0, title: '春天课堂',
  steps: [{ stepIndex: 0, title: '看一看', type: 'question', content: '你发现了什么？', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5, startedAt: '2026-10-02T07:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
}

async function settle() {
  await flushPromises()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · complete 后跳转总结页', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountView() {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) return { data: { items: [], total: 0 } } as never
        return { data: runPayload } as never
      }
      if (/\/students/.test(u)) return { data: { items: [], total: 0 } } as never
      return { data: {} } as never
    })
    vi.spyOn(platformApi, 'rewardLeaderboard').mockResolvedValue({
      data: { classId: 1, className: '小一班', items: [] },
    } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '春天课堂' } as never)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView, meta: { requiresAuth: true } },
        { path: '/classroom/lesson/:runId/summary', name: 'lesson-classroom-summary', component: { template: '<div>summary</div>' }, meta: { requiresAuth: true } },
        { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>plans</div>' }, meta: { requiresAuth: true } },
      ],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(LessonClassroomView, {
      global: { plugins: [router, ElementPlus, createPinia()], stubs: { ResourcePlayer: true } },
      attachTo: document.body,
    })
    await settle()
    return { wrapper, router, pushSpy }
  }

  it('#10 complete 请求成功后跳转 lesson-classroom-summary', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { ...runPayload, status: 'completed' } } as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, pushSpy } = await mountView()
    await (wrapper.vm as unknown as { finish: (k: 'complete' | 'cancel') => Promise<void> }).finish('complete')
    await settle()
    expect(confirm).toHaveBeenCalled()
    expect(pushSpy).toHaveBeenCalledWith({ name: 'lesson-classroom-summary', params: { runId: 9 } })
    wrapper.unmount()
  })

  it('#11 complete 请求失败：不跳转总结页', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new Error('网络错误'))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper, pushSpy } = await mountView()
    await (wrapper.vm as unknown as { finish: (k: 'complete' | 'cancel') => Promise<void> }).finish('complete')
    await settle()
    const summaryCalls = pushSpy.mock.calls.filter(
      (c) => (c[0] as { name?: string } | undefined)?.name === 'lesson-classroom-summary',
    )
    expect(summaryCalls).toHaveLength(0)
    wrapper.unmount()
  })
})