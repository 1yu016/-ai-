import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BreakModePanel from '@/components/classroom/operations/BreakModePanel.vue'

describe('BreakModePanel 课间面板', () => {
  it('未课间时先选择内容，再发射 3/5/10 分钟的完整配置', async () => {
    const wrapper = mount(BreakModePanel, {
      props: { active: false, remainingSeconds: 0, busy: false, canStart: true },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toContain('🎵律动')
    await buttons.find((b) => b.text().includes('律动'))!.trigger('click')
    await buttons.find((b) => b.text() === '3 分钟')!.trigger('click')
    await buttons.find((b) => b.text() === '5 分钟')!.trigger('click')
    await buttons.find((b) => b.text() === '10 分钟')!.trigger('click')
    expect(wrapper.emitted('start-break')).toEqual([
      [{ durationSeconds: 180, contentType: 'movement', idleProtectionSeconds: 120 }],
      [{ durationSeconds: 300, contentType: 'movement', idleProtectionSeconds: 120 }],
      [{ durationSeconds: 600, contentType: 'movement', idleProtectionSeconds: 120 }],
    ])
  })

  it('canStart=false（非 running 课堂）时三档按钮禁用', () => {
    const wrapper = mount(BreakModePanel, {
      props: { active: false, remainingSeconds: 0, busy: false, canStart: false },
    })
    wrapper.findAll('button').forEach((b) => {
      expect(b.attributes('disabled')).toBeDefined()
    })
  })

  it('课间中显示按 breakEndsAt 计算的倒计时与“提前结束课间”，点击发射 end-break', async () => {
    const wrapper = mount(BreakModePanel, {
      props: { active: true, remainingSeconds: 272, busy: false, canStart: false },
    })
    expect(wrapper.find('[data-test="break-countdown"]').text()).toBe('04:32')
    expect(wrapper.text()).toContain('提前结束课间')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('end-break')).toBeTruthy()
  })
})
