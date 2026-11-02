import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import * as artworkService from '@/services/studentArtwork'
import ClassArtworkHistoryView from '@/views/ClassArtworkHistoryView.vue'

const studentsData = {
  data: {
    items: [
      { id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: '朵朵', status: 'active', createdAt: '', updatedAt: '' },
      { id: 2, classId: 1, studentNo: 'XB-002', name: '乐乐', nickname: null, status: 'active', createdAt: '', updatedAt: '' },
    ],
    total: 2,
    page: 1,
    pageSize: 100,
  },
}

function artwork(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    studentId: 1,
    classId: 1,
    classroomRunId: 9,
    lessonStepIndex: 1,
    teacherId: 1,
    teacherName: '统一演示教师',
    fileUrl: '/artworks/10/file',
    mimeType: 'image/png',
    originalName: 'a.png',
    aiDraft: null,
    teacherComment: null,
    confirmedAt: null,
    createdAt: '2026-10-24T09:00:00.000Z',
    ...overrides,
  }
}

const confirmedArtwork = artwork({ id: 11, studentId: 2, aiDraft: '画面里有一棵小树。', teacherComment: '我看到你画的小树和阳光，颜色很温暖。', confirmedAt: '2026-10-24T09:30:00.000Z' })
const pendingArtwork = artwork({ id: 10 })

async function mountView(path = '/classes/1/artworks') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/classes/:classId/artworks', name: 'class-artworks', component: ClassArtworkHistoryView, meta: { requiresAuth: true } },
      { path: '/classes/:classId/students', name: 'students', component: { template: '<div>学生</div>' } },
      { path: '/classes/:classId/rewards', name: 'class-rewards', component: { template: '<div>奖励</div>' } },
      { path: '/classes/:classId/questions', name: 'class-questions', component: { template: '<div>问题</div>' } },
      { path: '/classroom/records/:runId', name: 'classroom-record', component: { template: '<div>课堂记录</div>' } },
      { path: '/my-classes', name: 'my-classes', component: { template: '<div>我的班级</div>' } },
      { path: '/lesson-plans', name: 'lesson-plans', component: { template: '<div>备课中心</div>' } },
    ],
  })
  router.push(path)
  await router.isReady()
  return mount(ClassArtworkHistoryView, { global: { plugins: [createPinia(), router, ElementPlus] } })
}

describe('ClassArtworkHistoryView 班级作品回顾页', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(platformApi, 'students').mockResolvedValue(studentsData as never)
    vi.spyOn(platformApi, 'classDetail').mockResolvedValue({ data: { id: 1, name: '种子探究模拟大班', grade: '大班', schoolYear: '' } } as never)
    vi.spyOn(artworkService, 'fetchArtworkImage').mockResolvedValue({ url: 'blob:mock-artwork', revoke: vi.fn() })
  })

  it('加载班级作品并区分教师已确认与待确认', async () => {
    const listSpy = vi
      .spyOn(artworkService, 'listClassArtworks')
      .mockResolvedValue({ items: [confirmedArtwork, pendingArtwork], total: 2, page: 1, pageSize: 12 } as never)

    const wrapper = await mountView()
    await flushPromises()

    expect(listSpy).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1, pageSize: 12 }))
    expect(wrapper.text()).toContain('儿童作品')
    expect(wrapper.findAll('[data-test="artwork-card"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('朵朵')
    expect(wrapper.text()).toContain('乐乐')
    expect(wrapper.text()).toContain('教师已确认')
    expect(wrapper.text()).toContain('待教师确认')
    expect(wrapper.text()).toContain('我看到你画的小树和阳光')
    expect(wrapper.text()).toContain('共 2 件作品')
  })

  it('AI 草稿明确标注未确认，不冒充教师评价', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockResolvedValue({ items: [confirmedArtwork], total: 1, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView()
    await flushPromises()

    const draft = wrapper.find('[data-test="artwork-ai-draft"]')
    expect(draft.exists()).toBe(true)
    expect(draft.text()).toContain('AI 草稿（未确认）')
  })

  it('未确认作品提示不会向儿童展示或朗读', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockResolvedValue({ items: [pendingArtwork], total: 1, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('尚未由教师确认，不会向儿童展示或朗读')
    expect(wrapper.text()).not.toContain('教师已确认')
  })

  it('按幼儿筛选时携带 studentId 重新请求', async () => {
    const listSpy = vi
      .spyOn(artworkService, 'listClassArtworks')
      .mockResolvedValue({ items: [confirmedArtwork, pendingArtwork], total: 2, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView()
    await flushPromises()

    await wrapper.find('select').setValue('2')
    await wrapper.find('select').trigger('change')
    await flushPromises()

    expect(listSpy).toHaveBeenLastCalledWith(1, expect.objectContaining({ studentId: 2 }))
  })

  it('支持从学生资料带 studentId 进入', async () => {
    const listSpy = vi
      .spyOn(artworkService, 'listClassArtworks')
      .mockResolvedValue({ items: [confirmedArtwork], total: 1, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView('/classes/1/artworks?studentId=2')
    await flushPromises()

    expect(listSpy).toHaveBeenCalledWith(1, expect.objectContaining({ studentId: 2 }))
    expect(wrapper.text()).toContain('仅显示所选幼儿')
  })

  it('接口失败时展示错误，不伪装成空列表', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockRejectedValue(new Error('作品接口不可用'))
    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('作品接口不可用')
    expect(wrapper.text()).not.toContain('本班还没有作品记录')
  })

  it('无权限时展示 403 提示而不是空列表', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockRejectedValue({ isAxiosError: true, response: { status: 403, data: {} } })
    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('没有访问这个班级作品的权限')
  })

  it('空班级显示空状态并保留安全说明', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('本班还没有作品记录')
    expect(wrapper.text()).toContain('不做评分、排名或能力标签')
  })

  it('按幼儿筛选但该幼儿没有作品时，仍显示筛选状态而不是误导为全班为空', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 } as never)
    const wrapper = await mountView('/classes/1/artworks?studentId=2')
    await flushPromises()

    expect(wrapper.text()).toContain('该幼儿还没有作品记录')
    expect(wrapper.find('[data-test="artwork-filter-note"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('仅显示所选幼儿的作品')
    expect(wrapper.text()).not.toContain('本班还没有作品记录')
  })

  it('图片加载失败时不伪造缩略图', async () => {
    vi.spyOn(artworkService, 'listClassArtworks').mockResolvedValue({ items: [confirmedArtwork], total: 1, page: 1, pageSize: 12 } as never)
    vi.spyOn(artworkService, 'fetchArtworkImage').mockRejectedValue(new Error('403'))
    const wrapper = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('图片加载失败')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
