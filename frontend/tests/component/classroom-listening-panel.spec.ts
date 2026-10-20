import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import ClassroomListeningPanel from '@/components/classroom/ClassroomListeningPanel.vue'

it('manual questions only prepare a route and clear their draft when classroom identity changes', async () => {
  const wrapper = mount(ClassroomListeningPanel, { props: { identity: 'run-1', allowed: true, speaking: false }, global: { plugins: [createPinia()] } })
  await wrapper.get('[aria-label="手动课堂问题"]').setValue('为什么会下雨？')
  await wrapper.findAll('button').find(button => button.text() === '提交问题供老师查看')!.trigger('click')
  expect(wrapper.emitted('question')).toEqual([['为什么会下雨？']])
  await wrapper.setProps({ identity: 'run-2' })
  expect(wrapper.emitted('reset')).toHaveLength(1)
  expect(wrapper.find('[data-route-kind]').exists()).toBe(false)
  await wrapper.setProps({ allowed: false })
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  wrapper.unmount()
})
it('a real-ASR build flag alone cannot enable continuous classroom cloud upload', async () => {
  vi.stubEnv('VITE_CLASSROOM_REAL_ASR', 'true')
  const capture = vi.fn()
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: capture } })
  const wrapper = mount(ClassroomListeningPanel, { props: { identity: 'r1', allowed: true, speaking: false }, global: { plugins: [createPinia()] } })
  try {
    await wrapper.findAll('button').find(button => button.text() === '开启课堂互动')!.trigger('click')
    await Promise.resolve(); await Promise.resolve()
    expect(wrapper.text()).toContain('云端持续监听暂不可用')
    expect(capture).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').find(button => button.text() === '提交问题供老师查看')!.attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="手动课堂问题"]').setValue('为什么下雨？')
    await wrapper.findAll('button').find(button => button.text() === '提交问题供老师查看')!.trigger('click')
    expect(wrapper.emitted('question')).toEqual([['为什么下雨？']])
  } finally {
    wrapper.unmount(); vi.unstubAllEnvs()
    if (original) Object.defineProperty(navigator, 'mediaDevices', original)
    else Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})
