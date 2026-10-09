import ElementPlus from 'element-plus'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import ChatView from '@/views/ChatView.vue'
import { useUserStore } from '@/stores/user'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

// 课间模式与启发式课堂助教彻底分离：ChatView 头部的「课间模式」走真实
// lessonRunStore.startBreak/endBreak；「启发引导」才是启发式课堂助教的唯一入口。
// 课间 active 时常驻课间休息 UI，隐藏聊天框与启发式助教表单。
const NOW = new Date('2026-01-01T08:00:00.000Z')

function runningRun(over: Record<string, unknown> = {}): ClassroomRunPayload {
  return {
    id: 9,
    lessonPlanId: 3,
    classId: 1,
    deviceId: 1,
    version: 1,
    status: 'running',
    currentStepIndex: 0,
    title: '颜色认知：红色与黄色',
    steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '看一看', resourceId: null, durationSeconds: 60 }],
    elapsedSeconds: 5,
    startedAt: '2026-01-01T07:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...over,
  }
}

function inBreakRun(endsOffsetSeconds = 180): ClassroomRunPayload {
  return {
    ...runningRun(),
    version: 2,
    breakStartedAt: NOW.toISOString(),
    breakEndsAt: new Date(NOW.getTime() + endsOffsetSeconds * 1000).toISOString(),
    serverNow: NOW.toISOString(),
  }
}

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('ChatView · 课间模式与启发式助教分离', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function mockHttp() {
    // 模拟后端权威状态：GET 轮询返回当前 run（serverNow 随本地时钟更新，贴近真实服务端），POST start/end break 更新之
    let current: ClassroomRunPayload = runningRun()
    vi.spyOn(http, 'get').mockImplementation(async () => {
      if (current.serverNow) current.serverNow = new Date(Date.now()).toISOString()
      return { data: current } as never
    })
    vi.spyOn(http, 'post').mockImplementation(async (url: string, body?: unknown) => {
      const operation = (body as { operation?: string } | undefined)?.operation
      if (url === '/classroom-commands' && operation === 'end_break') {
        current = runningRun()
        return { data: current } as never
      }
      if (url === '/classroom-commands' && operation === 'start_break') {
        current = inBreakRun(180)
        return { data: current } as never
      }
      return { data: current } as never
    })
  }

  async function mountView() {
    // 登录态：使头部「课间模式 / 启发引导」按钮可见
    const user = useUserStore()
    user.initialize()
    if (!user.isLogin) {
      user.setLogin('test-token', { name: '测试教师', account: 't001' }, 'refresh')
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/chat', name: 'chat', component: ChatView }],
    })
    router.push('/chat')
    await router.isReady()
    const wrapper = mount(ChatView, {
      global: { plugins: [router, ElementPlus] },
      attachTo: document.body,
    })
    await settle()
    return wrapper
  }

  it('1. isBreakActive=false：不显示「课间休息」，显示普通聊天页', async () => {
    mockHttp()
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('课间休息')
    expect(wrapper.text()).toContain('和小花老师聊聊天')
    // 启发式助教未打开
    expect(wrapper.text()).not.toContain('启发式课堂助教')
    expect(wrapper.find('.break-mode-button').text()).toContain('课间模式')
    wrapper.unmount()
  })

  it('2. 点击课间模式→选择3分钟→startBreak 成功：显示「课间休息」与倒计时', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()

    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    // 时长选择出现
    expect(wrapper.find('[data-test="break-config"]').exists()).toBe(true)

    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()

    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('课间休息')
    expect(wrapper.find('[data-test="chat-break-countdown"]').text()).toBe('03:00')
    wrapper.unmount()
  })

  it('3. break active：不显示「启发式课堂助教」与「生成 AI 草稿」', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()

    // 先打开助教，再进课间，验证课间接管主内容
    await wrapper.find('.assistant-mode-button').trigger('click')
    await settle()
    expect(wrapper.find('.assistant-mode-button').text()).toContain('返回聊天')

    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()

    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).not.toContain('启发式课堂助教')
    expect(text).not.toContain('生成 AI 草稿')
    wrapper.unmount()
  })

  it('4. break active：倒计时随 breakEndsAt 递减', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()
    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()
    expect(wrapper.find('[data-test="chat-break-countdown"]').text()).toBe('03:00')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.find('[data-test="chat-break-countdown"]').text()).toBe('02:30')
    wrapper.unmount()
  })

  it('5. break active：隐藏聊天输入与发送按钮', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()
    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()
    expect(wrapper.find('.message-area').exists()).toBe(false)
    wrapper.unmount()
  })

  it('6. endBreak 成功：恢复聊天页且不自动打开助教', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()
    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()
    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(true)

    const end = wrapper.findAll('button').find((b) => b.text().includes('提前结束课间'))!
    await end.trigger('click')
    await settle()

    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(false)
    expect(wrapper.find('.message-area').exists()).toBe(true)
    expect(wrapper.text()).toContain('和小花老师聊聊天')
    // 结束课间后不自动打开启发式助教
    expect(wrapper.text()).not.toContain('启发式课堂助教')
    wrapper.unmount()
  })

  it('7. 自然结束：倒计时归零自动恢复聊天页', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()
    // 直接让当前 store 进入课间（模拟 break 已开启）
    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()
    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(true)

    // 时间推进超过 breakEndsAt（180 秒）：倒计时到 0，自动退出课间
    await vi.advanceTimersByTimeAsync(181_000)
    await settle()
    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(false)
    expect(wrapper.find('.message-area').exists()).toBe(true)
    wrapper.unmount()
  })

  it('8. 启发式助教独立入口：点击「启发引导」仍正常打开', async () => {
    mockHttp()
    const wrapper = await mountView()
    expect(wrapper.find('.assistant-mode-button').text()).toContain('启发引导')
    await wrapper.find('.assistant-mode-button').trigger('click')
    await settle()
    expect(wrapper.find('.assistant-mode-button').text()).toContain('返回聊天')
    expect(wrapper.text()).toContain('启发式课堂助教')
    wrapper.unmount()
  })

  it('9. 进入课间时关闭其它状态/助教面板：课间 UI 常驻', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockHttp()
    const wrapper = await mountView()
    // 先打开助教
    await wrapper.find('.assistant-mode-button').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('启发式课堂助教')
    // 进入课间
    await wrapper.find('.break-mode-button').trigger('click')
    await settle()
    const three = wrapper
      .findAll('[data-test="break-config"] button')
      .find((b) => b.text().includes('3 分钟'))!
    await three.trigger('click')
    await settle()
    // 助教被关掉，课间常驻，且按钮回到「课间模式」
    expect(wrapper.find('[data-test="chat-break"]').exists()).toBe(true)
    expect(wrapper.find('.break-mode-button').text()).toContain('退出课间模式')
    expect(wrapper.find('.message-area').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('启发式课堂助教')
    wrapper.unmount()
  })
})
