import ElementPlus, { ElMessageBox, type MessageBoxData } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import LoginView from '@/views/LoginView.vue'
import ChatView from '@/views/ChatView.vue'
import LessonResourceSelector from '@/components/LessonResourceSelector.vue'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import LessonPlanEditorView from '@/views/LessonPlanEditorView.vue'
import LessonPlanListView from '@/views/LessonPlanListView.vue'
import LessonClassroomView from '@/views/LessonClassroomView.vue'
import CourseResourcesPanel from '@/components/CourseResourcesPanel.vue'
import { useUserStore } from '@/stores/user'
import { useCourseResourceStore, type ServerResource } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useLessonPlanStore, type LessonPlan } from '@/stores/lessonPlan'

const resource: ServerResource = { id: 12, title: '春天图片', aliases: [], description: '观察春天', resourceType: 'image', category: '图片卡片', ageGroup: 'middle', tags: ['春天'], fileUrl: '/uploads/resources/spring.jpg', coverUrl: null, fileName: 'spring.jpg', mimeType: 'image/jpeg', fileSize: 10, duration: null, reviewStatus: 'approved', createdAt: '2026-01-01' }
const plan: LessonPlan = { id: 3, teacherId: 1, title: '春天课堂', theme: '春天', ageGroup: '4-5', objectives: '观察颜色', estimatedMinutes: 20, status: 'ready', version: 2, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const run = { id: 9, lessonPlanId: 3, deviceId: 1, version: 1, status: 'running', currentStepIndex: 0, title: '春天课堂', steps: [{ stepIndex: 0, title: '看一看', type: 'question', content: '你发现了什么？', resourceId: null, durationSeconds: 60 }, { stepIndex: 1, title: '总结', type: 'summary', content: '说说发现', resourceId: null, durationSeconds: 60 }], elapsedSeconds: 3, startedAt: '2026-01-01', updatedAt: '2026-01-01' }

function routerFor(path: string, routes?: RouteRecordRaw[]) {
  const router = createRouter({ history: createMemoryHistory(), routes: routes ?? [
    { path: '/login', component: LoginView },
    { path: '/chat', component: { template: '<div>聊天页</div>' } },
    { path: '/my-classes', component: { template: '<div>我的班级</div>' } },
    { path: '/lesson-plans', component: { template: '<div>教案列表</div>' } },
    { path: '/lesson-plans/new', component: LessonPlanEditorView },
    { path: '/classroom/lesson/:runId', component: LessonClassroomView },
  ] })
  return router.push(path).then(() => router.isReady()).then(() => router)
}

function loginTeacher() {
  useUserStore().setLogin('token', { teacherId: 1, account: 'teacher', name: '王老师' })
}

describe('login and role visibility', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('validates and submits the teacher login form', async () => {
    const router = await routerFor('/login')
    vi.spyOn(http, 'post').mockImplementation(async (url) => url === '/auth/login' ? { data: { access_token: 'token', teacherId: 1 } } : { data: { success: true } })
    vi.spyOn(http, 'get').mockResolvedValue({ data: { teacherId: 1, account: 'teacher', name: '王老师' } })
    const wrapper = mount(LoginView, { global: { plugins: [router, ElementPlus] } })
    await wrapper.get('input[autocomplete="username"]').setValue('teacher')
    await wrapper.get('input[autocomplete="current-password"]').setValue('Teacher123!')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(useUserStore().isLogin).toBe(true)
    expect(router.currentRoute.value.path).toBe('/chat')
  })

  it('hides teacher-only preparation navigation from visitors', async () => {
    const router = await routerFor('/chat')
    const guest = shallowMount(ChatView, { global: { plugins: [router, ElementPlus], stubs: { CourseResourcesPanel: true, FavoritesPanel: true, ClassroomAssistantPanel: true } } })
    expect(guest.text()).not.toContain('备课中心')
    guest.unmount()
    loginTeacher()
    const teacher = shallowMount(ChatView, { global: { plugins: [router, ElementPlus], stubs: { CourseResourcesPanel: true, FavoritesPanel: true, ClassroomAssistantPanel: true } } })
    expect(teacher.text()).toContain('备课中心')
    expect(teacher.text()).toContain('我的班级')
  })

  it('accepts a free teacher prompt without generating when assistant mode opens', async () => {
    loginTeacher()
    const post = vi.spyOn(http, 'post').mockResolvedValue({
      data: {
        mode: 'guided_dialogue',
        ability: 'guided_question',
        reply: '你先看一看，发现了什么呀？',
        teacherTip: '等待幼儿先观察再回答。',
        suggestedAction: null,
        requiresTeacherConfirmation: false,
      },
    })
    const router = await routerFor('/chat', [
      { path: '/chat', component: ChatView },
      { path: '/lesson-plans', component: { template: '<div />' } },
    ])
    const wrapper = mount(ChatView, {
      global: {
        plugins: [router, ElementPlus],
        stubs: { CourseResourcesPanel: true, FavoritesPanel: true },
      },
    })

    await wrapper.findAll('button').find((button) => button.text().includes('启发引导'))!.trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    await wrapper.get('textarea[aria-label="老师自由提问"]').setValue('请问孩子2是什么')
    await wrapper.findAll('button').find((button) => button.text().includes('生成 AI 草稿'))!.trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/ai/classroom-assistant',
      expect.objectContaining({
        text: '请问孩子2是什么',
        speaker: 'teacher',
      }),
      expect.any(Object),
    )
    expect((wrapper.get('textarea[aria-label="编辑AI问题"]').element as HTMLTextAreaElement).value)
      .toBe('你先看一看，发现了什么呀？')
    wrapper.unmount()
  })

  it('handles resource requests in normal chat and reports missing resources', async () => {
    loginTeacher()
    const post = vi.spyOn(http, 'post').mockImplementation(async (url) => {
      if (url === '/ai/command') {
        return {
          data: {
            mode: 'command',
            intent: 'open_resource',
            keyword: '不存在的月亮绘本',
            confidence: 0.98,
            reply: '课程资源里没有找到“不存在的月亮绘本”。',
            requiresConfirmation: true,
            matchStatus: 'not_found',
            candidates: [],
          },
        }
      }
      return { data: { reply: '不应该调用普通聊天' } }
    })
    const router = await routerFor('/chat', [
      { path: '/chat', component: ChatView },
      { path: '/lesson-plans', component: { template: '<div />' } },
    ])
    const wrapper = mount(ChatView, {
      global: {
        plugins: [router, ElementPlus],
        stubs: { CourseResourcesPanel: true, FavoritesPanel: true },
      },
    })

    expect(wrapper.text()).not.toContain('课堂指令模式')
    await wrapper.get('textarea[aria-label="输入聊天消息"]').setValue('帮我打开课程资源里的不存在的月亮绘本')
    await wrapper.get('button.send-button').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/ai/command',
      expect.objectContaining({
        text: '帮我打开课程资源里的不存在的月亮绘本',
      }),
    )
    expect(post).not.toHaveBeenCalledWith('/ai/chat', expect.anything())
    expect(wrapper.text()).toContain('课程资源里没有找到')
    wrapper.unmount()
  })
})

describe('resource components', () => {
  beforeEach(() => { setActivePinia(createPinia()); loginTeacher(); vi.spyOn(http, 'get').mockResolvedValue({ data: { items: [resource], total: 1, page: 1, pageSize: 20 } }) })

  it('filters the course resource list by keyword', async () => {
    const store = useCourseResourceStore(); await store.refreshLibrary()
    const wrapper = shallowMount(CourseResourcesPanel, { global: { plugins: [ElementPlus], stubs: { ResourcePlayer: true, ElDialog: true } } })
    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('.pptx')
    expect(wrapper.text()).toContain('春天图片')
    await wrapper.get('input[type="search"]').setValue('不存在')
    expect(wrapper.text()).not.toContain('春天图片')
    expect(wrapper.text()).toContain('暂时没有匹配的资源')
  })

  it('selects an existing resource without uploading a copy', async () => {
    const store = useCourseResourceStore(); await store.refreshLibrary()
    const wrapper = mount(LessonResourceSelector, { attachTo: document.body, props: { open: true }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(document.body.textContent).toContain('春天图片')
    const buttons = Array.from(document.body.querySelectorAll('button'))
    const select = buttons.find((button) => button.textContent?.trim() === '选择')
    select?.click(); await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([12])
  })

  it('shows the unified player error state after image failure', async () => {
    const normalized = useCourseResourceStore(); await normalized.refreshLibrary()
    const item = normalized.sortedResources[0]!
    useResourcePlayerStore().openResource(item, false)
    const wrapper = mount(ResourcePlayer, { props: { resources: [item] }, global: { plugins: [ElementPlus] } })
    await wrapper.get('img.stage-image').trigger('error')
    expect(useResourcePlayerStore().playerStatus).toBe('error')
    expect(wrapper.text()).toContain('资源暂时无法显示')
  })

  it('requires server conversion instead of exposing a protected PowerPoint URL', async () => {
    const presentation: ServerResource = {
      ...resource,
      id: 15,
      title: '春天主题课件',
      fileName: '春天主题.pptx',
      fileUrl: '/uploads/resources/spring.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      resourceType: 'document',
      category: '教案课件',
    }
    vi.mocked(http.get).mockResolvedValueOnce({ data: { items: [presentation], total: 1, page: 1, pageSize: 20 } })
    const normalized = useCourseResourceStore()
    await normalized.refreshLibrary()
    const item = normalized.sortedResources[0]!
    useResourcePlayerStore().openResource(item, false)
    const wrapper = mount(ResourcePlayer, { props: { resources: [item] }, global: { plugins: [ElementPlus] } })

    expect(wrapper.text()).toContain('服务端转换为 PDF 或逐页图片')
    expect(wrapper.find('a.presentation-open').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
})

describe('lesson components', () => {
  beforeEach(() => { setActivePinia(createPinia()); loginTeacher() })

  it('edits lesson steps and previews AI output locally', async () => {
    let resolveResources!: (value: { data: { items: never[]; total: number } }) => void
    const get = vi.spyOn(http, 'get').mockImplementation(() => new Promise((resolve) => { resolveResources = resolve }))
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { id: 8, output: { title: 'AI春天教案', theme: '春天', ageGroup: '4-5', domain: '科学', estimatedMinutes: 20, teachingObjectives: ['观察颜色'], teachingProcess: [{ title: 'AI观察', stepType: 'question', content: '你看到了什么？', durationSeconds: 120 }] } } })
    const router = await routerFor('/lesson-plans/new')
    const wrapper = mount(LessonPlanEditorView, { global: { plugins: [router, ElementPlus], stubs: { ResourcePlayer: true, LessonResourceSelector: true } } })
    await flushPromises()
    const lessonStore = (wrapper.vm as unknown as { store: ReturnType<typeof useLessonPlanStore> }).store
    await vi.waitFor(() => expect(get).toHaveBeenCalled())
    resolveResources({ data: { items: [], total: 0 } })
    await flushPromises()
    await vi.waitFor(() => expect(lessonStore.loading).toBe(false))
    await wrapper.findAll('button').find((button) => button.text().includes('新增步骤'))!.trigger('click')
    expect(wrapper.text()).toContain('课堂步骤')
    expect(lessonStore.steps).toHaveLength(1)
    Object.assign(lessonStore.draft, { theme: '春天', objectives: '观察颜色', estimatedMinutes: 20 })
    await wrapper.findAll('button').find((button) => button.text().includes('AI 生成草稿'))!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('先告诉 AI 本次活动的主题'))
    let confirm = wrapper.findAll('button').find((button) => button.text().includes('开始生成'))
    expect(confirm).toBeTruthy()
    expect(confirm!.attributes('disabled')).toBeDefined()
    await wrapper.get('input[placeholder="例如：春天里的小花"]').setValue('春天')
    confirm = wrapper.findAll('button').find((button) => button.text().includes('开始生成'))
    expect(confirm!.attributes('disabled')).toBeUndefined()
    await confirm!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(lessonStore.steps[0]?.title).toBe('AI观察'))
    expect(post).toHaveBeenCalledWith('/lesson-plans/ai-drafts', expect.objectContaining({ theme: '春天', teachingObjectives: '春天' }))
    expect(lessonStore.current).toBeNull()
    wrapper.unmount()
  })

  it('starts a lesson from the list with one click', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { items: [plan], total: 1 } })
    vi.spyOn(http, 'post').mockResolvedValue({ data: { runId: 9 } })
    const router = await routerFor('/lesson-plans', [{ path: '/lesson-plans', component: LessonPlanListView }, { path: '/classroom/preflight/:planId', component: { template: '<div>检查</div>' } }, { path: '/classroom/lesson/:runId', component: { template: '<div>课堂</div>' } }, { path: '/chat', component: { template: '<div />' } }])
    const wrapper = mount(LessonPlanListView, { global: { plugins: [router, ElementPlus] } })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('开始上课'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/classroom/preflight/3')
  })

  it('offers the guided classroom assistant during a non-question step', async () => {
    const introductionRun = { ...run, steps: [{ ...run.steps[0]!, type: 'introduction' }] }
    vi.spyOn(http, 'get').mockResolvedValue({ data: introductionRun })
    const post = vi.spyOn(http, 'post').mockImplementation(async (url) => url === '/ai/tts'
      ? { data: { audioUrl: 'data:audio/mpeg;base64,AAAA' } }
      : url === '/classroom-commands'
        ? { data: { status: 'success', result: {}, classroomState: introductionRun } }
        : { data: { mode: 'guided_dialogue', ability: 'guided_question', reply: '你的小手指像数字几呀？', teacherTip: '等待幼儿观察手指后再回答。', suggestedAction: null, requiresTeacherConfirmation: false } })
    vi.stubGlobal('Audio', class {
      src = ''
      constructor() {}
      addEventListener() {}
      async play() {}
      pause() {}
    })
    const router = await routerFor('/classroom/lesson/9')
    const wrapper = mount(LessonClassroomView, { global: { plugins: [router, ElementPlus], stubs: { ResourcePlayer: true } } })
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('启发式课堂助教'))
    await wrapper.findAll('button').find((button) => button.text().includes('打开助教'))!.trigger('click')
    await wrapper.get('textarea[placeholder="输入老师想让助教回答的问题或课堂要求"]').setValue('请问孩子数字1像什么')
    await wrapper.findAll('button').find((button) => button.text().includes('生成AI草稿'))!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/ai/classroom-assistant', expect.objectContaining({ text: '请问孩子数字1像什么', speaker: 'teacher', activityContext: expect.objectContaining({ currentStep: expect.stringContaining('看一看') }) }), expect.any(Object))
    const editableDraft = wrapper.get('textarea[aria-label="编辑AI草稿"]')
    expect((editableDraft.element as HTMLTextAreaElement).value).toBe('你的小手指像数字几呀？')
    await editableDraft.setValue('你觉得数字1像什么呀？')
    const confirmPlay = wrapper.findAll('button').find((button) => button.text().includes('教师确认并播放'))
    expect(confirmPlay).toBeTruthy()
    await confirmPlay!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/classroom-commands', expect.objectContaining({ operation: 'speak_text', targetDeviceId: 1, parameters: { text: '你觉得数字1像什么呀？' } }))
    expect(post).toHaveBeenCalledWith('/ai/tts', { text: '你觉得数字1像什么呀？' })
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('disables next step while paused and confirms completion', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...run, status: 'paused' } })
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { ...run, status: 'completed' } })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as unknown as MessageBoxData)
    const router = await routerFor('/classroom/lesson/9')
    const wrapper = mount(LessonClassroomView, { global: { plugins: [router, ElementPlus], stubs: { ResourcePlayer: true } } })
    await flushPromises()
    const next = wrapper.findAll('button').find((button) => button.text().includes('下一步'))!
    expect(next.attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find((button) => button.text().includes('结束课堂'))!.trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('/classroom-commands', expect.objectContaining({ expectedVersion: 1, operation: 'complete_class', requestId: expect.any(String) }))
  })

  it('renders a read-only page after the run has ended', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...run, status: 'cancelled' } })
    const router = await routerFor('/classroom/lesson/9')
    const wrapper = mount(LessonClassroomView, { global: { plugins: [router, ElementPlus], stubs: { ResourcePlayer: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('本节课堂已中止')
    expect(wrapper.text()).not.toContain('下一步')
  })
})
