import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as artworkService from '@/services/studentArtwork'
import ArtworkReviewPanel from '@/components/classroom/operations/ArtworkReviewPanel.vue'

const students = [
  { id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: '朵朵', status: 'active', createdAt: '', updatedAt: '' },
]
const artwork = {
  id: 10, studentId: 1, classId: 1, classroomRunId: 9, lessonStepIndex: 0,
  teacherId: 1, teacherName: '王雪梅', fileUrl: '/files/x.png', mimeType: 'image/png',
  originalName: 'a.png', aiDraft: null, teacherComment: null, confirmedAt: null, createdAt: '2026-10-02T15:00:00.000Z',
}

function fileOf(name = 'a.png', type = 'image/png', size = 100): File {
  return new File([new ArrayBuffer(size)], name, { type })
}

describe('ArtworkReviewPanel 绘画作品评价', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('后端未就绪 → 明确 blocking 状态，不使用硬编码评价', async () => {
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('后端未就绪')
    expect(wrapper.text()).toContain('FRONTEND_READY_BACKEND_BLOCKED')
  })

  it('后端就绪时默认进入选图阶段', async () => {
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    expect(wrapper.find('.upload-box').exists()).toBe(true)
  })

  it('非图片文件被拒绝并不产生上传', async () => {
    vi.spyOn(artworkService, 'uploadStudentArtwork')
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [fileOf('x.txt', 'text/plain')] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.find('.bad').text()).toContain('仅支持 JPG / PNG')
  })

  it('上传成功后才进入 AI 草稿阶段', async () => {
    vi.spyOn(artworkService, 'uploadStudentArtwork').mockResolvedValue(artwork as never)
    vi.spyOn(artworkService, 'generateArtworkAiDraft').mockResolvedValue({ aiDraft: '草稿' } as never)
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [fileOf()] })
    await input.trigger('change')
    await wrapper.find('button.button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.draft').exists()).toBe(true)
  })

  it('AI 失败时不伪造文案，仍停留在教师确认可手动填写', async () => {
    vi.spyOn(artworkService, 'uploadStudentArtwork').mockResolvedValue(artwork as never)
    vi.spyOn(artworkService, 'generateArtworkAiDraft').mockRejectedValue(new Error('NO_VISION'))
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [fileOf()] })
    await input.trigger('change')
    await wrapper.find('button.button').trigger('click')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it('teacher confirm 成功后才显示已确认', async () => {
    vi.spyOn(artworkService, 'uploadStudentArtwork').mockResolvedValue(artwork as never)
    vi.spyOn(artworkService, 'generateArtworkAiDraft').mockRejectedValue(new Error('NO_VISION'))
    vi.spyOn(artworkService, 'confirmArtworkReview').mockResolvedValue({ teacherComment: '观察细致', confirmedAt: '2026-10-02T15:10:00.000Z' } as never)
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [fileOf()] })
    await input.trigger('change')
    await wrapper.find('button.button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('观察细致')
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === '确认并保存')!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.confirmed').exists()).toBe(true)
    expect(wrapper.text()).toContain('观察细致')
  })

  it('confirm 失败保持待确认且不显示成功', async () => {
    vi.spyOn(artworkService, 'uploadStudentArtwork').mockResolvedValue(artwork as never)
    vi.spyOn(artworkService, 'generateArtworkAiDraft').mockRejectedValue(new Error('NO_VISION'))
    vi.spyOn(artworkService, 'confirmArtworkReview').mockRejectedValue(new Error('save fail'))
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [fileOf()] })
    await input.trigger('change')
    await wrapper.find('button.button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('观察细致')
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === '确认并保存')!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.confirmed').exists()).toBe(false)
    expect(wrapper.find('.draft').exists()).toBe(true)
  })

  it('不出现评分/排行榜/诊断文字', async () => {
    const wrapper = mount(ArtworkReviewPanel, {
      props: { runId: 9, lessonStepIndex: 0, students, backendReady: true },
      global: { plugins: [ElementPlus, createPinia()] },
    })
    await flushPromises()
    const text = wrapper.text()
    for (const banned of ['A+', '优秀', '良好', '排名', '能力诊断', '心理诊断']) {
      expect(text).not.toContain(banned)
    }
  })
})