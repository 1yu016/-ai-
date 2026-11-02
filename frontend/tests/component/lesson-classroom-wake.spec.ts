import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import LessonClassroomView from '@/views/LessonClassroomView.vue'

// 语音唤醒接线测试：本地唤醒走 stub（真实 vosk 只在浏览器 E2E / 真人验收）；
// 重点验证「唤醒 → 指令文本 → 既有 D-10/CommandBus → 真实结果反馈」以及关闭、去重、防误执行。

const wakeHolders = vi.hoisted(() => ({ instance: null as null | FakeWake }))
type FakeWake = {
  options: Record<string, (...args: never[]) => void> & {
    onState?: (state: string, message: string) => void
    onWake?: () => void
    onPartial?: (text: string) => void
    onUtterance?: (blob: Blob, localText: string) => void
    onCommandWindowEnd?: (reason: string) => void
  }
  started: boolean
  stopped: boolean
}
vi.mock('@/services/localWakeSpeech', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/localWakeSpeech')>()
  class FakeLocalWakeSpeech {
    options: FakeWake['options']
    started = false
    stopped = false
    constructor(options: FakeWake['options']) {
      this.options = options
      wakeHolders.instance = this as unknown as FakeWake
    }
    async start() {
      this.started = true
      this.options.onState?.('waiting', '正在等待唤醒词：你好，小助手')
    }
    async stop() {
      this.stopped = true
      this.options.onState?.('off', '语音唤醒已关闭，麦克风已释放。')
    }
    setPlaybackActive() {}
    stopCommandWindow() {
      this.options.onCommandWindowEnd?.('已停止接收指令，仍在等待唤醒词。')
    }
    state() {
      return 'waiting'
    }
  }
  return { ...actual, LocalWakeSpeech: FakeLocalWakeSpeech }
})

const duoDuo = {
  id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: null,
  status: 'active', createdAt: '', updatedAt: '',
}
const baseRun = {
  id: 9, lessonPlanId: 3, allowedActions: ['query', 'change_step', 'resource_start', 'media_control', 'safe_stop', 'reward', 'roll_call', 'pause', 'resume', 'complete', 'cancel', 'start_break', 'end_break', 'queue_edit', 'tts'],
  classId: 1, deviceId: 1, version: 2, status: 'running', currentStepIndex: 0, title: '认识数字1',
  steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '今天我们一起认识数字1', resourceId: null, durationSeconds: 60 }],
  elapsedSeconds: 5, startedAt: '2026-10-02T07:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
}

async function settle() {
  await flushPromises()
  await Promise.resolve()
  await Promise.resolve()
}

describe('LessonClassroomView · 语音唤醒接入', () => {
  afterEach(()=>vi.unstubAllEnvs())
  beforeEach(() => {
    document.body.innerHTML = ''
    wakeHolders.instance = null
    vi.spyOn(http, 'get').mockImplementation(async (url: string) => {
      const u = String(url)
      if(u.endsWith('/cockpit'))return {data:{schemaVersion:1,run:{id:baseRun.id,deviceId:baseRun.deviceId},versions:{runVersion:baseRun.version,snapshotVersion:null},capabilities:{allowedActions:baseRun.allowedActions}}} as never
      if (u.startsWith('/classroom-runs/')) {
        if (u.endsWith('/rewards')) return { data: { items: [], total: 0, runTitle: '认识数字1' } } as never
        return { data: baseRun } as never
      }
      if (/students/.test(u)) return { data: { items: [duoDuo], total: 1 } } as never
      if (/leaderboard|reward/.test(u)) return { data: { items: [], className: '班级' } } as never
      return { data: {} } as never
    })
    vi.spyOn(http, 'post').mockImplementation(async (url: string, body?: unknown) => {
      const u = String(url)
      const payload = (body ?? {}) as Record<string, unknown>
      if (u === '/classroom-commands') {
        return { data: {
          requestId: payload.requestId, runId: payload.runId, operation: payload.operation,
          source: payload.source, targetDeviceId: payload.deviceId, status: 'success',
          result: { studentName: '朵朵' },
          classroomState: { ...baseRun, version: 3 },
        } } as never
      }
      return { data: {} } as never
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  async function mountView() {
    const pinia = createPinia()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/classroom/lesson/:runId', name: 'lesson-classroom', component: LessonClassroomView }],
    })
    router.push('/classroom/lesson/9')
    await router.isReady()
    const wrapper = mount(LessonClassroomView, {
      global: {
        plugins: [router, ElementPlus, pinia],
        stubs: { ResourcePlayer: true, DigitalHumanStage: true, ClassroomAvatar: true, teleport: true },
      },
      attachTo: document.body,
    })
    await settle()
    return wrapper
  }

  function footerWakeButton(wrapper: Awaited<ReturnType<typeof mountView>>) {
    return wrapper.findAll('.wake-status-button')[0]!
  }

  it('开启唤醒后进入等待态；命中唤醒词后提示「我在」；关闭后回到未开启', async () => {
    const wrapper = await mountView()
    expect(footerWakeButton(wrapper).text()).toContain('开启语音唤醒')
    await footerWakeButton(wrapper).trigger('click')
    await settle()
    expect(wakeHolders.instance?.started).toBe(true)
    expect(footerWakeButton(wrapper).text()).toContain('等待唤醒词')

    wakeHolders.instance!.options.onWake!()
    await settle()
    expect(footerWakeButton(wrapper).text()).toContain('已唤醒')
    expect(wrapper.text()).toContain('我在')

    await footerWakeButton(wrapper).trigger('click')
    await settle()
    expect(wakeHolders.instance?.stopped).toBe(true)
    expect(footerWakeButton(wrapper).text()).toContain('开启语音唤醒')
    wrapper.unmount()
  })

  it('唤醒后说「随机点一位小朋友」→ 走正式命令接口并显示真实点名结果', async () => {
    const wrapper = await mountView()
    await footerWakeButton(wrapper).trigger('click')
    await settle()
    wakeHolders.instance!.options.onWake!()
    await settle()
    wakeHolders.instance!.options.onUtterance!(new Blob([], { type: 'audio/webm' }), '随机点一位小朋友')
    await settle()

    const post = vi.mocked(http.post)
    const commandCall = post.mock.calls.find(([url]) => String(url) === '/classroom-commands')
    expect(commandCall).toBeTruthy()
    expect((commandCall![1] as { operation: string }).operation).toBe('random_roll_call')
    expect((commandCall![1] as { source: string }).source).toBe('teacher_panel')

    await wrapper.findAll('.voice-detail')[0]!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('正式点名已完成：朵朵')
    wrapper.unmount()
  })

  it('未唤醒时的迟到语音不会执行业务命令；重复识别不重复提交', async () => {
    const wrapper = await mountView()
    const post = vi.mocked(http.post)
    wakeHolders.instance = null
    // 未开启唤醒：即使底层误触发回调也不存在实例。
    expect(wrapper.findAll('.wake-status-button').length).toBe(1)
    expect(post.mock.calls.filter(([url]) => String(url) === '/classroom-commands')).toHaveLength(0)

    await footerWakeButton(wrapper).trigger('click')
    await settle()
    wakeHolders.instance!.options.onWake!()
    await settle()
    wakeHolders.instance!.options.onUtterance!(new Blob([], { type: 'audio/webm' }), '暂停课堂')
    wakeHolders.instance!.options.onUtterance!(new Blob([], { type: 'audio/webm' }), '暂停课堂')
    await settle()
    const calls = post.mock.calls.filter(([url]) => String(url) === '/classroom-commands')
    expect(calls).toHaveLength(1)
    expect((calls[0]![1] as { operation: string }).operation).toBe('pause_class')
    wrapper.unmount()
  })

  it('停止听指令口令只退出指令窗口，不产生课堂业务提交', async () => {
    const wrapper = await mountView()
    await footerWakeButton(wrapper).trigger('click')
    await settle()
    wakeHolders.instance!.options.onWake!()
    await settle()
    wakeHolders.instance!.options.onUtterance!(new Blob([], { type: 'audio/webm' }), '停止听指令')
    await settle()
    expect(vi.mocked(http.post).mock.calls.filter(([url]) => String(url) === '/classroom-commands')).toHaveLength(0)
    expect(footerWakeButton(wrapper).text()).toContain('等待唤醒词')
    wrapper.unmount()
  })

  it('麦克风未授权时给出明确失败提示，不伪装成已开启', async () => {
    const wrapper = await mountView()
    await footerWakeButton(wrapper).trigger('click')
    await settle()
    wakeHolders.instance!.options.onState!('error', '麦克风未授权，请允许浏览器使用麦克风后重试。')
    await settle()
    expect(footerWakeButton(wrapper).text()).toContain('唤醒不可用')
    expect(wrapper.text()).toContain('麦克风未授权')
    expect(vi.mocked(http.post).mock.calls.filter(([url]) => String(url) === '/classroom-commands')).toHaveLength(0)
    wrapper.unmount()
  })
  it('emergency basic mode hides suggestions and retains original fixed commands',async()=>{
    vi.stubEnv('VITE_CLASSROOM_INTELLIGENCE','false')
    const wrapper=await mountView()
    expect(wrapper.find('.teaching-suggestion').exists()).toBe(false)
    await footerWakeButton(wrapper).trigger('click');await settle()
    wakeHolders.instance!.options.onWake!();await settle()
    wakeHolders.instance!.options.onUtterance!(new Blob([]),'随机点名');await settle()
    expect(vi.mocked(http.post).mock.calls.some(([url,body])=>url==='/classroom-commands' && (body as {operation:string}).operation==='random_roll_call')).toBe(true)
    wrapper.unmount()
  })

  it('页面卸载会真正停止监听，之后迟到回调不再执行业务命令', async () => {
    const wrapper = await mountView()
    await footerWakeButton(wrapper).trigger('click')
    await settle()
    wakeHolders.instance!.options.onWake!()
    await settle()
    const instance = wakeHolders.instance!
    wrapper.unmount()
    await settle()
    expect(instance.stopped).toBe(true)
    instance.options.onUtterance?.(new Blob([], { type: 'audio/webm' }), '随机点一位小朋友')
    await settle()
    expect(vi.mocked(http.post).mock.calls.filter(([url]) => String(url) === '/classroom-commands')).toHaveLength(0)
  })
})
