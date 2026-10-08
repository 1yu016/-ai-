import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomAvatar from '@/components/digital-human/ClassroomAvatar.vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

// mock vendor 模块：测试环境不加载真实 SVG core（与 grokbot-avatar.spec 一致）。
vi.mock('@/vendor/agent-robot-avatar/agent-robot-avatar.js', () => ({ default: {} }))

// 可控抛错的 <agent-robot-avatar> mock：记录第三方真实 API 调用，并支持模拟 play 抛错。
let playThrow: Error | null = null
class MockAgentAvatar extends HTMLElement {
  calls: string[] = []
  play(action: string) {
    if (playThrow) throw playThrow
    this.calls.push(`play:${action}`)
    return this
  }
  reset() { this.calls.push('reset'); return this }
  startWaiting() { this.calls.push('startWaiting'); return Promise.resolve(this) }
  stopWaiting() { this.calls.push('stopWaiting'); return this }
  setPressSqueeze(v: boolean) { this.calls.push(`setPressSqueeze:${v}`); return this }
  setAntennaDrag(v: boolean) { this.calls.push(`setAntennaDrag:${v}`); return this }
  setPointerFollow(v: boolean) { this.calls.push(`setPointerFollow:${v}`); return this }
}

function avatarCalls(wrapper: ReturnType<typeof mount>) {
  return (wrapper.find('agent-robot-avatar').element as unknown as MockAgentAvatar).calls
}

async function settle() {
  // defineAsyncComponent 的 loader 需要真实微任务/宏任务推进；轮询直到 Adapter 挂载完成。
  for (let i = 0; i < 30; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('ClassroomAvatar · 课堂业务唯一数字人组件', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    playThrow = null
    if (!customElements.get('agent-robot-avatar')) {
      customElements.define('agent-robot-avatar', MockAgentAvatar)
    }
  })

  it('未传 props：store.action(talk) → ClassroomAvatar → avatarStateMap → Agent Robot Avatar play(send)', async () => {
    const store = useDigitalHumanStore()
    store.setAction('talk')
    const wrapper = mount(ClassroomAvatar)
    await settle()
    expect(avatarCalls(wrapper)).toContain('play:send')
    wrapper.unmount()
  })

  it('store.action(listen) → 持续态 startWaiting()；切到 thinking → stopWaiting + play(inspect)', async () => {
    const store = useDigitalHumanStore()
    store.setAction('listen')
    const wrapper = mount(ClassroomAvatar)
    await settle()
    const calls = avatarCalls(wrapper)
    expect(calls.filter((c) => c === 'startWaiting')).toHaveLength(1)
    // 再经 store 切到思考（AI 响应）。
    store.setAction('thinking')
    await settle()
    const calls2 = avatarCalls(wrapper)
    expect(calls2).toContain('stopWaiting')
    expect(calls2).toContain('play:inspect')
    wrapper.unmount()
  })

  it('显式 props.state 优先（DEV / 测试驱动）：surprised → play(surprise)', async () => {
    const store = useDigitalHumanStore()
    store.setAction('idle')
    const wrapper = mount(ClassroomAvatar, { props: { state: 'surprised' } })
    await settle()
    expect(avatarCalls(wrapper)).toContain('play:surprise')
    wrapper.unmount()
  })

  it('store.error 非空（如 TTS 不可用）→ 静态占位降级，不再渲染动画 Adapter', async () => {
    const store = useDigitalHumanStore()
    store.setFallback('语音暂时不可用')
    const wrapper = mount(ClassroomAvatar)
    await settle()
    expect(wrapper.find('agent-robot-avatar').exists()).toBe(false)
    expect(wrapper.find('.avatar-fallback').exists()).toBe(true)
    expect(wrapper.text()).toContain('小花老师')
    expect(wrapper.text()).toContain('语音暂时不可用')
    wrapper.unmount()
  })

  it('size / color 透传：props 直接同步到 <agent-robot-avatar> 属性（大屏尺寸 / 换肤入口）', async () => {
    const store = useDigitalHumanStore()
    store.setAction('idle')
    const wrapper = mount(ClassroomAvatar, { props: { size: 320, color: '#5AA9B5' } })
    await settle()
    const el = wrapper.find('agent-robot-avatar')
    expect(el.attributes('size')).toBe('320')
    expect(el.attributes('color')).toBe('#5AA9B5')
    wrapper.unmount()
  })

  it('Adapter play() 抛错 → fallback-required → 显示 🙂 小花老师占位（数字人异常不影响课堂）', async () => {
    const store = useDigitalHumanStore()
    store.setAction('thinking')
    playThrow = new Error('boom: avatar broken')
    const wrapper = mount(ClassroomAvatar)
    await settle()
    expect(wrapper.find('.avatar-fallback').exists()).toBe(true)
    expect(wrapper.text()).toContain('🙂')
    expect(wrapper.text()).toContain('小花老师')
    wrapper.unmount()
  })
})
