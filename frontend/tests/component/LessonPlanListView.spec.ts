import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { platformApi } from '@/api/platform'
import LessonPlanListView from '@/views/LessonPlanListView.vue'

// ManagementLayout 挂载时会请求 active run；这里统一 mock 为空，避免真实网络。
vi.mock('@/api/http', () => ({
  http: { get: vi.fn().mockResolvedValue({ data: null }) },
  apiErrorMessage: (e: unknown, fallback: string) => fallback,
}))

const classesData = {
  data: { items: [{ id: 1, name: '小一班', grade: '小班', ageRange: '3-4', schoolYear: '', status: 'active' }], total: 1, page: 1, pageSize: 50 },
}

async function mountView(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLessonPlanStore(pinia)
  vi.spyOn(store, 'fetchList').mockResolvedValue(undefined as never)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/lesson-plans', name: 'lesson-plans', component: LessonPlanListView },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>学生页</div>' } },
      { path: '/chat', name: 'chat', component: { template: '<div>助教</div>' } },
      { path: '/lesson-plans/new', name: 'lesson-plan-new', component: { template: '<div>新建</div>' } },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(LessonPlanListView, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('LessonPlanListView 备课中心（返回班级）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(platformApi, 'classes').mockResolvedValue(classesData as never)
  })

  it('页面标题为「备课中心」', async () => {
    const { wrapper } = await mountView('/lesson-plans')
    expect(wrapper.text()).toContain('备课中心')
  })

  it('有 classId 时显示「← 返回 小一班」，点击 → /classes/:id/students', async () => {
    const { wrapper, router } = await mountView('/lesson-plans?classId=1')
    await flushPromises()
    const backBtn = [...wrapper.findAll('button')].find((b) => b.text().includes('返回 小一班'))
    expect(backBtn).toBeTruthy()
    await backBtn!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('students')
    expect(router.currentRoute.value.params.classId).toBe('1')
  })

  it('有 classId 时副标题提示「正在为：小一班 准备课堂」', async () => {
    const { wrapper } = await mountView('/lesson-plans?classId=1')
    await flushPromises()
    expect(wrapper.text()).toContain('正在为：小一班 准备课堂')
  })

  it('无 classId 时不显示任何「返回班级/返回助教」模糊按钮', async () => {
    const { wrapper } = await mountView('/lesson-plans')
    const text = wrapper.text()
    expect(text).not.toContain('返回班级')
    expect(text).not.toContain('返回助教')
    expect(text).not.toContain('返回主页面')
  })
})