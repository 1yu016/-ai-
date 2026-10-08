import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { platformApi } from '@/api/platform'
import * as checkpoint from '@/services/classroomCheckpoint'
import ClassroomRunSummaryView from '@/views/ClassroomRunSummaryView.vue'

const runPayload = {
  id: 9, lessonPlanId: 3, classId: 1, deviceId: 1, version: 2,
  status: 'completed', currentStepIndex: 0, title: '春天课堂',
  steps: [], startedAt: '2026-10-02T07:00:00.000Z',
  endedAt: '2026-10-02T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
  elapsedSeconds: 3600,
}

function rec(over: Partial<checkpoint.RewardRecord>) {
  return {
    id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9,
    teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1,
    reason: '积极回答', requestId: 'reward-x', createdAt: '2026-10-02T07:10:00.000Z',
    ...over,
  }
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classroom/lesson/:runId/summary', name: 'lesson-classroom-summary', component: ClassroomRunSummaryView, meta: { requiresAuth: true } },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>班级学生页</div>' } },
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: { template: '<div>成长榜</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
    ],
  })
  router.push('/classroom/lesson/9/summary')
  await router.isReady()
  const wrapper = mount(ClassroomRunSummaryView, { global: { plugins: [router, ElementPlus, createPinia()] } })
  return { wrapper, router }
}

describe('ClassroomRunSummaryView · 课堂总结页', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('#3/#5/#8 展示 Top5：朵朵 3 星、阳阳 2 星、糖糖 1 星（不足 5 也正常）', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({
      items: [
        rec({ id: 1, studentId: 1, studentName: '朵朵', stars: 1, reason: '积极回答' }),
        rec({ id: 2, studentId: 2, studentName: '阳阳', stars: 2, reason: '乐于分享' }),
        rec({ id: 3, studentId: 1, studentName: '朵朵', stars: 2, reason: '认真观察' }),
      ],
      total: 3,
      runTitle: '春天课堂',
    } as never)
    const { wrapper } = await mountView()
    await flushPromises()
    await flushPromises()
    const names = wrapper.findAll('.lb-item .lb-name').map((n) => n.text())
    expect(names).toEqual(['朵朵', '阳阳'])
    expect(wrapper.find('.lb-item:nth-child(1) .lb-stars').text()).toContain('3')
    expect(wrapper.find('.lb-item:nth-child(2) .lb-stars').text()).toContain('2')
    expect(names).toHaveLength(2)
    // 奖励明细来自正式 RewardRecord。
    expect(wrapper.text()).toContain('积极回答')
    wrapper.unmount()
  })

  it('#7 无奖励空态：不显示 0 分榜，显示“本节课暂无奖励记录”', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '' } as never)
    const { wrapper } = await mountView()
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-test="lb-empty"]').text()).toContain('本节课暂无奖励记录')
    expect(wrapper.find('[data-test="lb-list"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('#13 不读 localStorage / sessionStorage', async () => {
    const ls = vi.spyOn(Storage.prototype, 'getItem')
    vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '' } as never)
    const { wrapper } = await mountView()
    await flushPromises()
    await flushPromises()
    // 页面数据来自 backend，不读存储。
    expect(ls).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('#14 不把班级累计榜当本节榜：不调用 classRewards', async () => {
    const classRewards = vi.spyOn(platformApi, 'classRewards')
    vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '' } as never)
    const { wrapper } = await mountView()
    await flushPromises()
    await flushPromises()
    expect(classRewards).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('#12 需要重新请求 API：页面渲染后发起 GET run + get rewards', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    const listRewards = vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '' } as never)
    const { wrapper } = await mountView()
    await flushPromises()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/classroom-runs/9')
    expect(listRewards).toHaveBeenCalledWith(9)
    wrapper.unmount()
  })

  it('离开出口「结束并返回」→ 当前班级 students（不再回 /my-classes）', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: runPayload } as never)
    vi.spyOn(checkpoint, 'listRunRewards').mockResolvedValue({ items: [], total: 0, runTitle: '' } as never)
    const { wrapper, router } = await mountView()
    await flushPromises()
    const leave = wrapper.find('[data-test="leave-class"]')
    expect(leave.exists()).toBe(true)
    expect(leave.text()).toContain('结束并返回班级')
    await leave.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('students')
    expect(router.currentRoute.value.params.classId).toBe('1')
  })
})