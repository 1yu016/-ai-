import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import { http } from '@/api/http'
import { useUserStore } from '@/stores/user'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'root', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/admin', name: 'admin-dashboard', component: { template: '<div />' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div />' } },
      { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: { template: '<div />' } },
    ],
  })
}

describe('后台工作台基础架构', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('按登录身份选择管理员或教师布局，并在顶部展示用户与角色', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/')
    await router.isReady()

    const user = useUserStore(pinia)
    user.setLogin('token', { account: 'admin', name: '园长老师', role: 'admin', userType: 'administrator' })
    const admin = mount(ManagementLayout, { slots: { default: '<div>页面内容</div>' }, global: { plugins: [pinia, router] } })
    expect(admin.text()).toContain('幼教管理员控制台')
    expect(admin.find('[data-test="topbar-user"]').text()).toContain('园长老师')
    expect(admin.find('[data-test="topbar-user"]').text()).toContain('管理员')
    admin.unmount()

    vi.spyOn(http, 'get').mockResolvedValue({ data: null } as never)
    user.setLogin('token', { account: 'teacher', name: '小花老师', role: 'teacher', userType: 'teacher' })
    const teacher = mount(ManagementLayout, { global: { plugins: [pinia, router] } })
    await flushPromises()
    expect(teacher.text()).toContain('幼教教师工作台')
    expect(teacher.find('[data-test="topbar-user"]').text()).toContain('小花老师')
    expect(teacher.find('[data-test="topbar-user"]').text()).toContain('教师')
  })

  it('PageShell 支持双栏页面并保持主内容与侧栏分离', () => {
    const wrapper = mount(PageShell, {
      props: { variant: 'split' },
      slots: { aside: '<div data-test="aside">筛选</div>', default: '<div data-test="main">列表</div>' },
    })
    expect(wrapper.find('.page-shell--split').exists()).toBe(true)
    expect(wrapper.find('[data-test="aside"]').text()).toBe('筛选')
    expect(wrapper.find('[data-test="main"]').text()).toBe('列表')
  })

  it('空状态在无操作权限时不显示误导按钮', () => {
    const wrapper = mount(EmptyState, {
      props: { title: '暂未分配班级', description: '请联系管理员绑定班级。', actionLabel: '添加班级', canAct: false },
    })
    expect(wrapper.text()).toContain('请联系管理员绑定班级')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('错误状态提供明确重试入口', async () => {
    const wrapper = mount(ErrorState, { props: { description: '班级加载失败，请稍后重试。' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('统一确认弹窗只在用户确认后发出操作事件', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { modelValue: true, title: '停用班级', message: '确认停用这个班级吗？', danger: true },
      global: { stubs: { Teleport: true } },
    })
    expect(wrapper.get('[role="dialog"]').text()).toContain('确认停用这个班级吗')
    await wrapper.get('button.confirm').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
