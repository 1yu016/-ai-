import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import ClassRewardHistoryView from '@/views/ClassRewardHistoryView.vue'

const pageData = {
  data: {
    items: [
      { id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9, lessonTitle: '认识数字1', runAt: '2026-10-02', teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1, reason: '积极回答', createdAt: '2026-10-02T14:32:00.000Z' },
      { id: 2, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9, lessonTitle: '认识数字1', runAt: '2026-10-02', teacherId: 1, teacherName: '王雪梅', rewardType: 'flower', stars: 1, reason: '认真观察', createdAt: '2026-10-02T14:37:00.000Z' },
    ],
    total: 2,
    page: 1,
    pageSize: 10,
    summary: { classId: 1, className: '小一班', totalStars: 2 },
  },
}
const studentsData = {
  data: { items: [{ id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null, status: 'active', createdAt: '', updatedAt: '' }], total: 1, page: 1, pageSize: 100 },
}
const classesData = {
  data: { items: [{ id: 1, name: '小一班', grade: '小班', ageRange: '3-4', schoolYear: '', status: 'active' }], total: 1, page: 1, pageSize: 50 },
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: ClassRewardHistoryView, meta: { requiresAuth: true } },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>学生</div>' } },
      { path: '/classes/:classId/questions', name: 'class-questions', component: { template: '<div>问题</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
    ],
  })
  router.push('/classes/1/rewards')
  await router.isReady()
  return mount(ClassRewardHistoryView, { global: { plugins: [createPinia(), router, ElementPlus] } })
}

describe('ClassRewardHistoryView 班级成长奖励页', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(platformApi, 'listClasses').mockResolvedValue(classesData as never)
    vi.spyOn(platformApi, 'rewardLeaderboard').mockResolvedValue({ data: { items: [] } } as never)
  })

  it('加载真实接口并展示累计奖励与逐条明细', async () => {
    const rewardsSpy = vi.spyOn(platformApi, 'classRewards').mockResolvedValue(pageData as never)
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)

    const wrapper = await mountView()
    await flushPromises()

    expect(rewardsSpy).toHaveBeenCalledWith(1, { page: 1, pageSize: 10, studentId: undefined })
    expect(wrapper.text()).toContain('小一班')
    expect(wrapper.text()).toContain('成长奖励')
    expect(wrapper.text()).toContain('累计奖励')
    expect(wrapper.text()).toContain('🌟 2')
    expect(wrapper.findAll('.reward-item')).toHaveLength(2)
    expect(wrapper.text()).toContain('认识数字1')
    expect(wrapper.text()).toContain('王雪梅')
    expect(wrapper.text()).toContain('积极回答')
    expect(wrapper.text()).toContain('认真观察')
  })

  it('按幼儿筛选 → 携带 studentId 重新查询', async () => {
    const rewardsSpy = vi.spyOn(platformApi, 'classRewards').mockResolvedValue(pageData as never)
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)

    const wrapper = await mountView()
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('1')
    await flushPromises()

    expect(rewardsSpy).toHaveBeenLastCalledWith(1, { page: 1, pageSize: 10, studentId: 1 })
  })

  it('不出现排行榜/排名文字', async () => {
    vi.spyOn(platformApi, 'classRewards').mockResolvedValue(pageData as never)
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)

    const wrapper = await mountView()
    await flushPromises()

    const text = wrapper.text()
    for (const banned of ['排行榜', '排名', '第一名', '积分榜']) {
      expect(text).not.toContain(banned)
    }
  })
})
