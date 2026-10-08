import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AttendancePanel from '@/components/classroom/operations/AttendancePanel.vue'

const students = [
  { id: 1, classId: 10, studentNo: 'S001', name: '安安', nickname: '安安', status: 'active' },
  { id: 2, classId: 10, studentNo: 'S002', name: '贝贝', nickname: null, status: 'active' },
] as never

function factory(overrides: Record<string, unknown> = {}) {
  return mount(AttendancePanel, {
    props: {
      students,
      attendance: {},
      selectedStudent: null,
      rollMessage: '',
      voiceCandidates: [],
      voiceTranscript: '',
      voiceBusy: false,
      voiceRecording: false,
      ...overrides,
    },
  })
}

describe('AttendancePanel formal attendance controls', () => {
  it('shows all four states and emits manual and specified operations', async () => {
    const wrapper = factory()
    expect(wrapper.text()).toContain('到课')
    expect(wrapper.text()).toContain('缺勤')
    expect(wrapper.text()).toContain('迟到')
    expect(wrapper.text()).toContain('请假')
    const rowButtons = wrapper.findAll('.student-row .row-actions button')
    await rowButtons[3]!.trigger('click')
    expect(wrapper.emitted('set-attendance')?.[0]).toEqual([students[0], 'leave'])
    await rowButtons[4]!.trigger('click')
    expect(wrapper.emitted('specified-roll')?.[0]).toEqual([students[0]])
  })

  it('builds batch and group requests from selected students', async () => {
    const wrapper = factory()
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await wrapper.find('.batch-bar .soft').trigger('click')
    expect(wrapper.emitted('batch-attendance')?.[0]).toEqual([
      [{ studentId: 1, status: 'present' }],
    ])
    await wrapper.find('.head-actions .soft').trigger('click')
    expect(wrapper.emitted('group-roll')?.[0]).toEqual([[1]])
  })

  it('keeps voice results as candidates until teacher confirmation', async () => {
    const wrapper = factory({
      voiceTranscript: '安安到了，贝贝请假',
      voiceCandidates: [
        { studentId: 1, displayName: '安安', status: 'present', confidence: 0.9 },
        { studentId: 2, displayName: '贝贝', status: 'leave', confidence: 0.9 },
      ],
    })
    expect(wrapper.emitted('confirm-voice')).toBeUndefined()
    await wrapper.find('.voice-review .button').trigger('click')
    expect(wrapper.emitted('confirm-voice')?.[0]).toEqual([[
      { studentId: 1, status: 'present' },
      { studentId: 2, status: 'leave' },
    ]])
  })

  it('uses press and release events for teacher-controlled recording', async () => {
    const wrapper = factory()
    const button = wrapper.find('.voice-button')
    await button.trigger('pointerdown')
    await button.trigger('pointerup')
    expect(wrapper.emitted('start-voice')).toHaveLength(1)
    expect(wrapper.emitted('stop-voice')).toHaveLength(1)
  })
})
