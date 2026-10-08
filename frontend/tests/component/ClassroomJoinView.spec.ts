import ElementPlus from 'element-plus'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { classroomMobileApi } from '@/api/classroomMobile'
import ClassroomJoinView from '@/views/ClassroomJoinView.vue'

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classroom/join', component: ClassroomJoinView },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>教案列表</div>' } },
      { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: { template: '<div>课堂</div>' } },
      { path: '/classroom/remote', name: 'classroom-remote', component: { template: '<div>手机遥控</div>' } },
      { path: '/classroom/scan', component: { template: '<div>扫码页</div>' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ClassroomJoinView, { global: { plugins: [createPinia(), router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('ClassroomJoinView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('consumes a one-time ticket and carries binding context into lesson preparation', async () => {
    vi.spyOn(classroomMobileApi, 'join').mockResolvedValue({
      data: {
        classId: 3,
        classroomId: 4,
        deviceId: 5,
        lessonRunId: null,
        deviceCode: 'SCREEN-001',
        controlSession: null,
      },
    } as Awaited<ReturnType<typeof classroomMobileApi.join>>)
    const { wrapper, router } = await mountAt('/classroom/join?ticket=once&deviceCode=SCREEN-001')

    expect(classroomMobileApi.join).toHaveBeenCalledWith({
      ticket: 'once',
      deviceCode: 'SCREEN-001',
    })
    expect(wrapper.text()).toContain('大屏配对成功')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('lesson-plans')
    expect(router.currentRoute.value.query).toMatchObject({
      classId: '3',
      classroomId: '4',
      deviceId: '5',
      paired: '1',
    })
  })

  it('stores the scoped control session and opens the mobile remote for a live classroom', async () => {
    vi.spyOn(classroomMobileApi, 'join').mockResolvedValue({
      data: {
        classId: 3,
        classroomId: 4,
        deviceId: 5,
        lessonRunId: 9,
        deviceCode: 'SCREEN-001',
        controlSession: {
          id: 'session-1',
          token: 'control-secret',
          classroomRunId: 9,
          targetDeviceId: 5,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
    } as Awaited<ReturnType<typeof classroomMobileApi.join>>)
    const { router } = await mountAt('/classroom/join?ticket=once&deviceCode=SCREEN-001')
    expect(router.currentRoute.value.name).toBe('classroom-remote')
    expect(sessionStorage.getItem('kindergarten-classroom-control-session-v1')).toContain('control-secret')
  })

  it('shows a refresh hint for an invalid or reused ticket', async () => {
    vi.spyOn(classroomMobileApi, 'join').mockRejectedValue({
      response: { data: { message: '课堂凭证无效或已过期' } },
    })
    const { wrapper } = await mountAt('/classroom/join?ticket=reused&deviceCode=SCREEN-001')
    expect(wrapper.text()).toContain('二维码可能已过期或已使用')
    expect(wrapper.text()).toContain('扫码配对未完成')
  })
})
