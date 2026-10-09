import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { platformApi } from '@/api/platform'
import ClassroomPreflightView from '@/views/ClassroomPreflightView.vue'

vi.mock('@/stores/lessonPlan', () => ({
  useLessonPlanStore: () => ({
    current: ref({ id: 1, title: '观察图片', steps: [{ durationSeconds: 60 }] }),
    loading: ref(false),
    error: ref(''),
    load: () => Promise.resolve(),
  }),
}))

async function mountPreflight(deviceStatus: string) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  vi.spyOn(platformApi, 'listClasses').mockResolvedValue({
    data: { items: [{ id: 3, name: '中班' }] },
  } as never)
  vi.spyOn(platformApi, 'listClassrooms').mockResolvedValue({
    data: [{ id: 40, name: '一号教室' }],
  } as never)
  vi.spyOn(platformApi, 'listDevices').mockResolvedValue({
    data: [
      {
        id: 55,
        name: '正式大屏',
        status: deviceStatus,
        binding: { className: '中班' },
      },
    ],
  } as never)
  vi.spyOn(platformApi, 'classDeviceBindings').mockResolvedValue({
    data: [{ classroomId: 40, deviceId: 55 }],
  } as never)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/preflight/:planId',
        component: ClassroomPreflightView,
      },
      { path: '/lesson-plans', component: { template: '<div>教案列表</div>' } },
    ],
  })
  await router.push('/preflight/1?classId=3&classroomId=40&deviceId=55')
  await router.isReady()
  const wrapper = mount(ClassroomPreflightView, {
    global: { plugins: [createPinia(), router, ElementPlus] },
  })
  await flushPromises()
  // runChecks() 内置 180ms 延时，等待其结束以便 canEnter 反映真实结果
  await new Promise((resolve) => setTimeout(resolve, 220))
  await flushPromises()
  return wrapper
}

function enterButton(wrapper: ReturnType<typeof mount>) {
  const found = wrapper
    .findAll('button')
    .find((b) => b.text().includes('进入课堂'))
  return found?.element as HTMLButtonElement | undefined
}

describe('ClassroomPreflight device error semantics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks start and explains an offline bound screen', async () => {
    const wrapper = await mountPreflight('offline')
    expect(wrapper.text()).toContain('当前离线')
    expect(wrapper.text()).toContain('打开大屏页面')
    expect(enterButton(wrapper)?.disabled).toBe(true)
  })

  it('explains a disabled device instead of a generic message', async () => {
    const wrapper = await mountPreflight('disabled')
    expect(wrapper.text()).toContain('已停用')
  })

  it('explains a fault device instead of a generic message', async () => {
    const wrapper = await mountPreflight('fault')
    expect(wrapper.text()).toContain('故障')
  })

  it('allows starting when the bound screen is online', async () => {
    const wrapper = await mountPreflight('online')
    expect(wrapper.text()).not.toContain('无法开始课堂')
    expect(enterButton(wrapper)?.disabled).toBe(false)
  })
})