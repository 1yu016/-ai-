import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as questionsService from '@/services/classroomQuestions'
import QuestionRecordPanel from '@/components/classroom/operations/QuestionRecordPanel.vue'

const students = [
  { id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: '朵朵', status: 'active', createdAt: '', updatedAt: '' },
]

describe('QuestionRecordPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('后端就绪且列表为空时展示空态', async () => {
    vi.spyOn(questionsService, 'listRunQuestions').mockResolvedValue([])
    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('还没有正式问题记录')
  })

  it('正式接口失败时展示错误，不回落到本地假数据', async () => {
    vi.spyOn(questionsService, 'listRunQuestions').mockRejectedValue(
      new Error('网络错误'),
    )
    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('网络错误')
    expect(wrapper.findAll('.question-list article')).toHaveLength(0)
  })

  it('拉取失败展示 error 与重试（非 backend-not-ready）', async () => {
    vi.spyOn(questionsService, 'listRunQuestions').mockRejectedValue(
      new Error('网络错误'),
    )
    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    expect(wrapper.find('.bad').exists()).toBe(true)
    expect(wrapper.text()).toContain('网络错误')
    expect(wrapper.text()).toContain('重试')
  })

  it('记录问题：后端成功后写入正式列表并清空输入', async () => {
    const created = {
      id: 1, studentId: 1, studentName: '朵朵', classId: 1, classroomRunId: 9,
      lessonStepIndex: 0, questionText: '为什么天空是蓝色的？', topic: '科学探索',
      asrRawText: '为什么天空是蓝色的？', teacherCorrectedText: null,
      domain: '科学', isAnonymous: false, lessonTitle: '天空课',
      teacherId: 1, teacherName: '王雪梅', createdAt: '2026-10-02T15:00:00.000Z', updatedAt: '2026-10-02T15:00:00.000Z',
    }
    vi.spyOn(questionsService, 'listRunQuestions').mockResolvedValue([])
    const createSpy = vi
      .spyOn(questionsService, 'createClassroomQuestion')
      .mockResolvedValue(created)

    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()

    await wrapper.find('input').setValue('为什么天空是蓝色的？')
    await wrapper.find('.question-form select').setValue(1)
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(createSpy).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        studentId: 1,
        lessonStepIndex: 0,
        questionText: '为什么天空是蓝色的？',
        topic: '生活观察',
      }),
    )
    expect(wrapper.text()).toContain('为什么天空是蓝色的？')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
  })

  it('保存失败：不加入列表、不假装成功、展示错误', async () => {
    vi.spyOn(questionsService, 'listRunQuestions').mockResolvedValue([])
    vi.spyOn(questionsService, 'createClassroomQuestion').mockRejectedValue(
      new Error('保存失败'),
    )
    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()

    await wrapper.find('input').setValue('为什么？')
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('保存失败')
    // 不进入正式列表
    expect(wrapper.findAll('.question-list article')).toHaveLength(0)
  })

  it('空问题输入不提交', async () => {
    const createSpy = vi.spyOn(questionsService, 'createClassroomQuestion')
    vi.spyOn(questionsService, 'listRunQuestions').mockResolvedValue([])
    const wrapper = mount(QuestionRecordPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(createSpy).not.toHaveBeenCalled()
  })
})
