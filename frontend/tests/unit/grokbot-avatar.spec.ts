import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DigitalHumanState } from '@/components/digital-human/avatar.types'
import GrokBotAvatar from '@/components/digital-human/grokbot/GrokBotAvatar.vue'

// mock vendor 模块：测试环境不加载真实 SVG core（避免 jsdom 中执行 customElements.define 与复杂渲染）。
vi.mock('@/vendor/agent-robot-avatar/agent-robot-avatar.js', () => ({ default: {} }))

// 模拟 <agent-robot-avatar> 自定义元素：记录第三方真实 API（play/reset/startWaiting/stopWaiting）调用。
class MockAgentAvatar extends HTMLElement {
  calls: string[] = []
  play(action: string) { this.calls.push(`play:${action}`); return this }
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

describe('GrokBotAvatar Adapter · 持续态 / 一次性动画 / 竞态', () => {
  beforeEach(() => {
    if (!customElements.get('agent-robot-avatar')) {
      customElements.define('agent-robot-avatar', MockAgentAvatar)
    }
  })

  async function mountAvatar(initialState: DigitalHumanState) {
    const wrapper = mount(GrokBotAvatar, { props: { state: initialState } })
    await flushPromises()
    return wrapper
  }

  it('进入 listening：使用 startWaiting()，不调用 play，且只启动一个 waiting loop', async () => {
    const wrapper = await mountAvatar('listening')
    const calls = avatarCalls(wrapper)
    expect(calls.filter((c) => c === 'startWaiting')).toHaveLength(1)
    expect(calls.some((c) => c.startsWith('play:'))).toBe(false)
    wrapper.unmount()
  })

  it('listening → thinking：先 stopWaiting() 再 play(inspect)，waiting 持续态被释放', async () => {
    const wrapper = await mountAvatar('listening')
    await wrapper.setProps({ state: 'thinking' })
    await flushPromises()
    const calls = avatarCalls(wrapper)
    expect(calls).toContain('stopWaiting')
    expect(calls).toContain('play:inspect')
    // 不再存在重复 waiting loop。
    expect(calls.filter((c) => c === 'startWaiting')).toHaveLength(1)
    wrapper.unmount()
  })

  it('快速切换 listening → thinking → speaking：无重复 waiting loop，新状态 send 生效', async () => {
    const wrapper = await mountAvatar('listening')
    await wrapper.setProps({ state: 'thinking' })
    await wrapper.setProps({ state: 'speaking' })
    await flushPromises()
    const calls = avatarCalls(wrapper)
    expect(calls.filter((c) => c === 'startWaiting')).toHaveLength(1)
    expect(calls.filter((c) => c === 'stopWaiting')).toHaveLength(1)
    expect(calls).toContain('play:send')
    wrapper.unmount()
  })

  it('speaking → idle：走 reset() 回归待机，不再维持一次性动画', async () => {
    const wrapper = await mountAvatar('speaking')
    await wrapper.setProps({ state: 'idle' })
    await flushPromises()
    const calls = avatarCalls(wrapper)
    expect(calls).toContain('play:send')
    expect(calls).toContain('reset')
    wrapper.unmount()
  })

  it('卸载时 stopWaiting() 释放持续态，避免离课后残留 waiting loop', async () => {
    const wrapper = await mountAvatar('listening')
    const el = wrapper.find('agent-robot-avatar').element as unknown as MockAgentAvatar
    const calls = el.calls
    wrapper.unmount()
    expect(calls.filter((c) => c === 'stopWaiting').length).toBeGreaterThanOrEqual(1)
  })
})
