import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import ClassRewardLeaderboard from '@/components/classroom/operations/ClassRewardLeaderboard.vue'
import type { RewardLeaderboardItem } from '@/api/platform'

const make = (n: number): RewardLeaderboardItem[] =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    studentId: i + 1,
    studentName: `学生${i + 1}`,
    totalStars: 20 - i,
  }))

function mountLB(props: Record<string, unknown> = {}) {
  return mount(ClassRewardLeaderboard, {
    props: { items: [], loading: false, error: '', ...props },
  })
}

describe('ClassRewardLeaderboard 班级 Top5 排行榜（纯展示）', () => {
  beforeEach(() => {
    // 宽屏：组件默认展开 Top5。
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1440,
    })
  })

  it('#1 Top5 正确显示（名次/姓名/星数）', () => {
    const wrapper = mountLB({ items: make(5) })
    const items = wrapper.findAll('[data-test="lb-list"] li')
    expect(items).toHaveLength(5)
    expect(wrapper.find('[data-test="lb-rank-1"] .lb-name').text()).toBe('学生1')
    expect(wrapper.find('[data-test="lb-rank-1"] .lb-stars').text()).toBe('🌟 20')
    expect(wrapper.find('[data-test="lb-rank-5"] .lb-name').text()).toBe('学生5')
  })

  it('#2 / #4 只显示最多 5 人，不存在第 6 名', () => {
    const wrapper = mountLB({ items: make(6) })
    const items = wrapper.findAll('[data-test="lb-list"] li')
    expect(items).toHaveLength(5)
    expect(wrapper.find('[data-test="lb-rank-6"]').exists()).toBe(false)
  })

  it('#3 按 backend 返回顺序展示（rank 1..5）', () => {
    const wrapper = mountLB({ items: make(5) })
    const names = wrapper.findAll('.lb-name').map((n) => n.text())
    expect(names).toEqual(['学生1', '学生2', '学生3', '学生4', '学生5'])
    const ranks = wrapper.findAll('.lb-rank').map((r) => r.text())
    expect(ranks).toEqual(['1', '2', '3', '4', '5'])
  })

  it('#9 empty：已成功加载但没有记录 → “还没有奖励记录”', () => {
    const wrapper = mountLB({ items: [], loading: false, error: '' })
    expect(wrapper.find('[data-test="lb-empty"]').text()).toContain('还没有奖励记录')
  })

  it('#10 error：接口失败 → “排行榜加载失败” + 重试按钮，点击触发 retry', async () => {
    const wrapper = mountLB({ error: '排行榜加载失败' })
    expect(wrapper.find('[data-test="lb-error"]').text()).toContain('排行榜加载失败')
    await wrapper.find('[data-test="lb-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toBeTruthy()
  })

  it('#11 loading：榜单加载中...', () => {
    const wrapper = mountLB({ loading: true })
    expect(wrapper.find('[data-test="lb-loading"]').text()).toContain('榜单加载中')
  })

  it('#13 窄屏折叠成“🏆 榜单”，点击展开后显示 Top5', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
    const wrapper = mountLB({ items: make(2) })
    expect(wrapper.find('[data-test="lb-collapsed"]').text()).toContain('🏆 榜单')
    await wrapper.find('[data-test="lb-collapsed"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="lb-list"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="lb-list"] li')).toHaveLength(2)
  })

  it('#14 无 hardcoded：渲染完全来自 items prop（自定义姓名/分数/学号）', () => {
    const items: RewardLeaderboardItem[] = [
      { rank: 1, studentId: 9, studentName: '壮壮', totalStars: 19 },
      { rank: 2, studentId: 1, studentName: '朵朵', totalStars: 13 },
    ]
    const wrapper = mountLB({ items })
    expect(wrapper.findAll('[data-test="lb-list"] li')).toHaveLength(2)
    expect(wrapper.find('[data-test="lb-rank-1"] .lb-name').text()).toBe('壮壮')
    expect(wrapper.find('[data-test="lb-rank-1"] .lb-stars').text()).toBe('🌟 19')
    expect(wrapper.find('[data-test="lb-rank-2"] .lb-name').text()).toBe('朵朵')
    expect(wrapper.find('[data-test="lb-rank-2"] .lb-stars').text()).toBe('🌟 13')
  })
})