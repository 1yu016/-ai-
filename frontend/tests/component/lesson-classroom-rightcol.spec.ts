import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// Stage：《课堂右侧布局修正》—— 数字人常驻主卡 + 课堂互动/本节榜单 compact launcher。
// 覆盖：右侧三段式层级、紧凑入口（不再常驻完整点名/奖励面板）、点击数字人进大屏、窄屏可折叠。

const duoDuo = {
  id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null,
  status: 'active', createdAt: '', updatedAt: '',
}
const runPayload = {
  id: 9, lessonPlanId: 3, classId: 1, deviceId: 1, version: 2,
  status: 'running', currentStepIndex: 0, title: '认识数字1',
  steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '今天我们一起认识数字1', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5, startedAt: '2026-10-02T07:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
}

async function settle() {
  await flushPromises()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · 课堂右侧布局（数字人常驻 + 紧凑入口）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1440,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountView() {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) return { data: { items: [], total: 0, runTitle: '认识数字1' } } as never
        return { data: runPayload } as never
      }
      if (/\/students/.test(u)) return { data: { items: [duoDuo], total: 1 } } as never
      return { data: {} } as never
    })
    const pinia = createPinia()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView, meta: { requiresAuth: true } },
      ],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    return mount(LessonClassroomView, {
      global: {
        plugins: [router, ElementPlus, pinia],
        stubs: { ResourcePlayer: true, DigitalHumanStage: true, ClassroomAvatar: true, teleport: true },
      },
      attachTo: document.body,
    })
  }

  it('#1 右侧三段式：AI教学伙伴主卡在前，课堂互动/本节榜单紧凑入口在后', async () => {
    const wrapper = await mountView()
    await settle()
    // AI 教学伙伴主卡常驻，带状态标签。
    const card = wrapper.find('[data-test="dh-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('AI 教学伙伴')
    expect(card.text()).toContain('当前状态：待机')
    // 互动入口为紧凑 launcher（不常驻 student select / 奖励按钮）。
    expect(wrapper.find('[data-test="open-interaction"]').text()).toContain('课堂互动')
    expect(wrapper.find('[data-test="open-interaction"] .l-stars').text()).toContain('🌟 本节 0')
    expect(wrapper.find('[data-test="open-interaction"] .l-sub').text()).toContain('点名 · 快速奖励')
    expect(wrapper.find('.assist-col .i-select').exists()).toBe(false)
    expect(wrapper.find('.assist-col .i-add').exists()).toBe(false)
    // 榜单入口为紧凑 launcher。
    expect(wrapper.find('[data-test="open-leaderboard"]').text()).toContain('本节榜单')
    expect(wrapper.find('[data-test="open-leaderboard"] .l-sub').text()).toContain('查看课堂表现')
    wrapper.unmount()
  })

  it('#2 点击数字人主体 → 数字人大屏（activeFullscreenPanel=avatar），不重载课堂', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="dh-stage"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-avatar"]').exists()).toBe(true)
    expect(wrapper.find('.fs-title').text()).toContain('AI 教学伙伴')
    // 大屏内提供助教互动/TTS 区块。
    expect(wrapper.find('[data-test="fs-avatar-chat"]').exists()).toBe(true)
    // 关闭返回课堂。
    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#3 [进入数字人大屏] 按钮同样打开大屏', async () => {
    const wrapper = await mountView()
    await settle()
    expect(wrapper.find('[data-test="enter-avatar"]').text()).toContain('数字人大屏')
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-avatar"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#4 互动 launcher → interaction fullscreen；榜单 launcher → leaderboard fullscreen', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-interaction"]').exists()).toBe(true)
    // 全屏内才是完整点名+奖励面板（普通态不常驻这些控件）。
    expect(wrapper.find('[data-test="random-roll"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="reward-cta"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="student-chip"]').exists()).toBe(true)
    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-leaderboard"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#5 数字人卡可折叠（窄屏），默认仍展开，折叠后主体隐藏、可恢复', async () => {
    const wrapper = await mountView()
    await settle()
    expect(wrapper.find('[data-test="dh-stage"]').exists()).toBe(true)
    await wrapper.find('[data-test="dh-collapse"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="dh-stage"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="dh-collapse"]').text()).toContain('展开数字人')
    await wrapper.find('[data-test="dh-collapse"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="dh-stage"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
