import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonRunStore } from '@/stores/lessonRun'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// Stage：《全屏板块 + 数字人开场》 —— LessonClassroomView 集成行为。
// 覆盖：统一 activeFullscreenPanel 三种全屏态 + 关闭、榜单全屏聚合、开场一次性进入与可跳过。

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
const rec = (id: number, studentId: number, studentName: string, stars: number, reason: string) => ({
  id, studentId, studentName, classId: 1, classroomRunId: 9, teacherId: 1, teacherName: '王雪梅',
  rewardType: 'flower', stars, reason, requestId: `r${id}`, createdAt: '2026-10-02T08:00:00.000Z',
})
// 朵朵3 / 阳阳2 / 糖糖2 / 果果1 / 乐乐1
const rewardItems = [
  rec(1, 1, '朵朵', 1, '积极回答'),
  rec(2, 2, '阳阳', 1, '主动参与'),
  rec(3, 1, '朵朵', 1, '认真观察'),
  rec(4, 2, '阳阳', 1, '乐于分享'),
  rec(5, 1, '朵朵', 1, '乐于分享'),
  rec(6, 3, '糖糖', 2, '积极回答'),
  rec(7, 5, '果果', 1, '认真观察'),
  rec(8, 6, '乐乐', 1, '主动参与'),
]

async function settle() {
  await flushPromises()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · 全屏板块 + 开场', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1440,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountView(opts: { newlyStarted?: boolean; rewards?: ReturnType<typeof rec>[] } = {}) {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) {
          const items = opts.rewards ?? []
          return { data: { items, total: items.length, runTitle: '认识数字1' } } as never
        }
        return { data: runPayload } as never
      }
      if (/\/students/.test(u)) return { data: { items: [duoDuo], total: 1 } } as never
      return { data: {} } as never
    })
    const pinia = createPinia()
    if (opts.newlyStarted) useLessonRunStore(pinia).newlyStarted = true
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
        // Teleport 内渲染 + 数字人占位，便于断言全屏内容。
        stubs: { ResourcePlayer: true, DigitalHumanStage: true, ClassroomAvatar: true, teleport: true },
      },
      attachTo: document.body,
    })
  }

  it('#1 榜单全屏：点击「查看本节表现」展开 overlay，默认显示本节课奖励榜', async () => {
    const wrapper = await mountView({ rewards: rewardItems })
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)

    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="lb-list"]').exists()).toBe(true)
    const names = wrapper.findAll('.lb-item .lb-name').map((n) => n.text())
    expect(names).toEqual(['朵朵', '阳阳', '糖糖', '果果', '乐乐'])
    // 同分稳定：阳阳(2) 在 糖糖(2) 之前（studentId ASC），朵朵3 居首。
    const ranks = wrapper.findAll('.lb-item .lb-rank').map((r) => r.text())
    expect(ranks).toEqual(['1', '2', '3', '4', '5'])
    const stars = wrapper.findAll('.lb-item .lb-stars').map((s) => s.text())
    expect(stars).toEqual(['🌟 3', '🌟 2', '🌟 2', '🌟 1', '🌟 1'])
    wrapper.unmount()
  })

  it('#2 榜单全屏聚合错误：少于5人、空态、仅有该同学记录时不越界', async () => {
    const wrapper = await mountView({ rewards: [rec(1, 1, '朵朵', 1, '积极回答')] })
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.findAll('.lb-item')).toHaveLength(1)
    expect(wrapper.find('.lb-item .lb-name').text()).toBe('朵朵')
    wrapper.unmount()
  })

  it('#3 榜单空态：本节无奖励显示占位文案', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="lb-empty"]').text()).toContain('本节课暂无奖励记录')
    wrapper.unmount()
  })

  it('#4 单一全屏：同时只能一个板块，后打开的覆盖', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)
    expect(document.body.querySelectorAll('.fs-body').length).toBe(1)

    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()
    expect(document.body.querySelectorAll('.fs-body').length).toBe(1)
    expect(wrapper.find('[data-test="fs-interaction"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="fs-leaderboard"]').exists()).toBe(false)

    // 关闭：overlay 消失。
    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#5 课堂互动全屏复用 useClassroomInteraction，可正常发放', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-interaction"]').exists()).toBe(true)
    // 复用同一个互动实现（点名 + 快速奖励）而非第二套逻辑。
    expect(wrapper.find('[data-test="random-roll"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="reward-cta"]').exists()).toBe(true)
    expect(wrapper.find('.ss-summ .stars').text()).toContain('0')
    wrapper.unmount()
  })

  it('#6 数字人大屏：AI 教学伙伴 提供明确入口，全屏显示标题', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    // 卡片上存在「数字人大屏」入口。
    expect(wrapper.find('[data-test="enter-avatar"]').text()).toContain('数字人大屏')
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-avatar"]').exists()).toBe(true)
    expect(wrapper.find('.fs-title').text()).toContain('AI 教学伙伴')
    wrapper.unmount()
  })

  it('#7 开场：newlyStarted 一次性标记 → 显示 OpeningSequenceOverlay，可跳过进入教学', async () => {
    const wrapper = await mountView({ newlyStarted: true, rewards: [] })
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="opening-overlay"]').text()).toContain('认识数字1')
    await wrapper.find('[data-test="opening-skip"]').trigger('click')
    await settle()
    // 进入教学：开场关闭，正常课堂渲染。
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(false)
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#8 不重复开场：非新建（newlyStarted=false）不播放开场', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#9 「进入课堂」也可进入教学（跳过开场与正常进入同出口）', async () => {
    const wrapper = await mountView({ newlyStarted: true, rewards: [] })
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(true)
    await wrapper.find('[data-test="opening-enter"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#7 Esc 关闭普通 fullscreen，且恢复课堂', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    // 关闭后课堂仍在（assist-col 普通态保留）。
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#8 Esc 不会绕过 OpeningSequenceOverlay 开场', async () => {
    const wrapper = await mountView({ newlyStarted: true, rewards: [] })
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    // 开场明确靠按钮，误按 Esc 不直接跳过。
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#1 三个入口在普通态呈卡片形态，未默认全屏', async () => {
    const wrapper = await mountView({ rewards: [] })
    await settle()
    expect(wrapper.find('[data-test="open-interaction"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="open-leaderboard"]').text()).toContain('榜单')
    expect(wrapper.find('[data-test="enter-avatar"]').text()).toContain('数字人大屏')
    // 普通态下没有全屏 overlay。
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#23 窄屏下榜单全屏仍正常展开并展示本节榜', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1000,
    })
    const wrapper = await mountView({ rewards: rewardItems })
    await settle()
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="lb-list"]').exists()).toBe(true)
    expect(wrapper.findAll('.lb-item')).toHaveLength(5)
    wrapper.unmount()
  })
})