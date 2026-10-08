import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
import ClassroomAvatar from '@/components/digital-human/ClassroomAvatar.vue'
import OpeningSequenceOverlay from '@/components/classroom/OpeningSequenceOverlay.vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useLessonRunStore } from '@/stores/lessonRun'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// 《数字人结构纠错》三态验证：Opening=3D(DigitalHumanStage opening)、Teaching=2D(ClassroomAvatar)、
// Fullscreen=3D(DigitalHumanStage far)。禁止 2D 单实例统一三态、禁止大屏重载 ClassroomRun。

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

describe('OpeningSequenceOverlay · 3D 数字人开场（真实 DigitalHumanStage，非空 target）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('#1 Opening 渲染 DigitalHumanStage opening 机位，舞台有实际数字人内容', async () => {
    const wrapper = mount(OpeningSequenceOverlay, { props: { lessonTitle: '认识数字1' } })
    await settle()
    // 右侧真实挂载 3D 数字人舞台（opening 机位），而不是空的 target。
    const stage = wrapper.findComponent(DigitalHumanStage)
    expect(stage.exists()).toBe(true)
    expect(stage.props('opening')).toBe(true)
    expect(wrapper.find('.digital-human.opening').exists()).toBe(true)
    // 舞台容器内有实际渲染内容（jsdom 无 WebGL → 2D 备用形象，但舞台不是空 div）。
    expect(wrapper.find('.digital-human.opening .avatar').exists()).toBe(true)
    // 开场 CTA 与底部字幕仍在。
    expect(wrapper.find('[data-test="opening-enter"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="opening-skip"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="opening-caption"]').text()).toContain('准备')
  })

  it('#5 Opening 不暴露开发信息（角色名/资产名/调试 selector）', async () => {
    const wrapper = mount(OpeningSequenceOverlay, { props: { lessonTitle: '认识数字1', teacherName: '王雪梅' } })
    await settle()
    const text = wrapper.text()
    expect(text).not.toContain('flower')
    expect(text).not.toContain('RobotExpressive')
    expect(text).not.toContain('.glb')
    expect(wrapper.find('.role-controls').exists()).toBe(false)
    expect(wrapper.find('.role-name').exists()).toBe(false)
    expect(text).toContain('AI 智慧课堂')
  })

  it('#6 Opening 3D 加载失败：显示友好占位文案，课堂依然可以开始', async () => {
    const store = useDigitalHumanStore()
    store.setWebglSupported(true)
    store.setModelState('error')
    store.error = '模型加载失败'
    const wrapper = mount(OpeningSequenceOverlay, { props: { lessonTitle: '认识数字1' } })
    await settle()
    // 失败态展示友好占位（不暴露原生 roleName / 资产名）。
    const meta = wrapper.find('[data-test="opening-avatar-state"]')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('AI 教学伙伴暂时没有准备好')
    expect(meta.text()).not.toContain('课堂小助手')
    // 数字人失败不阻止课堂：CTA 仍可点击进入。
    await wrapper.find('[data-test="opening-enter"]').trigger('click')
    expect(wrapper.emitted('enter')).toBeTruthy()
  })
})

describe('LessonClassroomView · 三态数字人结构（Teaching=2D / Fullscreen=3D / 课堂不被重载）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1440,
    })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountView(opts: { newlyStarted?: boolean } = {}) {
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
    setActivePinia(pinia)
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
        stubs: { ResourcePlayer: true, DigitalHumanStage: true, ClassroomAvatar: true, teleport: true },
      },
      attachTo: document.body,
    })
  }

  it('#3 Teaching 阶段右侧常驻 2D ClassroomAvatar（陪伴数字人），非 3D', async () => {
    const wrapper = await mountView()
    await settle()
    expect(wrapper.find('[data-test="opening-overlay"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    expect(wrapper.findComponent(ClassroomAvatar).exists()).toBe(true)
    expect(wrapper.find('[data-test="dh-stage"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#4 Avatar 大屏渲染 DigitalHumanStage（far 机位，controls=false），隐藏调试 selector', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-avatar"]').exists()).toBe(true)
    const stage = wrapper.findComponent(DigitalHumanStage)
    expect(stage.exists()).toBe(true)
    expect(stage.props('far')).toBe(true)
    expect(stage.props('controls')).toBe(false)
    // 大屏正式 UI：无角色选择器、无开发信息。
    expect(wrapper.find('[data-test="fs-avatar"] .role-controls').exists()).toBe(false)
    expect(wrapper.find('[data-test="fs-avatar"] .role-name').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#5 Teaching 主卡不暴露开发信息（无调试 selector / 资产名）', async () => {
    const wrapper = await mountView()
    await settle()
    const cardText = wrapper.find('[data-test="dh-card"]').text()
    expect(cardText).not.toContain('flower')
    expect(cardText).not.toContain('.glb')
    expect(wrapper.find('[data-test="dh-card"] .role-controls').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#9 进入/退出数字人大屏不改变 currentStep（课堂状态连续）', async () => {
    const wrapper = await mountView()
    await settle()
    const store = useLessonRunStore()
    expect(store.run?.currentStepIndex).toBe(0)
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    expect(store.run?.currentStepIndex).toBe(0)
    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    expect(store.run?.currentStepIndex).toBe(0)
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    wrapper.unmount()
  })

  it('#10 数字人大屏进出不重载 ClassroomRun', async () => {
    const wrapper = await mountView()
    await settle()
    const runCalls = () => vi.mocked(http.get).mock.calls.filter(([url]) => String(url).startsWith('/classroom-runs/')).length
    const before = runCalls()
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    await wrapper.find('[data-test="fs-close"]').trigger('click')
    await settle()
    expect(runCalls()).toBe(before)
    wrapper.unmount()
  })

  it('#12 Esc 只关闭手动 avatar 大屏，返回课堂', async () => {
    const wrapper = await mountView()
    await settle()
    await wrapper.find('[data-test="enter-avatar"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="fs-avatar"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(wrapper.find('[data-test="fullscreen-overlay"]').exists()).toBe(false)
    expect(wrapper.find('.assist-col').exists()).toBe(true)
    expect(wrapper.find('[data-test="dh-stage"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
