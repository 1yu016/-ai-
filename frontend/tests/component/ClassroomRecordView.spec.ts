import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as records from '@/services/classroomRecords'
import ClassroomRecordView from '@/views/ClassroomRecordView.vue'

const draft = {
  id: 1,
  classroomRunId: 9,
  source: 'safe_rules' as const,
  status: 'pending' as const,
  classroomSummary: '课堂完成了星星观察。',
  participation: '幼儿参与了观察和提问。',
  interestPoints: ['星星'],
  commonQuestions: ['星星为什么会发光？'],
  teachingStrategies: ['继续安排观察活动。'],
  createdAt: '2026-10-07T02:00:00.000Z',
  updatedAt: '2026-10-07T02:00:00.000Z',
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classroom/records/:runId', component: ClassroomRecordView },
      { path: '/lesson-plans', component: { template: '<div>备课中心</div>' } },
    ],
  })
  await router.push('/classroom/records/9')
  await router.isReady()
  return mount(ClassroomRecordView, {
    global: { plugins: [createPinia(), router, ElementPlus] },
  })
}

describe('ClassroomRecordView 正式课堂记录', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(records, 'getClassroomTimeline').mockResolvedValue({
      run: {
        id: 9,
        title: '星星探索课',
        status: 'completed',
        startedAt: '2026-10-07T01:00:00.000Z',
        endedAt: '2026-10-07T02:00:00.000Z',
      },
      items: [
        {
          key: 'event:1',
          type: 'class_start',
          title: '课堂开始',
          description: '开始课堂',
          occurredAt: '2026-10-07T01:00:00.000Z',
          source: 'classroom_event',
        },
        {
          key: 'question:1',
          type: 'question',
          title: '幼儿提问',
          description: '星星为什么会发光？',
          occurredAt: '2026-10-07T01:30:00.000Z',
          source: 'question',
        },
      ],
    })
  })

  it('结束课堂无草稿时生成草稿并展示服务端时间线', async () => {
    vi.spyOn(records, 'getClassroomSummary').mockResolvedValue({
      draft: null,
      formalSummary: null,
    })
    const draftSpy = vi
      .spyOn(records, 'ensureClassroomSummaryDraft')
      .mockResolvedValue({ ...draft })
    const wrapper = await mountView()
    await flushPromises()

    expect(draftSpy).toHaveBeenCalledWith(9)
    expect(wrapper.text()).toContain('星星探索课')
    expect(wrapper.text()).toContain('AI总结草稿')
    expect(wrapper.text()).toContain('课堂开始')
    expect(wrapper.text()).toContain('星星为什么会发光？')
    expect(wrapper.text()).toContain('确认成为正式总结')
  })

  it('教师编辑并确认后才产生正式总结', async () => {
    vi.spyOn(records, 'getClassroomSummary').mockResolvedValue({
      draft: { ...draft },
      formalSummary: null,
    })
    vi.spyOn(records, 'ensureClassroomSummaryDraft').mockResolvedValue({ ...draft })
    const confirmSpy = vi
      .spyOn(records, 'confirmClassroomSummary')
      .mockImplementation(async (_runId, content) => ({
        id: 2,
        classroomRunId: 9,
        draftId: 1,
        ...content,
        confirmedAt: '2026-10-07T02:01:00.000Z',
        updatedAt: '2026-10-07T02:01:00.000Z',
      }))
    const wrapper = await mountView()
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    await textareas[0]!.setValue('教师编辑后的课堂摘要。')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('确认成为正式总结'))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ classroomSummary: '教师编辑后的课堂摘要。' }),
    )
    expect(wrapper.text()).toContain('教师正式总结')
    expect(wrapper.text()).toContain('已确认')
  })
})
