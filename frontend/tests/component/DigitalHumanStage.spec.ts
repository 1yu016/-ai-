import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

// jsdom 无 WebGL → webglSupported 为 false，组件走 2D 备用形象，不触发 three 的 3D 挂载
describe('DigitalHumanStage container', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders the 2D fallback avatar when WebGL is unavailable', async () => {
    const wrapper = mount(DigitalHumanStage)
    await flushPromises()
    expect(wrapper.find('.avatar').exists()).toBe(true)
    expect(wrapper.text()).toContain('准备好一起学习啦')
    expect(wrapper.find('.role-name').exists()).toBe(true)
  })

  it('clicking the role button switches to listen action (whitelisted)', async () => {
    const store = useDigitalHumanStore()
    const wrapper = mount(DigitalHumanStage)
    await wrapper.find('.role-name').trigger('click')
    expect(store.action).toBe('listen')
    expect(wrapper.text()).toContain('我在认真听哦')
  })

  it('shows the 2D avatar when the 3D model transitions to error even if WebGL exists', async () => {
    const store = useDigitalHumanStore()
    store.setWebglSupported(true)
    store.setModelState('error')
    const wrapper = mount(DigitalHumanStage)
    await flushPromises()
    expect(wrapper.find('.avatar').exists()).toBe(true)
  })

  it('renders speech text for the talk action', () => {
    const store = useDigitalHumanStore()
    store.setAction('talk')
    const wrapper = mount(DigitalHumanStage)
    expect(wrapper.text()).toContain('我来和你说一说')
  })

  it('unmounts the stage without throwing', () => {
    const wrapper = mount(DigitalHumanStage)
    wrapper.unmount()
  })
})