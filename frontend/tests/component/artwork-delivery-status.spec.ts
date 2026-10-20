import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import { http } from '@/api/http'
import * as service from '@/services/studentArtwork'
import ArtworkReviewPanel from '@/components/classroom/operations/ArtworkReviewPanel.vue'

const student = { id: 99001, classId: 99001, studentNo: 'SYNTH', name: '合成学生', nickname: '合成学生', status: 'active', createdAt: '', updatedAt: '' }
const artwork = { id: 99001, studentId: 99001, classId: 99001, classroomRunId: 99001, lessonStepIndex: 0, teacherId: 99001, teacherName: '合成教师', fileUrl: '', mimeType: 'image/png', originalName: 'synthetic.png', aiDraft: null, teacherComment: null, confirmedAt: null, createdAt: '' }
const consents = ['photo', 'artwork'].map((consentType, id) => ({ id, studentId: 99001, consentType, status: 'granted' }))
function receipt(requestId: string, channel: string, status = 'success') {
  return { requestId: `${requestId}:${channel === 'display' ? 'display' : 'tts'}`, runId: 99001, targetDeviceId: 99001, operation: channel === 'display' ? 'display_artwork' : 'speak_text', status, classroomState: null,
    result: { retained: true }, recovery: { refreshRequired: true } }
}
async function prepare(confirm = true) {
  const wrapper = mount(ArtworkReviewPanel, { props: { backendReady: true, runId: 99001, deviceId: 99001, runVersion: 7, lessonStepIndex: 0, students: [student] }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  Object.defineProperty(wrapper.get('input[type=file]').element, 'files', { value: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })] })
  await wrapper.get('input[type=file]').trigger('change')
  await wrapper.get('button.button').trigger('click'); await flushPromises()
  if (confirm) {
    await wrapper.findAll('button').find(b => b.text() === '确认并保存')!.trigger('click'); await flushPromises()
  }
  return wrapper
}
describe('artwork command submission is not device playback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(platformApi, 'consents').mockResolvedValue({ data: consents } as never)
    vi.spyOn(service, 'uploadStudentArtwork').mockResolvedValue(artwork)
    vi.spyOn(service, 'generateArtworkAiDraft').mockResolvedValue({ aiDraft: '合成评价' })
    vi.spyOn(service, 'confirmArtworkReview').mockResolvedValue({ teacherComment: '合成评价', confirmedAt: '2026-10-19T00:00:00Z' })
  })
  it.each([
    ['success', 'success', '命令已提交', '命令已提交'],
    ['success', 'failure', '命令已提交', '服务端返回失败'],
    ['failure', 'success', '服务端返回失败', '命令已提交'],
    ['failure', 'failure', '服务端返回失败', '服务端返回失败'],
    ['processing', 'processing', '提交结果未知', '提交结果未知'],
  ])('reports independently from durable command records: %s/%s', async (display, speech, displayText, speechText) => {
    const post = vi.spyOn(service, 'deliverArtworkReview').mockRejectedValue(new Error('response lost'))
    vi.spyOn(http, 'get').mockImplementation(async url => {
      const id = decodeURIComponent(String(url).split('/').at(-1)!)
      const channel = id.endsWith(':display') ? 'display' : 'speech'
      return { data: { ...receipt(id.slice(0, id.lastIndexOf(':')), channel, channel === 'display' ? display : speech), classroomRunId: 99001 } } as never
    })
    const wrapper = await prepare()
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.delivery-result').text()).toContain(`作品展示：${displayText}；评价朗读：${speechText}`)
    expect(wrapper.text()).toContain('实际展示和朗读未确认')
    expect(wrapper.text()).not.toMatch(/已送达|已播放完成|已投递到/)
    await wrapper.findAll('button').find(b => b.text().includes('只查询命令结果'))!.trigger('click'); await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('offline device still means only two commands submitted, including a recovery envelope', async () => {
    vi.spyOn(service, 'deliverArtworkReview').mockImplementation(async payload => ({ display: receipt(payload.requestId, 'display'), speech: receipt(payload.requestId, 'speech') }))
    const wrapper = await prepare()
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.delivery-result').text()).toContain('作品展示：命令已提交；评价朗读：命令已提交')
    expect(wrapper.text()).toContain('无设备 ACK')
    expect(wrapper.text()).not.toMatch(/已送达|已播放完成/)
  })
  it('unknown timeout and missing receipts do not auto resend or claim failure', async () => {
    const post = vi.spyOn(service, 'deliverArtworkReview').mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
    vi.spyOn(http, 'get').mockRejectedValue(new Error('not found'))
    const wrapper = await prepare()
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.delivery-result').text()).toContain('作品展示：提交结果未知；评价朗读：提交结果未知')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('a later failed read cannot erase an already confirmed submission', async () => {
    vi.spyOn(service, 'deliverArtworkReview').mockImplementation(async payload => ({ display: receipt(payload.requestId, 'display'), speech: receipt(payload.requestId, 'speech') }))
    vi.spyOn(http, 'get').mockRejectedValue(new Error('read unavailable'))
    const wrapper = await prepare()
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    await wrapper.findAll('button').find(b => b.text().includes('只查询命令结果'))!.trigger('click'); await flushPromises()
    expect(wrapper.get('.delivery-result').text()).toContain('作品展示：命令已提交；评价朗读：命令已提交')
  })
  it('explains revoked consent without erasing an already committed display', async () => {
    vi.spyOn(service, 'deliverArtworkReview').mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { code: 'ARTWORK_CONSENT_REQUIRED' } } })
    vi.spyOn(http, 'get').mockImplementation(async url => {
      const id = decodeURIComponent(String(url).split('/').at(-1)!)
      if (!id.endsWith(':display')) throw Error('no speech command')
      return { data: receipt(id.slice(0, -8), 'display') } as never
    })
    const wrapper = await prepare()
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('作品授权已撤销')
    expect(wrapper.get('.delivery-result').text()).toContain('作品展示：命令已提交；评价朗读：提交结果未知')
  })
  it('requires confirmation and rechecks consent before submitting', async () => {
    const post = vi.spyOn(service, 'deliverArtworkReview')
    const wrapper = await prepare(false)
    expect(wrapper.findAll('button').some(b => b.text() === '在大屏展示并朗读')).toBe(false)
    await wrapper.findAll('button').find(b => b.text() === '确认并保存')!.trigger('click'); await flushPromises()
    vi.mocked(platformApi.consents).mockResolvedValue({ data: [] } as never)
    await wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!.trigger('click'); await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('未发送展示或朗读命令')
  })
  it('repeated clicks while pending or after an unknown result submit once', async () => {
    let finish!: (value: { display: unknown; speech: unknown }) => void
    const post = vi.spyOn(service, 'deliverArtworkReview').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.spyOn(http, 'get').mockRejectedValue(new Error('missing'))
    const wrapper = await prepare()
    const button = wrapper.findAll('button').find(b => b.text() === '在大屏展示并朗读')!
    await button.trigger('click'); await button.trigger('click'); await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    finish({ display: {}, speech: {} }); await flushPromises()
    await button.trigger('click'); await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('does not invent ACKs from truthy values or mismatched command identity', () => {
    const context = { requestId: 'q', runId: 99001, deviceId: 99001 }
    expect(service.artworkDeliveryStatus({ display: {}, speech: true }, context)).toEqual({ display: 'unknown', speech: 'unknown' })
    expect(service.artworkCommandSubmission(receipt('old', 'display'), context, 'display')).toBe('unknown')
    expect(service.artworkCommandSubmission({ ...receipt('q', 'display'), targetDeviceId: 3 }, context, 'display')).toBe('unknown')
  })
})
