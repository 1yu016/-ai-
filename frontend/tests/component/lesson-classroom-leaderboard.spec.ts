import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { platformApi } from '@/api/platform'
import * as checkpointService from '@/services/classroomCheckpoint'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// Stage：课堂奖励同步班级 Top5 排行榜 —— LessonClassroomView 集成行为。
// 排行数据唯一来源是 platformApi.rewardLeaderboard（后端聚合），禁止用分页流水自算。

const duoDuo = {
  id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null,
  status: 'active', createdAt: '', updatedAt: '',
}
const runPayload = {
  id: 9, lessonPlanId: 3, classId: 1, deviceId: 1, version: 2,
  status: 'running', currentStepIndex: 0, title: '春天课堂',
  steps: [{ stepIndex: 0, title: '看一看', type: 'question', content: '你发现了什么？', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5, startedAt: '2026-10-02T07:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
}

async function settle() {
  await flushPromises()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · 班级 Top5 排行榜同步', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // 宽屏：展开互动面板与榜单，便于读取/点击。
    Object.defineProperty(window, 'innerWidth', {
      configurable: true, writable: true, value: 1440,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountView() {
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) return { data: { items: [], total: 0 } } as never
        return { data: runPayload } as never
      }
      if (/\/students/.test(u)) return { data: { items: [duoDuo], total: 1 } } as never
      return { data: {} } as never
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView, meta: { requiresAuth: true } },
      ],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    return mount(LessonClassroomView, {
      global: {
        plugins: [router, ElementPlus, createPinia()],
        stubs: { ResourcePlayer: true, DigitalHumanStage: true, ClassroomAvatar: true, teleport: true },
      },
      attachTo: document.body,
    })
  }

  /** 通过右侧互动 launcher → 全屏操作台：选中朵朵并发放一次奖励，随后返回普通态。 */
  async function rewardDuoDuo() {
    await wrapperCtx!.find('[data-test="open-interaction"]').trigger('click')
    await settle()
    await wrapperCtx!.find('[data-test="student-chip"]').trigger('click')
    await wrapperCtx!.find('[data-test="reward-cta"]').trigger('click')
    await settle()
    await wrapperCtx!.find('[data-test="fs-close"]').trigger('click')
    await settle()
  }
  let wrapperCtx: ReturnType<typeof mount> | null = null

  it('#5 课堂加载时请求当前 classId 的 leaderboard（GET leaderboard）', async () => {
    const lb = vi.spyOn(platformApi, 'rewardLeaderboard').mockResolvedValue({
      data: { classId: 1, className: '小一班', items: [] },
    } as never)
    const wrapper = await mountView()
    wrapperCtx = wrapper
    await settle()
    expect(lb).toHaveBeenCalledWith(1, 5)
    wrapper.unmount()
  })

  it('#6 奖励成功后重新请求 leaderboard；#12 不使用分页流水自算', async () => {
    const lb = vi.spyOn(platformApi, 'rewardLeaderboard').mockResolvedValue({
      data: { classId: 1, className: '小一班', items: [] },
    } as never)
    vi.spyOn(checkpointService, 'postReward').mockResolvedValue({
      record: {
        id: 100, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9,
        teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1,
        reason: '积极回答', requestId: 'reward-x', createdAt: '2026-10-02T08:00:00.000Z',
      }, rewardState: {}, studentTotal: 1,
    } as never)
    const classRewardsSpy = vi.spyOn(platformApi, 'classRewards')
    const wrapper = await mountView()
    wrapperCtx = wrapper
    await settle()
    const callsAfterLoad = lb.mock.calls.length
    expect(callsAfterLoad).toBeGreaterThanOrEqual(1)
    expect(wrapper.find('.l-stars').text()).toContain('本节 0')

    await rewardDuoDuo()

    // 奖励成功：本节计数 +1，且 leaderboard 重新拉取。
    expect(wrapper.find('.l-stars').text()).toContain('本节 1')
    expect(lb.mock.calls.length).toBeGreaterThan(callsAfterLoad)
    // 禁止用分页流水（classRewards）自行聚合排行。
    expect(classRewardsSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('#7 奖励失败：不刷新 leaderboard，也不 +1', async () => {
    const lb = vi.spyOn(platformApi, 'rewardLeaderboard').mockResolvedValue({
      data: { classId: 1, className: '小一班', items: [] },
    } as never)
    vi.spyOn(checkpointService, 'postReward').mockRejectedValue(new Error('奖励失败，请重试。'))
    const wrapper = await mountView()
    wrapperCtx = wrapper
    await settle()
    const callsAfterLoad = lb.mock.calls.length
    expect(wrapper.find('.l-stars').text()).toContain('本节 0')

    await rewardDuoDuo()

    expect(wrapper.find('.l-stars').text()).toContain('本节 0')
    expect(lb.mock.calls.length).toBe(callsAfterLoad)
    wrapper.unmount()
  })

  it('#8 排行榜刷新失败：奖励仍然成功（本节 +1，榜单 error 进全屏不可用态，不回滚奖励）', async () => {
    const lb = vi.spyOn(platformApi, 'rewardLeaderboard').mockRejectedValue(new Error('网络错误'))
    vi.spyOn(checkpointService, 'postReward').mockResolvedValue({
      record: {
        id: 101, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9,
        teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1,
        reason: '积极回答', requestId: 'reward-y', createdAt: '2026-10-02T08:00:00.000Z',
      }, rewardState: {}, studentTotal: 1,
    } as never)
    const wrapper = await mountView()
    wrapperCtx = wrapper
    await settle()
    // 奖励本身成功：本节 +1。
    await rewardDuoDuo()
    expect(wrapper.find('.l-stars').text()).toContain('本节 1')
    expect(lb.mock.calls.length).toBeGreaterThan(0)
    // 榜单失败 → 全屏「班级累计成长榜」Tab 显示不可用态，不伪造空榜。
    await wrapper.find('[data-test="open-leaderboard"]').trigger('click')
    await settle()
    await wrapper.find('[data-test="lb-tab-class"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="lb-class-unavailable"]').text()).toContain('班级累计成长榜暂不可用')
    wrapper.unmount()
  })
})