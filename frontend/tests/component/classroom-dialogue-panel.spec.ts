import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import ClassroomDialoguePanel from '@/components/classroom/ClassroomDialoguePanel.vue'
import { speakBrowserText, stopBrowserSpeech } from '@/services/browserSpeech'
import { streamClassroomDialogue } from '@/services/classroomDialogue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

vi.mock('@/services/classroomDialogue', () => ({ streamClassroomDialogue: vi.fn(async () => ({ route: 'question', reply: '合成回答。' })) }))
vi.mock('@/services/browserSpeech', () => ({ speakBrowserText: vi.fn((_text, options) => {
  options?.signal?.addEventListener('abort', () => { stopBrowserSpeech(); options.onCancel?.() }, { once: true })
  return true
}), stopBrowserSpeech: vi.fn() }))
afterEach(() => vi.clearAllMocks())
it('one opt-in auto answers ordinary questions, cancels queued speech on pause, invalidates old events, and never resumes automatically', async () => {
  const pinia = createPinia()
  const wrapper = mount(ClassroomDialoguePanel, { props: { identity: 'run1:0', allowed: true, speaking: false, runId: 1, stepIndex: 0 }, global: { plugins: [pinia] } })
  const checkboxes = wrapper.findAll('input[type="checkbox"]')
  await checkboxes[0]!.setValue(true); await checkboxes[1]!.setValue(true)
  await wrapper.get('[aria-label="手动课堂问题"]').setValue('为什么下雨？')
  await wrapper.findAll('button').find(button => button.text() === '向数字人提问')!.trigger('click'); await flushPromises()
  expect(streamClassroomDialogue).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('合成回答。'); expect(speakBrowserText).toHaveBeenCalledTimes(1)
  // Still synthesizing/not started: teacher must already be able to cancel.
  expect(wrapper.findAll('button').some(button => button.text() === '停止回答与朗读')).toBe(true)
  const callbacks = vi.mocked(speakBrowserText).mock.calls[0]![1]!
  callbacks.onStart?.()
  expect(useDigitalHumanStore(pinia).isSpeaking).toBe(true)
  await wrapper.setProps({ allowed: false })
  expect(stopBrowserSpeech).toHaveBeenCalled(); expect(useDigitalHumanStore(pinia).isSpeaking).toBe(false)
  await wrapper.setProps({ allowed: true })
  callbacks.onStart?.()
  expect(useDigitalHumanStore(pinia).isSpeaking).toBe(false)
  expect(speakBrowserText).toHaveBeenCalledTimes(1)
  expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(false)
  await wrapper.setProps({ identity: 'run2:0', runId: 2 })
  expect(wrapper.find('[data-test="dialogue-reply"]').exists()).toBe(false)
  wrapper.unmount()
})
