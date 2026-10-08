/// <reference types="node" />
import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { platformApi } from '@/api/platform'
import ManagementLayout from '@/components/ManagementLayout.vue'
import ClassWorkspaceLayout from '@/components/ClassWorkspaceLayout.vue'

// ============ ManagementLayout：全局导航与顶部栏 ============

const userState = {
  isLogin: true,
  isAdmin: false,
  teacherInfo: { name: '王雪梅', id: 1 },
  initialize: vi.fn(),
  logout: vi.fn(),
}
vi.mock('@/stores/user', () => ({
  useUserStore: () => userState,
}))

async function mountManagement(activeRun: unknown = null) {
  vi.spyOn(http, 'get').mockResolvedValue({ data: activeRun } as never)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/chat', name: 'chat', component: { template: '<div>助教</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
      { path: '/resources', name: 'resources', component: { template: '<div>资源库</div>' } },
      { path: '/classroom/scan', name: 'classroom-scan', component: { template: '<div>设备准备</div>' } },
      { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: { template: '<div>课堂</div>' } },
    ],
  })
  router.push('/my-classes')
  await router.isReady()
  const wrapper = mount(ManagementLayout, { global: { plugins: [createPinia(), router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('ManagementLayout 全局导航重构', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    userState.isAdmin = false
    localStorage.clear()
  })

  it('#1 教师 sidebar 只出现：AI助教 / 我的班级 / 备课中心 / 资源库', async () => {
    const { wrapper } = await mountManagement()
    const navText = wrapper.find('aside').text()
    expect(navText).toContain('AI助教')
    expect(navText).toContain('我的班级')
    expect(navText).toContain('备课中心')
    expect(navText).toContain('资源库')
    expect(navText).not.toContain('课堂设备准备')
    expect(navText).not.toContain('考勤与奖励')
    expect(navText).not.toContain('问题与作品')
    expect(navText).not.toContain('教师遥控')
  })

  it('#2/#3/#4/#5 设备准备 / 考勤奖励 / 问题作品 / 教师遥控 都不是全局导航', async () => {
    const { wrapper } = await mountManagement()
    const navText = wrapper.find('aside').text()
    for (const banned of ['课堂设备准备', '设备准备', '考勤与奖励', '问题与作品', '教师遥控']) {
      expect(navText).not.toContain(banned)
    }
  })

  it('品牌显示「幼教教师工作台」', async () => {
    const { wrapper } = await mountManagement()
    expect(wrapper.find('.brand').text()).toContain('幼教教师工作台')
  })

  it('设备准备入口只在右上角用户菜单中', async () => {
    const { wrapper } = await mountManagement()
    await wrapper.find('[data-test="topbar-user"]').trigger('click')
    await flushPromises()
    const menu = wrapper.find('[data-test="settings-menu"]')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('课堂设备')
    expect(wrapper.find('aside').text()).not.toContain('课堂设备')
  })

  it('#14 有 active run 时顶部出现「课堂进行中 · 返回课堂」', async () => {
    const { wrapper, router } = await mountManagement({ id: 7, lessonPlanId: 1, classId: 1, status: 'running' })
    const entry = wrapper.find('[data-test="active-run-entry"]')
    expect(entry.exists()).toBe(true)
    expect(entry.text()).toContain('课堂进行中')
    await entry.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('lesson-classroom')
  })

  it('#15 无 active run 时不显示「返回课堂」', async () => {
    const { wrapper } = await mountManagement(null)
    expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(false)
  })

  it('active run 为已结束(completed)时不显示入口', async () => {
    const { wrapper } = await mountManagement({ id: 7, lessonPlanId: 1, classId: 1, status: 'completed' })
    expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(false)
  })
})

// ============ ClassWorkspaceLayout：班级工作区 ============

const classesData = {
  data: { items: [{ id: 1, name: '小一班', grade: '小班', ageRange: '3-4', schoolYear: '', status: 'active' }], total: 1, page: 1, pageSize: 50 },
}
const studentsData = {
  data: { items: [{ id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null, status: 'active', createdAt: '', updatedAt: '' }], total: 1, page: 1, pageSize: 100 },
}

async function mountWorkspace(initial = '/classes/1/students') {
  vi.spyOn(platformApi, 'listClasses').mockResolvedValue(classesData as never)
  vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>学生内容</div>' } },
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: { template: '<div>奖励内容</div>' } },
      { path: '/classes/:classId/questions', name: 'class-questions', component: { template: '<div>问题内容</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
    ],
  })
  router.push(initial)
  await router.isReady()
  const wrapper = mount(ClassWorkspaceLayout, {
    global: { plugins: [createPinia(), router, ElementPlus] },
    slots: { default: '<p>子页面内容</p>' },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('ClassWorkspaceLayout 班级工作区', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('#6 顶部「← 我的班级」与「开始上课」同时存在', async () => {
    const { wrapper } = await mountWorkspace()
    expect(wrapper.find('[data-test="workspace-back"]').text()).toContain('我的班级')
    expect(wrapper.find('[data-test="workspace-start"]').text()).toContain('开始上课')
  })

  it('#7 workspace tabs：学生 / 成长奖励 / 儿童问题', async () => {
    const { wrapper } = await mountWorkspace()
    const tabs = wrapper.findAll('.ws-tab').map((t) => t.text())
    expect(tabs.join(' ')).toContain('学生')
    expect(tabs.join(' ')).toContain('成长奖励')
    expect(tabs.join(' ')).toContain('儿童问题')
  })

  it('#8 开始上课保留 classId → /lesson-plans?classId=1', async () => {
    const { wrapper, router } = await mountWorkspace()
    await wrapper.find('[data-test="workspace-start"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('lesson-plans')
    expect(router.currentRoute.value.query.classId).toBe('1')
  })

  it('#17 刷新 class child route：从 /classes/1/rewards 进入仍展示班级上下文 tabs', async () => {
    const { wrapper } = await mountWorkspace('/classes/1/rewards')
    expect(wrapper.text()).toContain('小一班')
    expect(wrapper.find('[data-test="ws-tab-classroom-rewards"]').classes()).toContain('active')
    expect(wrapper.text()).toContain('子页面内容')
  })
})

// ============ 课堂生命周期独立性 ============

describe('课堂生命周期不使用 ManagementLayout', () => {
  it('#10 preflight / #11 lesson / #12 summary 源码中不 import ManagementLayout', async () => {
    const root = join(__dirname, '../../src/views')
    for (const file of ['ClassroomPreflightView.vue', 'LessonClassroomView.vue', 'ClassroomRunSummaryView.vue']) {
      const src = readFileSync(join(root, file), 'utf-8')
      expect(src).not.toMatch(/import\s+ManagementLayout/)
    }
  })
})

// ============ 旧课堂运营 routes 兼容 ============

describe('旧课堂运营 routes 兼容行为', () => {
  it('#16 /classroom/engagement|insights|remote 仍保留在路由表', async () => {
    const { default: router } = await import('@/router')
    const names = router.getRoutes().map((r) => r.name)
    expect(names).toContain('classroom-engagement')
    expect(names).toContain('classroom-insights')
    expect(names).toContain('classroom-remote')
  })
})

// ============ 我的班级 → 班级工作区 ============

const myClassesData = {
  data: { items: [{ id: 1, name: '小一班', grade: '小班', ageRange: '3-4', schoolYear: '', status: 'active' }], total: 1, page: 1, pageSize: 50 },
}

describe('MyClassesView 我的班级（教师工作台核心入口）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('#6 班级卡提供「进入班级」与「开始上课」', async () => {
    vi.spyOn(platformApi, 'classes').mockResolvedValue(myClassesData as never)
    vi.spyOn(http, 'get').mockResolvedValue({ data: null } as never)
    const MyClassesView = (await import('@/views/MyClassesView.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/my-classes', name: 'my-classes', component: MyClassesView },
        { path: '/classes/:classId/students', name: 'students', component: { template: '<div>班级</div>' } },
        { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
      ],
    })
    router.push('/my-classes')
    await router.isReady()
    const wrapper = mount(MyClassesView, { global: { plugins: [createPinia(), router, ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('小一班')
    const buttons = wrapper.findAll('button').map((b) => b.text())
    expect(buttons.join(' ')).toContain('进入班级')
    expect(buttons.join(' ')).toContain('开始上课')
    // 进入班级 → 班级 workspace students
    const enter = [...wrapper.findAll('button')].find((b) => b.text() === '进入班级')!
    await enter.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('students')
    expect(router.currentRoute.value.params.classId).toBe('1')
  })

  it('#8 开始上课携带 classId → /lesson-plans?classId=1', async () => {
    vi.spyOn(platformApi, 'classes').mockResolvedValue(myClassesData as never)
    vi.spyOn(http, 'get').mockResolvedValue({ data: null } as never)
    const MyClassesView = (await import('@/views/MyClassesView.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/my-classes', name: 'my-classes', component: MyClassesView },
        { path: '/classes/:classId/students', name: 'students', component: { template: '<div>班级</div>' } },
        { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
      ],
    })
    router.push('/my-classes')
    await router.isReady()
    const wrapper = mount(MyClassesView, { global: { plugins: [createPinia(), router, ElementPlus] } })
    await flushPromises()
    const start = [...wrapper.findAll('button')].find((b) => b.text() === '开始上课')!
    await start.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('lesson-plans')
    expect(router.currentRoute.value.query.classId).toBe('1')
  })
})