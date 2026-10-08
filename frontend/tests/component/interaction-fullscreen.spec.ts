import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// 《课堂互动全屏 · UI state》—— 只覆盖全屏操作台的展示层状态：
// 打开/关闭、选中幼儿高亮、原因 chips 选中、无选中时奖励禁用、窄屏布局 class。
// 业务（postReward/randomRoll）已由 useClassroomInteraction 连同普通面板统一覆盖，此处不复测。

const student = (id: number, name: string) => ({
  id, classId: 1, studentNo: `XB-${String(id).padStart(3, '0')}`, name, nickname: null,
  status: 'active', createdAt: '', updatedAt: '',
})
const students = [student(1, '朵朵'), student(2, '糖糖'), student(3, '果果')]
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

describe('LessonClassroomView · 互动全屏 UI state', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1440,
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function mountView() {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) return { data: { items: [], total: 0, runTitle: '认识数字1' } } as never
        return { data: runPayload } as never
      }
      if (/\/students/.test(u)) return { data: { items: students, total: students.length } } as never
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

  it('全屏打开：进入后只渲染互动全屏，顶部栏/左侧舞台/右侧操作台俱在', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="fs-interaction"]').exists()).toBe(true)
    // 顶部栏：返回/标题/本节奖励（项目自家 button，非原生 X）
    expect(wrapper.find('[data-test="fs-close"]').text()).toContain('返回课堂')
    expect(wrapper.find('[data-test="fs-title"]').text()).toBe('课堂互动')
    expect(wrapper.find('[data-test="fs-star"]').text()).toContain('本节 🌟 0')
    // 左点名 / 右奖励
    expect(wrapper.find('[data-test="selected-stage"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="reward-target-name"]').text()).toBe('请选择一名幼儿')
    wrapper.unmount()
  })

  it('全屏关闭：返回按钮把 overlay 关掉且课堂保留', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(true)

    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    wrapper.unmount()
  })

  it('选中幼儿：点名后显示为视觉焦点，对应 chip 高亮并出现 ✓，点名 CTA 变“再随机一次”', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="selected-name"]').exists()).toBe(false)
    await wrapper.find('[data-test="random-roll"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="selected-name"]').exists()).toBe(true)
    const activeChips = wrapper.findAll('[data-test="student-chip"].active')
    expect(activeChips.length).toBe(1)
    const activeName = activeChips[0]!.find('.chip-name').text()
    expect(wrapper.find('[data-test="selected-name"]').text()).toBe(activeName)
    expect(wrapper.find('[data-test="random-roll"]').text()).toContain('再随机一次')
    wrapper.unmount()
  })

  it('手动选中幼儿 chip 高亮，reward-target 显示姓名', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    const chips = wrapper.findAll('[data-test="student-chip"]')
    expect(chips.length).toBe(3)
    // 选中「糖糖」（第2个）
    await chips[1]!.trigger('click')
    await settle()
    expect(wrapper.findAll('[data-test="student-chip"].active')).toHaveLength(1)
    expect(wrapper.find('[data-test="reward-target-name"]').text()).toBe('糖糖')

    // 点「朵朵」（第1个）→ 高亮切换
    await wrapper.find('[data-test="student-chip"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="reward-target-name"]').text()).toBe('朵朵')
    wrapper.unmount()
  })

  it('reason chips：默认选中第一项，点击后高亮切换', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    const chips = wrapper.findAll('[data-test="reason-chip"]')
    expect(chips.map((c) => c.text())).toEqual(['积极回答', '主动参与', '认真观察', '乐于分享', '帮助伙伴'])
    expect(chips[0]!.classes()).toContain('active')

    await chips[2]!.trigger('click')
    await settle()
    const after = wrapper.findAll('[data-test="reason-chip"]')
    expect(after[2]!.classes()).toContain('active')
    expect(after[0]!.classes()).not.toContain('active')
    wrapper.unmount()
  })

  it('无选中时奖励主按钮禁用；选中后启用', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="reward-cta"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="student-chip"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="reward-cta"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('窄屏：<900px 时互动全屏进入 is-narrow 上下布局状态', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 800,
    })
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="open-interaction"]').trigger('click')
    await settle()

    const fs = wrapper.find('[data-test="interaction-fullscreen"]')
    expect(fs.exists()).toBe(true)
    expect(fs.classes()).toContain('is-narrow')
    expect(fs.attributes('data-narrow')).toBe('true')
    wrapper.unmount()
  })
})