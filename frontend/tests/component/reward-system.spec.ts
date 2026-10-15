import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import RewardPanel from '@/components/classroom/operations/RewardPanel.vue'

const dashboard = {
  goal: { id: 3, title: '一起种出成长树', targetPoints: 20, currentPoints: 8, status: 'active' },
  totals: { points: 18, flowers: 7, categoryTotals: { cooperation: 6, exploration: 4 } },
  honors: [
    { key: 'today_star', title: '今日小明星', student: { studentId: 1, displayName: '朵朵' } },
    { key: 'cooperation_star', title: '合作之星', student: { studentId: 2, displayName: '乐乐' } },
  ],
  policy: { negativeRankingEnabled: false, rotation: 'daily_category_rotation' },
}

describe('奖励体系与班级成长乐园', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('展示共同目标、多维荣誉和正向说明，不渲染负面榜单', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: dashboard } as never)
    const wrapper = mount(RewardPanel, { props: { runId: 9, awardTotal: 0 }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('一起种出成长树')
    expect(wrapper.text()).toContain('8/20')
    expect(wrapper.text()).toContain('今日小明星')
    expect(wrapper.text()).toContain('合作之星')
    expect(wrapper.text()).toContain('不设置倒数榜单')
    expect(wrapper.text()).not.toContain('差生榜')
  })

  it('集体奖励写入正式接口并携带共同目标', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: dashboard } as never)
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { id: 5 } } as never)
    const wrapper = mount(RewardPanel, { props: { runId: 9, awardTotal: 0 }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('全班 +3'))!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/classroom-runs/9/collective-rewards', expect.objectContaining({
      requestId: expect.any(String), rewardCategory: 'cooperation', points: 3, goalId: 3,
    }))
  })
})
