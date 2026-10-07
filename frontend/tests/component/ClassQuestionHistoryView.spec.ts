import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import * as questionsService from '@/services/classroomQuestions'
import ClassQuestionHistoryView from '@/views/ClassQuestionHistoryView.vue'

const studentsData = {
  data: { items: [{ id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null, status: 'active', createdAt: '', updatedAt: '' }], total: 1, page: 1, pageSize: 100 },
}
const pageData = {
  items: [
    { id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9, lessonStepIndex: 0, questionText: '为什么天空是蓝色的？', topic: '科学探索', teacherId: 1, teacherName: '王雪梅', createdAt: '2026-10-02T15:00:00.000Z' },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
}
const mapData = {
  classId: 1,
  filters: { topic: null, domain: null, studentId: null },
  summary: { total: 1, anonymousCount: 0, identifiedStudentCount: 1 },
  topics: [{ name: '科学探索', count: 1 }],
  domains: [{ name: '科学', count: 1 }],
  frequentQuestions: [{ question: '为什么天空是蓝色的', count: 1 }],
  interestHotspots: ['科学探索', '科学'],
  suggestionSource: 'safe_rules',
  studentClusters: [{ studentId: 1, studentName: '朵朵', questionCount: 1, topics: [{ name: '科学探索', count: 1 }], domains: [{ name: '科学', count: 1 }] }],
  teachingSuggestions: ['先观察天空颜色。'],
  activitySuggestions: ['颜色观察活动'],
  recommendedResources: [],
  safety: { individualRankingGenerated: false, negativeLabelsGenerated: false, note: '不排名、不贴标签。' },
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classes/:classId/questions', name: 'class-questions', component: ClassQuestionHistoryView, meta: { requiresAuth: true } },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>学生</div>' } },
    ],
  })
  router.push('/classes/1/questions')
  await router.isReady()
  return mount(ClassQuestionHistoryView, { global: { plugins: [createPinia(), router, ElementPlus] } })
}

describe('ClassQuestionHistoryView 班级问题记录页', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)
    vi.spyOn(questionsService, 'getQuestionMap').mockResolvedValue(mapData as never)
  })

  it('加载真实接口并展示问题列表', async () => {
    const listSpy = vi.spyOn(questionsService, 'listClassQuestions').mockResolvedValue(pageData as never)
    const wrapper = await mountView()
    await flushPromises()
    // 注意实际调用会传 params 到 GET；这里验证 service 被调用并渲染结果
    expect(listSpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('班级问题记录')
    expect(wrapper.text()).toContain('为什么天空是蓝色的？')
    expect(wrapper.text()).toContain('朵朵')
    expect(wrapper.text()).toContain('问题地图')
  })

  it('按幼儿筛选 → 重新调用并携带 studentId', async () => {
    const listSpy = vi.spyOn(questionsService, 'listClassQuestions').mockResolvedValue(pageData as never)
    const wrapper = await mountView()
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('1')
    await flushPromises()

    expect(listSpy).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ page: 1, pageSize: 10, studentId: 1 }),
    )
  })

  it('关键词搜索 → 携带 keyword', async () => {
    const listSpy = vi.spyOn(questionsService, 'listClassQuestions').mockResolvedValue(pageData as never)
    const wrapper = await mountView()
    await flushPromises()

    const input = wrapper.find('input')
    await input.setValue('天空')
    const toolbar = wrapper.find('.toolbar')
    await toolbar.findAll('button')[0]!.trigger('click')
    await flushPromises()

    expect(listSpy).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ page: 1, pageSize: 10, keyword: '天空' }),
    )
  })

  it('正式接口失败时展示错误，不伪装为空列表', async () => {
    vi.spyOn(questionsService, 'listClassQuestions').mockRejectedValue(new Error('N/A'))
    const wrapper = await mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('N/A')
    expect(wrapper.text()).not.toContain('还没有正式问题记录')
  })
})
