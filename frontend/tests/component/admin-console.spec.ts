import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import AdminDashboardView from '@/views/AdminDashboardView.vue'
import AdminAuditView from '@/views/AdminAuditView.vue'

const managementStub = { template: '<div><slot /></div>' }

describe('管理员后台', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('只展示聚合看板数据，不渲染幼儿个人信息', async () => {
    vi.spyOn(platformApi, 'adminDashboard').mockResolvedValue({
      data: {
        generatedAt: '2026-10-07T04:00:00.000Z',
        teachers: 8,
        classes: 3,
        students: 62,
        devices: { total: 4, online: 3, offline: 1 },
        classrooms: { today: 2, active: 1, abnormal: 0 },
        resources: { pending: 5, disabled: 1 },
        ai: {
          total: 100,
          success: 95,
          errors: 5,
          successRate: 95,
          errorRate: 5,
          averageLatencyMs: 820,
        },
        storage: { indexedResourceBytes: 2048, physicalBytes: 4096 },
      },
    } as never)
    const wrapper = mount(AdminDashboardView, {
      global: { stubs: { ManagementLayout: managementStub } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('数据看板')
    expect(wrapper.text()).toContain('在线设备')
    expect(wrapper.text()).toContain('95%')
    expect(wrapper.text()).toContain('2.0 KB')
    expect(wrapper.text()).not.toContain('幼儿姓名')
  })

  it('展示只读脱敏审计日志，并可切换AI调用日志', async () => {
    vi.spyOn(platformApi, 'auditLogs').mockResolvedValue({
      data: {
        items: [
          {
            id: 1,
            actorType: 'administrator',
            actorId: 3,
            action: 'resource.review',
            targetType: 'resource',
            targetId: '8',
            result: 'success',
            ipAddress: '192.168.*.*',
            metadata: { phone: '***' },
            createdAt: '2026-10-07T04:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
      },
    } as never)
    const aiSpy = vi.spyOn(platformApi, 'aiCallLogs').mockResolvedValue({
      data: {
        items: [
          {
            id: 2,
            actorType: 'teacher',
            actorId: 1,
            feature: 'classroom_director',
            provider: 'ark',
            model: 'safe-model',
            requestId: 'request-1',
            status: 'success',
            latencyMs: 900,
            errorCode: null,
            createdAt: '2026-10-07T04:01:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    } as never)
    const wrapper = mount(AdminAuditView, {
      global: { stubs: { ManagementLayout: managementStub } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('resource.review')
    expect(wrapper.text()).toContain('192.168.*.*')
    expect(wrapper.text()).toContain('***')
    const aiButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('AI调用'))
    await aiButton!.trigger('click')
    await flushPromises()
    expect(aiSpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('classroom_director')
    expect(wrapper.text()).toContain('900 ms')
  })
})
