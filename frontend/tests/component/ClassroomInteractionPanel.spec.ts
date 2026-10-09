import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as checkpointService from '@/services/classroomCheckpoint'
import type { LessonRun } from '@/stores/lessonRun'
import ClassroomInteractionPanel from '@/components/classroom/operations/ClassroomInteractionPanel.vue'
import type { Student } from '@/api/platform'

const students: Student[] = [
  { id: 1, classId: 1, studentNo: 'XB-001', name: '朵朵', nickname: '朵朵', status: 'active', createdAt: '', updatedAt: '' },
  { id: 2, classId: 1, studentNo: 'XB-002', name: '明明', nickname: '明明', status: 'active', createdAt: '', updatedAt: '' },
  { id: 3, classId: 1, studentNo: 'XB-003', name: '已停用', nickname: '已停用', status: 'disabled', createdAt: '', updatedAt: '' },
]

function makeRun(status: LessonRun['status'] = 'running'): LessonRun {
  return {
    id: 9, lessonPlanId: 3, classId: 1, deviceId: 1, version: 2, status,
    currentStepIndex: 0, lessonTitle: '小忍者', lessonObjectives: '', ageGroup: '',
    steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '', durationSeconds: 300, resourceId: null }],
    startedAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
  }
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(ClassroomInteractionPanel, {
    props: {
      run: makeRun(),
      students,
      selectedStudentId: null,
      busy: false,
      disabled: false,
      rewardTotal: 0,
      ...overrides,
    },
    global: { plugins: [ElementPlus, createPinia()] },
  })
}

describe('ClassroomInteractionPanel 课堂互动（点名 + 快速奖励）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    // 桌面宽屏：面板默认展开（<1280 才折叠）。
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1440,
    })
  })

  it('running 时显示点名入口', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('随机点名')
  })

  it('加载当前班真实学生：下拉来自传入的 students prop', () => {
    const wrapper = mountPanel()
    const options = wrapper.findAll('.i-select option').map((o) => o.text())
    expect(options).toContain('朵朵')
    expect(options).toContain('明明')
    // 停用学生不进入点名/选择范围
    expect(options).not.toContain('已停用')
  })

  it('随机点名只能从当前班学生中选择', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    const wrapper = mountPanel()
    wrapper.find('.row-line .mini').trigger('click')
    await flushPromises()
    const got = wrapper.emitted('update:selectedStudentId')
    expect(got).toBeTruthy()
    const pickedId = got![0]![0] as number
    expect(students.some((s) => s.id === pickedId && s.status !== 'disabled')).toBe(true)
    const rolled = wrapper.emitted('random-roll')
    expect(rolled![0]![0]).toMatchObject({ id: pickedId })
    rand.mockRestore()
  })

  it('手动选择学生后 current student 更新', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.i-select').setValue('2')
    await flushPromises()
    expect(wrapper.emitted('update:selectedStudentId')).toEqual([[2]])
    // 父级 v-model 回写 prop 后，当前幼儿显示同步更新。
    await wrapper.setProps({ selectedStudentId: 2 })
    await flushPromises()
    expect(wrapper.find('.i-current').text()).toBe('明明')
  })

  it('没有选择学生时不能发奖励', async () => {
    const postSpy = vi.spyOn(checkpointService, 'postReward')
    const wrapper = mountPanel({ selectedStudentId: null })
    expect(wrapper.find('.i-add').attributes('disabled')).toBeDefined()
    await wrapper.find('.i-add').trigger('click')
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('选中朵朵 + 原因“积极回答” → POST rewards 且参数正确', async () => {
    const postSpy = vi
      .spyOn(checkpointService, 'postReward')
      .mockResolvedValue({ record: sparkleRecord(1), rewardState: {}, studentTotal: 1 })
    const wrapper = mountPanel({ selectedStudentId: 1 })
    await wrapper.find('.i-add').trigger('click')
    await flushPromises()
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy).toHaveBeenCalledWith(makeRun(), 1, 1, '积极回答')
  })

  it('POST 成功：emit rewarded，提示成功，本节计数由 parent 通过 prop 同步', async () => {
    vi.spyOn(checkpointService, 'postReward').mockResolvedValue({
      record: sparkleRecord(1), rewardState: {}, studentTotal: 1,
    })
    const wrapper = mountPanel({ selectedStudentId: 1, rewardTotal: 4 })
    expect(wrapper.find('.i-count').text()).toContain('本节 4')
    await wrapper.find('.i-add').trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('rewarded')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatchObject({ studentId: 1, stars: 1 })
    expect(wrapper.find('[data-test="message"]').text()).toContain('已奖励朵朵 1 朵小红花')
  })

  it('POST 失败：不 emit rewarded，总数不 +1', async () => {
    vi.spyOn(checkpointService, 'postReward').mockRejectedValue(new Error('奖励失败，请重试。'))
    const wrapper = mountPanel({ selectedStudentId: 1, rewardTotal: 4 })
    await wrapper.find('.i-add').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('rewarded')).toBeUndefined()
    expect(wrapper.find('[data-test="error"]').text()).toContain('奖励失败，请重试')
  })

  it('POST 失败：当前选中幼儿仍保留（奖励按钮仍可用）', async () => {
    vi.spyOn(checkpointService, 'postReward').mockRejectedValue(new Error('奖励失败，请重试。'))
    const wrapper = mountPanel({ selectedStudentId: 1 })
    await wrapper.find('.i-add').trigger('click')
    await flushPromises()
    expect(wrapper.find('.i-add').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.i-current').text()).toBe('朵朵')
  })

  it.each([
    ['paused', 'paused'],
    ['completed', 'completed'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
  ] as const)('%s：按钮禁用', (label, status) => {
    const wrapper = mountPanel({ run: makeRun(status), selectedStudentId: 1, disabled: true })
    expect(wrapper.find('.i-add').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.row-line .mini').attributes('disabled')).toBeDefined()
  })

  it('break active（status 仍 running 但 disabled=true）：按钮禁用', () => {
    const wrapper = mountPanel({ run: makeRun('running'), selectedStudentId: 1, disabled: true })
    expect(wrapper.find('.i-add').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.row-line .mini').attributes('disabled')).toBeDefined()
  })

  it('不产生新的 localStorage / mock 状态', async () => {
    const wrapper = mountPanel({ selectedStudentId: 1 })
    expect(Object.keys(localStorage).length).toBe(0)
    await wrapper.find('.i-add').trigger('click')
    await flushPromises()
    expect(Object.keys(localStorage).length).toBe(0)
  })
})

function sparkleRecord(studentId: number): checkpointService.RewardRecord {
  return {
    id: 100, studentId, studentName: '朵朵', classId: 1, classroomRunId: 9,
    teacherId: 1, teacherName: '王雪梅', rewardType: 'star', stars: 1,
    reason: '积极回答', requestId: 'reward-x', createdAt: '2026-10-02T15:00:00.000Z',
  }
}