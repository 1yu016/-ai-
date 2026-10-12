import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resourceApi, type ResourceResponse } from '@/api/resources'
import { useUserStore } from '@/stores/user'
import ResourceDetailView from '@/views/resources/ResourceDetailView.vue'
import ResourceLibraryView from '@/views/resources/ResourceLibraryView.vue'
import ResourceEditView from '@/views/resources/ResourceEditView.vue'

const ManagementLayoutStub = { template: '<main><slot /></main>' }
const BackButtonStub = { template: '<button>返回资源库</button>' }

async function mountRoute(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useUserStore().setLogin('token', {
    teacherId: 1,
    account: 'teacher',
    name: '资源老师',
    role: 'teacher',
    userType: 'teacher',
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/resources', name: 'resources', component: ResourceLibraryView },
      { path: '/resources/upload', name: 'resource-upload', component: { template: '<div />' } },
      { path: '/resources/:id/preview', name: 'resource-preview', component: { template: '<div />' } },
      { path: '/resources/:id/edit', name: 'resource-edit', component: { template: '<div />' } },
      { path: '/resources/:id/review', name: 'resource-review', component: { template: '<div />' } },
      { path: '/resources/:id', name: 'resource-detail', component: ResourceDetailView, props: true },
    ],
  })
  await router.push(path)
  await router.isReady()
  const component = path === '/resources' || path.startsWith('/resources?')
    ? ResourceLibraryView
    : path.endsWith('/edit')
      ? ResourceEditView
      : ResourceDetailView
  const wrapper = mount(component, {
    props: component === ResourceLibraryView
      ? undefined
      : { id: Number(router.currentRoute.value.params.id) },
    global: {
      plugins: [pinia, router],
      stubs: {
        ManagementLayout: ManagementLayoutStub,
        BackButton: BackButtonStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

function makeResource(overrides: Partial<ResourceResponse> = {}): ResourceResponse {
  return {
    id: 1, title: '春天图片', aliases: [], description: '观察春天',
    resourceType: 'image', category: '图片卡片', categoryId: null,
    ageGroup: 'middle', domain: '科学', tags: ['春天'],
    fileUrl: '/resources/1/download', coverUrl: null, fileName: 'spring.png',
    mimeType: 'image/png', fileSize: 100, duration: null, sha256: null,
    reviewStatus: 'draft', ownerId: '1', ownerType: 'teacher', schoolId: 'garden-1',
    currentVersionId: 1, referenceCount: 0, isFavorite: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resource access pages', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(resourceApi, 'categories').mockResolvedValue({ data: [] } as never)
    vi.spyOn(resourceApi, 'listReferences').mockResolvedValue({ data: [] } as never)
  })

  it('renders a clear empty state for an empty resource list', async () => {
    vi.spyOn(resourceApi, 'list').mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    } as never)
    const wrapper = await mountRoute('/resources')
    expect(wrapper.text()).toContain('没有找到资源')
    expect(wrapper.text()).toContain('清除筛选')
  })

  it('restores list filters and pagination from the URL after refresh', async () => {
    const list = vi.spyOn(resourceApi, 'list').mockResolvedValue({
      data: { items: [], total: 0, page: 3, pageSize: 20 },
    } as never)
    await mountRoute('/resources?resourceType=video&ageGroup=middle&domain=%E7%A7%91%E5%AD%A6&tag=%E5%8A%A8%E7%89%A9&reviewStatus=pending_review&isFavorite=false&ownerId=42&page=3')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'video',
      ageGroup: 'middle',
      domain: '科学',
      tag: '动物',
      reviewStatus: 'pending_review',
      isFavorite: false,
      ownerId: '42',
      page: 3,
    }))
  })

  it('renders the forbidden state when the detail API returns 403', async () => {
    vi.spyOn(resourceApi, 'get').mockRejectedValue({
      isAxiosError: true,
      response: { status: 403 },
    })
    const wrapper = await mountRoute('/resources/8')
    expect(wrapper.text()).toContain('暂无访问权限')
    expect(wrapper.text()).toContain('当前账号没有权限查看该资源')
  })

  it('renders the deleted resource state when the detail API returns 404', async () => {
    vi.spyOn(resourceApi, 'get').mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    })
    const wrapper = await mountRoute('/resources/9')
    expect(wrapper.text()).toContain('资源不存在')
    expect(wrapper.text()).toContain('可能已被删除')
  })

  it('allows a teacher to edit their own resource', async () => {
    vi.spyOn(resourceApi, 'get').mockResolvedValue({ data: makeResource() } as never)
    const wrapper = await mountRoute('/resources/1')
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).not.toContain('只能查看和收藏')
  })

  it('lets the owner submit a draft and then displays the server-confirmed pending state', async () => {
    vi.spyOn(resourceApi, 'get')
      .mockResolvedValueOnce({ data: makeResource() } as never)
      .mockResolvedValueOnce({
        data: makeResource({ reviewStatus: 'pending_review' }),
      } as never)
    const submit = vi.spyOn(resourceApi, 'submitReview').mockResolvedValue({ data: {} } as never)
    const wrapper = await mountRoute('/resources/1')
    const button = wrapper.findAll('button').find((item) => item.text() === '提交审核')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flushPromises()
    expect(submit).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('待审核')
  })

  it('shows the lesson and step names that reference an owned resource', async () => {
    vi.mocked(resourceApi.listReferences).mockResolvedValue({
      data: [{
        referenceType: 'lesson_plan',
        referenceId: '9',
        lessonPlanId: 9,
        lessonPlanTitle: '认识春天',
        steps: [{ id: 3, sortOrder: 2, title: '观察花朵' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    } as never)
    vi.spyOn(resourceApi, 'get').mockResolvedValue({ data: makeResource({ referenceCount: 1 }) } as never)
    const wrapper = await mountRoute('/resources/1')
    expect(wrapper.text()).toContain('认识春天')
    expect(wrapper.text()).toContain('2.观察花朵')
  })

  it('explains why a shared resource cannot be edited', async () => {
    vi.spyOn(resourceApi, 'get').mockResolvedValue({
      data: makeResource({ ownerId: '2', reviewStatus: 'approved' }),
    } as never)
    const wrapper = await mountRoute('/resources/1')
    expect(wrapper.text()).toContain('当前账号只能查看和收藏')
  })

  it('shows the server-aligned reason for an archived resource', async () => {
    vi.spyOn(resourceApi, 'get').mockResolvedValue({
      data: makeResource({ reviewStatus: 'archived' }),
    } as never)
    const wrapper = await mountRoute('/resources/1/edit')
    expect(wrapper.text()).toContain('该资源已归档，不能编辑元数据')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('keeps edited input when save fails', async () => {
    vi.spyOn(resourceApi, 'get').mockResolvedValue({ data: makeResource() } as never)
    vi.spyOn(resourceApi, 'update').mockRejectedValue(new Error('保存失败'))
    const wrapper = await mountRoute('/resources/1/edit')
    const title = wrapper.get('input[placeholder="资源标题"]')
    await title.setValue('我修改但尚未保存的标题')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect((title.element as HTMLInputElement).value).toBe('我修改但尚未保存的标题')
  })

  it('re-reads the resource after a successful edit', async () => {
    const original = makeResource()
    const confirmed = makeResource({ title: '服务端确认后的标题' })
    vi.spyOn(resourceApi, 'get')
      .mockResolvedValueOnce({ data: original } as never)
      .mockResolvedValueOnce({ data: confirmed } as never)
    const update = vi.spyOn(resourceApi, 'update').mockResolvedValue({ data: confirmed } as never)
    const wrapper = await mountRoute('/resources/1/edit')
    await wrapper.get('input[placeholder="资源标题"]').setValue('新标题')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ title: '新标题' }))
    expect(resourceApi.get).toHaveBeenCalledTimes(2)
  })
})
