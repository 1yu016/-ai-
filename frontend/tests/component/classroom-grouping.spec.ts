import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ElementPlus from 'element-plus'
import { http } from '@/api/http'
import Panel from '@/components/classroom/ClassroomGroupingPanel.vue'

const groups = [{ id: 3, name: '第1组', classroomRunId: 9, members: [{ id: 1, name: '合成幼儿' }] }]
beforeEach(() => vi.spyOn(http, 'get').mockResolvedValue({ data: { items: groups } } as never))
afterEach(() => vi.restoreAllMocks())
function create(allowed = true) {
  return mount(Panel, { props: { runId: 9, active: true, allowed }, global: { plugins: [ElementPlus] } })
}
it('shows saved groups and sends a new grouping through the existing API', async () => {
  const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { items: groups } } as never)
  const wrapper = create()
  await flushPromises()
  expect(wrapper.text()).toContain('合成幼儿')
  await wrapper.findAll('button').find(button => button.text().includes('生成随机小组'))!.trigger('click')
  await flushPromises()
  expect(post).toHaveBeenCalledWith('/classroom-runs/9/groups/random', expect.objectContaining({
    groupCount: 2, requestId: expect.any(String),
  }))
  expect(wrapper.text()).toContain('已完成随机分组')
  wrapper.unmount()
})
it('reuses the request after a network failure and blocks disallowed writes', async () => {
  const post = vi.spyOn(http, 'post')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ data: { items: groups } } as never)
  const wrapper = create()
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text().includes('生成随机小组'))!.trigger('click')
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text().includes('重试此次分组'))!.trigger('click')
  await flushPromises()
  expect(post.mock.calls[0]).toEqual(post.mock.calls[1])
  await wrapper.setProps({ allowed: false })
  const button = wrapper.findAll('button').find(button => button.text().includes('生成随机小组'))!
  expect(button.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
it('groups only the selected students from the attendance page', async () => {
  const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { items: groups } } as never)
  const wrapper = mount(Panel, {
    props: { runId: 9, active: true, allowed: true, studentIds: [1, 2, 3] },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('当前勾选的 3 名幼儿')
  await wrapper.findAll('button').find(button => button.text().includes('生成随机小组'))!.trigger('click')
  await flushPromises()
  expect(post.mock.calls[0]![1]).toMatchObject({ groupCount: 2, studentIds: [1, 2, 3] })
  wrapper.unmount()
})

it('keeps historic groups separate, clears stale retries when selection changes, and names each batch uniquely', async () => {
  const post = vi.spyOn(http, 'post').mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ data: { items: groups } } as never)
  const wrapper = mount(Panel, {
    props: { runId: 9, active: true, allowed: true, studentIds: [1, 2, 3, 4, 5, 6] },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  expect(wrapper.find('details').text()).toContain('合成幼儿')
  expect(wrapper.findAll('section > article')).toHaveLength(0)
  const click = async () => {
    await wrapper.findAll('button').find(button => /生成随机小组|重试此次分组/.test(button.text()))!.trigger('click')
    await flushPromises()
  }
  await click()
  await wrapper.setProps({ studentIds: [2, 3, 4, 5, 6] })
  await flushPromises()
  expect(wrapper.text()).not.toContain('重试此次分组')
  await click()
  const oldInput = post.mock.calls[0]![1] as {requestId: string; names: string[]}
  const input = post.mock.calls[1]![1] as {requestId: string; names: string[]; studentIds: number[]}
  expect(input.studentIds).toEqual([2, 3, 4, 5, 6])
  expect(input.requestId).not.toBe(oldInput.requestId)
  expect(input.names).not.toEqual(oldInput.names)
  expect(input.names[0]).not.toBe('第1组')
  wrapper.unmount()
})
