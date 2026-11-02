import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import LivePresentationPreview from '@/components/classroom/LivePresentationPreview.vue'
const state = vi.hoisted(() => ({ command: vi.fn() }))
const run = reactive({ status: 'running', currentStepIndex: 0, version: 2, playerRecoverySuggestion: { presentationMode: 'avatar', operation: 'set_presentation', childQaStepIndex: 0, childQaRunVersion: 2, childQaQuestionText: '芽需要水吗', childQaAnswerStatus: 'pending', ttsText: '未经审核的答案' } })
vi.mock('@/stores/lessonRun', () => ({ useLessonRunStore: () => ({ run, teacherCommand: state.command }) }))
vi.mock('@/stores/courseResource', () => ({ useCourseResourceStore: () => ({ ensureResourceById: vi.fn() }) }))
vi.mock('@/composables/usePresentationQueue', () => ({ usePresentationQueue: () => ({ canShow: false, canPause: false, canResume: false, previousItem: null, nextItem: null, saving: false, show: state.command, media: state.command }) }))
describe('teacher preview isolation', () => {
 it('folding keeps the avatar mounted and never issues a classroom command; only approved current answer is visible', async () => {
  const wrapper = mount(LivePresentationPreview, { global: { stubs: { DigitalHumanStage: { template: '<div data-test="avatar">avatar</div>' }, ProtectedResourceImage: true, ElButton: { template: '<button><slot /></button>' } } } })
  expect(wrapper.text()).toContain('等待教师确认')
  expect(wrapper.text()).not.toContain('未经审核的答案')
  const avatar = wrapper.get('[data-test="avatar"]').element
  await wrapper.get('[data-test="preview-toggle"]').trigger('click')
  expect(wrapper.get('.stage').attributes('style')).toContain('display: none')
  expect(wrapper.get('[data-test="avatar"]').element).toBe(avatar)
  expect(state.command).not.toHaveBeenCalled()
  await wrapper.get('[data-test="preview-toggle"]').trigger('click')
  run.playerRecoverySuggestion.operation = 'speak_text'
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).toContain('未经审核的答案')
  run.version = 3
  await wrapper.vm.$nextTick()
  expect(wrapper.find('.qa-caption').exists()).toBe(false)
  wrapper.unmount()
 })
})
