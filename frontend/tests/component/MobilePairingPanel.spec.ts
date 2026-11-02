import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import MobilePairingPanel from '@/components/classroom/MobilePairingPanel.vue'
import ClassroomMobileDrawer from '@/components/classroom/ClassroomMobileDrawer.vue'
import { platformApi } from '@/api/platform'
import { http } from '@/api/http'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,test') } }))
const context = { classId: 3, classroomId: 4, deviceId: 5, runId: 6, title: '观察春天' }
const active = { id: 6, classId: 3, deviceId: 5, status: 'running' }
const ticket = () => ({ data: { ticket: 'one-time-ticket', deviceCode: 'screen-code', expiresAt: new Date(Date.now() + 120000).toISOString() } })
const wrappers: ReturnType<typeof mount>[] = []
function panel(autoCreate = false) { const wrapper = mount(MobilePairingPanel, { props: { ...context, autoCreate } }); wrappers.push(wrapper); return wrapper }
beforeEach(() => {
  vi.stubEnv('VITE_LAN_APP_URL', 'http://10.0.0.10:5591')
  vi.spyOn(http, 'get').mockResolvedValue({ data: active } as never)
  vi.spyOn(platformApi, 'createTicket').mockResolvedValue(ticket() as never)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('current classroom mobile pairing', () => {
  it('uses the existing ticket API with the current classroom and a LAN URL without login tokens', async () => {
    const wrapper = panel()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(platformApi.createTicket).toHaveBeenCalledWith({ classId: 3, classroomId: 4, deviceId: 5, lessonRunId: 6, expiresInSeconds: 120 })
    const url = new URL(vi.mocked(QRCode.toDataURL).mock.calls.at(-1)![0] as string)
    expect(url.origin).toBe('http://10.0.0.10:5591')
    expect(url.pathname).toBe('/classroom/join')
    expect([...url.searchParams.keys()].sort()).toEqual(['deviceCode', 'ticket'])
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.text()).toContain('仅可使用一次')
    expect(wrapper.text()).not.toContain('已连接手机')
  })

  it('generates the current classroom QR on opening without an extra teacher click', async () => {
    const wrapper = panel(true); await flushPromises()
    expect(platformApi.createTicket).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('keeps the QR stable across classroom polling and pause, and closing does not revoke or end anything', async () => {
    vi.spyOn(platformApi, 'classDeviceBindings').mockResolvedValue({ data: [{ classId: 3, classroomId: 4, deviceId: 5, classroom: { name: '一号教室' }, device: { type: 'classroom_screen', name: '学生大屏' } }] } as never)
    vi.spyOn(platformApi, 'classDetail').mockResolvedValue({ data: { name: '中班' } } as never)
    const post = vi.spyOn(http, 'post')
    const run = { id: 6, classId: 3, deviceId: 5, status: 'running', lessonTitle: '观察春天' }
    const wrapper = mount(ClassroomMobileDrawer, { props: { modelValue: true, run }, global: { stubs: { ElDrawer: { template: '<div><slot /><slot name="footer" /></div>' } } } })
    wrappers.push(wrapper); await flushPromises()
    expect(platformApi.createTicket).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ run: { ...run } }); await flushPromises()
    await wrapper.setProps({ run: { ...run, status: 'paused' } }); await flushPromises()
    expect(platformApi.createTicket).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ modelValue: false }); await flushPromises()
    expect(post).not.toHaveBeenCalled()
  })

  it.each(['completed', 'cancelled'])('does not generate a ticket for an ended classroom (%s)', async status => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { ...active, status } } as never)
    const wrapper = panel(); await wrapper.get('button').trigger('click'); await flushPromises()
    expect(platformApi.createTicket).not.toHaveBeenCalled()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('已经结束')
  })

  it('rejects a different class or device without falling back to another classroom', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { ...active, deviceId: 99 } } as never)
    const wrapper = panel(); await wrapper.get('button').trigger('click'); await flushPromises()
    expect(platformApi.createTicket).not.toHaveBeenCalled()
  })

  it('ignores a late response after the teacher changes classroom', async () => {
    let resolve!: (result: never) => void
    vi.mocked(http.get).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const wrapper = panel(); await wrapper.get('button').trigger('click')
    await wrapper.setProps({ runId: 7 })
    resolve({ data: active } as never); await flushPromises()
    expect(platformApi.createTicket).not.toHaveBeenCalled()
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('shows authorization failure without a success QR', async () => {
    vi.mocked(platformApi.createTicket).mockRejectedValueOnce(new Error('无权连接此设备'))
    const wrapper = panel(); await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('hides an expired QR and does not generate a replacement automatically', async () => {
    vi.useFakeTimers()
    const wrapper = panel(); await wrapper.get('button').trigger('click'); await flushPromises()
    await vi.advanceTimersByTimeAsync(121000)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('二维码已过期')
    expect(platformApi.createTicket).toHaveBeenCalledTimes(1)
  })

  it('refuses to generate a phone QR pointing to localhost', async () => {
    vi.stubEnv('VITE_LAN_APP_URL', 'http://localhost:5591')
    const wrapper = panel()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(platformApi.createTicket).not.toHaveBeenCalled()
  })
})
