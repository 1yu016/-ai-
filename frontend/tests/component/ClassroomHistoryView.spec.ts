import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import ClassroomHistoryView from '@/views/ClassroomHistoryView.vue'

describe('课堂记录入口', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('直接访问后恢复班级和页码，查看详情携带原始返回地址', async () => {
    vi.spyOn(platformApi, 'classes').mockResolvedValue({ data: { items: [{ id: 7, name: '中一班' }], total: 1 } } as never)
    const list = vi.spyOn(platformApi, 'classRuns').mockResolvedValue({ data: { items: [{ id: 19, title: '认识数字1', status: 'completed', startedAt: null }], total: 21 } } as never)
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/classroom/history', name: 'classroom-history', component: ClassroomHistoryView },
      { path: '/classroom/records/:runId', name: 'classroom-record', component: { template: '<div />' } },
    ] })
    await router.push('/classroom/history?classId=7&page=2')
    const wrapper = mount(ClassroomHistoryView, { global: { plugins: [router], stubs: { ManagementLayout: { template: '<div><slot /></div>' }, PageHeader: true } } })
    await flushPromises()
    expect(list).toHaveBeenCalledWith(7, { page: 2, pageSize: 20 })
    expect(wrapper.text()).toContain('认识数字1')
    const button = wrapper.findAll('button').find((item) => item.text() === '查看记录')!
    await button.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params.runId).toBe('19')
    expect(router.currentRoute.value.query.from).toBe('/classroom/history?classId=7&page=2')
    wrapper.unmount()
  })
})
