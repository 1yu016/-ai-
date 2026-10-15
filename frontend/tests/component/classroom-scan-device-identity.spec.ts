import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ classes: vi.fn(), classDeviceBindings: vi.fn(), createTicket: vi.fn(), heartbeat: vi.fn() }))
vi.mock('@/api/platform', () => ({ platformApi: api }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,preview') } }))
import ClassroomScanView from '@/views/ClassroomScanView.vue'

describe('scan preparation is not device identity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.classes.mockResolvedValue({ data: { items: [{ id: 1, name: '小班' }] } })
    api.classDeviceBindings.mockResolvedValue({ data: [{ id: 1, classId: 1, classroomId: 1, deviceId: 1, classroom: { name: '教室' }, device: { id: 1, name: '大屏', type: 'classroom_screen', status: 'offline', deviceCode: 'A' } }] })
    api.createTicket.mockResolvedValue({ data: { ticket: 'ticket', deviceCode: 'A', expiresAt: new Date(Date.now() + 120000).toISOString() } })
    api.heartbeat.mockClear()
  })
  afterEach(() => vi.useRealTimers())
  async function selectDevice() {
    const wrapper = mount(ClassroomScanView, { global: { stubs: { ManagementLayout: { template: '<div><slot /></div>' } } } })
    await flushPromises()
    await wrapper.findAll('select')[0]!.setValue('1'); await flushPromises()
    await wrapper.findAll('select')[1]!.setValue('1'); await flushPromises()
    await wrapper.findAll('select')[2]!.setValue('1'); await flushPromises()
    return wrapper
  }
  it('selecting a device and waiting does not send teacher heartbeats or fabricate online', async () => {
    const wrapper = await selectDevice()
    await vi.advanceTimersByTimeAsync(60000)
    expect(api.heartbeat).not.toHaveBeenCalled()
    expect(wrapper.findAll('select')[2]!.text()).toContain('offline')
    expect(wrapper.find('a[href="/classroom/screen/1"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('QR creation still uses the formal ticket API without making a device online', async () => {
    const wrapper = await selectDevice()
    const create = wrapper.findAll('button').find(button => button.text() === '生成扫码二维码')!
    await create.trigger('click'); await flushPromises()
    expect(api.createTicket).toHaveBeenCalledWith({ classId: 1, classroomId: 1, deviceId: 1, expiresInSeconds: 120 })
    expect(wrapper.find('img[alt="教师扫码进入课堂二维码"]').exists()).toBe(true)
    expect(api.heartbeat).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
