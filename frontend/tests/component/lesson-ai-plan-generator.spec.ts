import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, afterEach } from 'vitest'
import Generator from '@/components/lesson/LessonAiPlanGenerator.vue'
import { http } from '@/api/http'
function make() { return mount(Generator, { props: { modelValue: true, theme: '', ageGroup: '4-5', minutes: 25, objectives: '', hasUnsaved: false }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } }) }
afterEach(() => vi.restoreAllMocks())
describe('whole AI lesson generator', () => {
  it('validates before requesting and never creates a plan without teacher confirmation', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { id: 10, status: 'generated', output: { title: '种子课堂' } } })
    const w = make()
    await w.findAll('button').find(b => b.text().includes('生成完整'))!.trigger('click')
    expect(post).not.toHaveBeenCalled()
    await w.get('[aria-label="AI课程主题"]').setValue('种子发芽')
    await w.get('[aria-label="AI教学目标"]').setValue('认识发芽条件')
    await w.findAll('button').find(b => b.text().includes('生成完整'))!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/lesson-plans/ai-drafts', expect.objectContaining({ theme: '种子发芽', teachingObjectives: '认识发芽条件' }), expect.anything())
    expect(w.text()).toContain('种子课堂')
    expect(post).toHaveBeenCalledTimes(1)
    post.mockResolvedValueOnce({ data: { id: 22 } })
    await w.findAll('button').find(b => b.text().includes('确认创建'))!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/lesson-plans/ai-drafts/10/confirm', {})
    expect(w.emitted('created')).toEqual([[22]])
    w.unmount()
  })
  it('shows a provider failure without creating a fake draft or changing editor content', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(new Error('模型未配置'))
    const w = make()
    await w.get('[aria-label="AI课程主题"]').setValue('种子发芽')
    await w.get('[aria-label="AI教学目标"]').setValue('认识水分')
    await w.findAll('button').find(b => b.text().includes('生成完整'))!.trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('模型未配置')
    expect(w.emitted('created')).toBeUndefined()
    expect(w.text()).not.toContain('确认创建教案')
    w.unmount()
  })
})
