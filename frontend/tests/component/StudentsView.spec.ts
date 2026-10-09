import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import StudentsView from '@/views/StudentsView.vue'

const studentsData = {
  data: {
    items: [
      { id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: '朵朵宝', status: 'active', createdAt: '', updatedAt: '' },
      { id: 2, classId: 1, studentNo: 'XB-002', name: '糖糖', nickname: null, status: 'inactive', createdAt: '', updatedAt: '' },
    ],
    total: 2,
    page: 1,
    pageSize: 100,
  },
}
const classesData = {
  data: { items: [{ id: 1, name: '小一班', grade: '小班', ageRange: '3-4', schoolYear: '', status: 'active' }], total: 1, page: 1, pageSize: 50 },
}

async function mountView(routePath = '/classes/1/students') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classes/:classId/students', name: 'students', component: StudentsView, meta: { requiresAuth: true } },
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: { template: '<div>成长奖励</div>' } },
      { path: '/classes/:classId/questions', name: 'class-questions', component: { template: '<div>问题</div>' } },
      { path: '/students/:studentId', name: 'student-profile', component: { template: '<div>资料</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
    ],
  })
  router.push(routePath)
  await router.isReady()
  const wrapper = mount(StudentsView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('StudentsView 学生列表页（ClassWorkspaceLayout + 学生管理）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(platformApi, 'listClasses').mockResolvedValue(classesData as never)
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)
  })

  it('展示班级工作区：班级名 + 人数', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('小一班')
    expect(wrapper.text()).toContain('小班 · 2 名幼儿')
  })

  it('workspace 顶部有「开始上课」与「← 我的班级」', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-test="workspace-start"]').text()).toContain('开始上课')
    expect(wrapper.find('[data-test="workspace-back"]').text()).toContain('我的班级')
  })

  it('点击「← 我的班级」→ /my-classes', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-test="workspace-back"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('my-classes')
  })

  it('「开始上课」带 classId → /lesson-plans?classId=1', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-test="workspace-start"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('lesson-plans')
    expect(router.currentRoute.value.query.classId).toBe('1')
  })

  it('workspace tabs 含学生/成长奖励/儿童问题', async () => {
    const { wrapper } = await mountView()
    const tabs = wrapper.findAll('.ws-tab').map((t) => t.text())
    expect(tabs.join(' ')).toContain('学生')
    expect(tabs.join(' ')).toContain('成长奖励')
    expect(tabs.join(' ')).toContain('儿童问题')
  })

  it('点击「成长奖励」tab → /classes/1/rewards', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-test="ws-tab-classroom-rewards"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('class-rewards')
  })

  it('点击「儿童问题」tab → /classes/1/questions', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-test="ws-tab-classroom-questions"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('class-questions')
  })

  it('「查看资料」统一文案，点击进入 student-profile', async () => {
    const { wrapper, router } = await mountView()
    const profileBtns = wrapper.findAll('.btn-text').filter((b) => b.text() === '查看资料')
    expect(profileBtns.length).toBeGreaterThanOrEqual(2)
    await profileBtns[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('student-profile')
  })

  it('状态中文化：active→在读，inactive→已停用', async () => {
    const { wrapper } = await mountView()
    const text = wrapper.text()
    expect(text).toContain('在读')
    expect(text).toContain('已停用')
    expect(text).not.toContain('>active<')
  })

  it('加载失败 → 显示错误态与「重新加载」，不与空态混淆', async () => {
    vi.spyOn(platformApi, 'students').mockRejectedValue(new Error('N/A'))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('学生加载失败，请重试')
    expect(wrapper.find('.state-state.error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('当前班级还没有学生')
  })

  it('无学生 → 空态卡片 + 添加学生按钮', async () => {
    vi.spyOn(platformApi, 'students').mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 100 } } as never)
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('当前班级还没有学生')
    expect(wrapper.text()).toContain('添加学生')
  })
})