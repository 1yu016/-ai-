import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { http } from '@/api/http'
import LessonResourceSelector from '@/components/LessonResourceSelector.vue'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import LessonPlanEditorView from '@/views/LessonPlanEditorView.vue'
import { useUserStore } from '@/stores/user'
import {
  normalizeServerResource,
  useCourseResourceStore,
  type ServerResource,
} from '@/stores/courseResource'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const resourceMocks = vi.hoisted(() => ({ fetchBlob: vi.fn() }))
vi.mock('@/api/resources', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/resources')>()
  return { ...original, fetchAuthedBlob: resourceMocks.fetchBlob }
})

// Stage 6.6：备课资源绑定 —— 选择资源、save payload 携带 resourceId、重开教案回显、图片渲染。
const imageResource: ServerResource = {
  id: 12,
  title: '红色圆形卡片',
  aliases: [],
  description: '颜色认知',
  resourceType: 'image',
  category: '图片卡片',
  ageGroup: 'small',
  tags: ['颜色'],
  fileUrl: '/resources/12/download',
  coverUrl: null,
  fileName: 'red.jpg',
  mimeType: 'image/jpeg',
  fileSize: 300,
  duration: null,
  reviewStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const resource500: ServerResource = {
  ...imageResource,
  id: 500,
  title: '第 500 条资源（不在第一页）',
  fileUrl: '/resources/500/download',
}

describe('备课资源绑定 · Stage 6.6', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const user = useUserStore()
    user.setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
    resourceMocks.fetchBlob.mockResolvedValue({ url: 'blob:protected-image', revoke: vi.fn() })
  })

  it('资源选择器：点击“选择”发出 update:modelValue 与 selected 事件', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { items: [imageResource], total: 1, page: 1, pageSize: 100 },
    } as never)
    const resources = useCourseResourceStore()
    await resources.refreshLibrary()
    const wrapper = mount(LessonResourceSelector, {
      props: { open: true, modelValue: null },
      global: {
        plugins: [ElementPlus],
        stubs: {
          teleport: true,
          // ElDialog/ElSelect 在 jsdom + teleport stub 下会触发递归更新，用轻量 stub 渲染插槽内容。
          ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
          ElSelect: { template: '<div class="stub-select"><slot /></div>' },
          ElOption: { template: '<span class="stub-option"><slot /></span>' },
        },
      },
    })
    await flushPromises()
    const choose = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === '选择')
    expect(choose).toBeTruthy()
    await choose!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[12]])
    expect(wrapper.emitted('selected')).toHaveLength(1)
  })

  it('保存教案：PUT /steps payload 携带 resourceId', async () => {
    const store = useLessonPlanStore()
    store.newDraft()
    store.draft.title = '颜色认知'
    store.draft.theme = '认识颜色'
    store.draft.objectives = '目标'
    store.addStep({ title: '看卡片', stepType: 'resource', resourceId: 12 })
    const post = vi
      .spyOn(http, 'post')
      .mockResolvedValue({ data: { id: 1, version: 1 } } as never)
    const put = vi
      .spyOn(http, 'put')
      .mockResolvedValue({
        data: {
          version: 2,
          steps: [
            { sortOrder: 1, title: '看卡片', stepType: 'resource', instruction: '看', content: '看', resourceId: 12, durationSeconds: 120 },
          ],
        },
      } as never)
    const plan = await store.save()
    expect(post).toHaveBeenCalledWith('/lesson-plans', expect.objectContaining({ title: '颜色认知' }))
    const putBody = put.mock.calls[0]?.[1]
    const steps = (putBody as { steps?: Array<{ resourceId?: number | null }> }).steps
    expect(steps?.[0]?.resourceId).toBe(12)
    expect(plan.version).toBe(2)
  })

  it('重开教案：不在已加载列表的 resourceId 经 fallback 回显资源标题', async () => {
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources') {
        return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
      }
      if (path === '/lesson-plans/9') {
        return Promise.resolve({
          data: {
            id: 9,
            teacherId: 1,
            title: '颜色认知',
            theme: '认识颜色',
            lessonType: 'normal',
            domain: '科学',
            ageGroup: '4-5',
            objectives: '目标',
            estimatedMinutes: 25,
            status: 'draft',
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            steps: [
              {
                id: 1,
                sortOrder: 1,
                title: '看卡片',
                stepType: 'resource',
                instruction: '看',
                content: '看',
                resourceId: 500,
                durationSeconds: 120,
              },
            ],
          },
        })
      }
      if (path === '/resources/500') {
        return Promise.resolve({ data: resource500 })
      }
      return Promise.resolve({ data: {} })
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/lesson-plans/:id/edit', component: LessonPlanEditorView }],
    })
    await router.push('/lesson-plans/9/edit')
    await router.isReady()
    const wrapper = mount(LessonPlanEditorView, {
      global: {
        plugins: [ElementPlus, router],
        stubs: {
          teleport: true,
          ResourcePlayer: true,
          LessonResourceSelector: true,
          // 规避 ElSelect 在 jsdom + teleport stub 下的递归更新（本测试不断言下拉交互）。
          ElSelect: { template: '<div class="stub-select"><slot /></div>' },
          ElOption: { template: '<span class="stub-option"><slot /></span>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('第 500 条资源（不在第一页）')
    expect(wrapper.text()).not.toContain('资源已失效')
  })

  it('图片资源：ResourcePlayer 通过鉴权 Blob 渲染 <img>', async () => {
    const wrapper = mount(ResourcePlayer, {
      props: { resources: [] },
      global: { plugins: [ElementPlus] },
    })
    const player = useResourcePlayerStore()
    player.openResource(normalizeServerResource(imageResource)!, false)
    await flushPromises()
    const image = wrapper.find('img.stage-image')
    expect(image.exists()).toBe(true)
    expect(resourceMocks.fetchBlob).toHaveBeenCalledWith(12)
    expect(image.attributes('src')).toBe('blob:protected-image')
  })
})
