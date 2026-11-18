import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BaseWorkspaceLayout from '@/components/BaseWorkspaceLayout.vue'
import AdminLayout from '@/components/AdminLayout.vue'
import ClassroomMobileRemoteView from '@/views/ClassroomMobileRemoteView.vue'
import { http } from '@/api/http'

const mocks = vi.hoisted(() => ({ user: { isAdmin: false, teacherInfo: { name: '合成教师', userType: 'teacher' } }, revoke: vi.fn(), stop: vi.fn(), start: vi.fn() }))
vi.mock('@/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('@/stores/classroomMobile', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useClassroomMobileStore: defineStore('preview-mobile', () => {
    const session = ref<{token:string} | null>({ token: 'synthetic' })
    return { session, state: ref(null), connection: ref('idle'), canControl: ref(false), lastError: ref(''), lastConfirmedAt: ref(null), commands: ref([]),
      revoke: async () => { await mocks.revoke(); session.value = null }, start: mocks.start, stop: mocks.stop }
  }) }
})
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'teacher-home', component: { template: '<div />' } },
    { path: '/classroom/scan', name: 'classroom-scan', component: { template: '<div />' } },
    { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: { template: '<div />' } },
    { path: '/admin', name: 'admin-dashboard', component: { template: '<div />' } },
    { path: '/admin/devices', name: 'devices', component: { template: '<div />' } },
  ] })
  await router.push('/'); await router.isReady()
  return { plugins: [createPinia(), router], stubs: { WorkspaceBreadcrumbs: true } }
}
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); mocks.user.isAdmin = false; vi.useRealTimers() })
describe('导航状态和手机退出', () => {
  it('管理员没有生成票据菜单，保留设备配置入口', async () => {
    mocks.user.isAdmin = true
    const wrapper = mount(AdminLayout, { global: await setup() }); wrappers.push(wrapper)
    await wrapper.get('[data-test="topbar-user"]').trigger('click')
    expect(wrapper.get('[data-test="settings-menu"]').text()).not.toContain('连接手机')
    expect(wrapper.get('[data-test="settings-menu"]').text()).toContain('设备配置与绑定检查')
    expect(wrapper.find('aside').text()).not.toContain('设备准备')
  })
  it('查询失败报告未知，不当成没有课堂；刷新后恢复', async () => {
    const get = vi.spyOn(http, 'get').mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ data: { id: 7, status: 'running' } } as never)
    const wrapper = mount(BaseWorkspaceLayout, { props: { workspaceName: '测试', roleLabel: '教师', homeRoute: {name:'teacher-home'}, sections: [], showActiveClassroom: true }, global: await setup() }); wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('当前课堂状态未知')
    await wrapper.findAll('button').find(b => b.text() === '刷新课堂状态')!.trigger('click'); await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('查询于')
  })
  it('迟到读取不会覆盖较新课堂，多个Run不默选第一条', async () => {
    let complete!: (value: never) => void
    vi.spyOn(http, 'get').mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValueOnce({ data: [{ id: 8, status: 'running' }, { id: 9, status: 'paused' }] } as never)
    const wrapper = mount(BaseWorkspaceLayout, { props: { workspaceName: '测试', roleLabel: '教师', homeRoute: {name:'teacher-home'}, sections: [], showActiveClassroom: true }, global: await setup() }); wrappers.push(wrapper)
    window.dispatchEvent(new Event('focus')); await flushPromises()
    complete({ data: { id: 7, status: 'running' } } as never); await flushPromises()
    expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(false)
    expect(wrapper.get('select').findAll('option').map(o => o.attributes('value'))).toEqual(['', '8', '9'])
  })
  it('状态到期不继续显示实时继续入口', async () => {
    vi.useFakeTimers()
    vi.spyOn(http, 'get').mockResolvedValue({ data: { id: 7, status: 'running' } } as never)
    const wrapper = mount(BaseWorkspaceLayout, { props: { workspaceName: '测试', roleLabel: '教师', homeRoute: {name:'teacher-home'}, sections: [], showActiveClassroom: true }, global: await setup() }); wrappers.push(wrapper)
    await flushPromises(); expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(wrapper.text()).toContain('课堂状态已过期')
    expect(wrapper.find('[data-test="active-run-entry"]').exists()).toBe(false)
  })
  it('手机退出保留明确本机退出状态及重新授权入口，不跳到聊天', async () => {
    const wrapper = mount(ClassroomMobileRemoteView, { global: await setup() }); wrappers.push(wrapper)
    await wrapper.get('button.leave').trigger('click'); await flushPromises()
    expect(mocks.revoke).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('已退出本机遥控')
    expect(wrapper.text()).toContain('服务端撤销状态需重新核实')
    expect(wrapper.text()).toContain('前往扫码配对')
    expect(wrapper.text()).toContain('返回教师工作台')
    expect(wrapper.find('button.leave').exists()).toBe(false)
  })
})
