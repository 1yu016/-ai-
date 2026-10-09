import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceSessionApi } from '@/api/deviceSession'
import {
  DEVICE_SESSION_STORAGE_KEY,
  useDeviceSessionStore,
} from '@/stores/deviceSession'

const issued = {
  deviceId: 5,
  token: 'device-token-abc',
  id: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
}
const onlineResult = {
  deviceId: 5,
  online: true,
  status: 'online',
  lastOnlineAt: '2026-10-07T00:00:00.000Z',
}

describe('formal screen device-session heartbeat store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const ready = async () => {
    await vi.advanceTimersByTimeAsync(0)
  }

  it('issues a session and persists the raw token for later reuse', async () => {
    const store = useDeviceSessionStore()
    vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    const token = await store.issue(5)
    expect(token).toBe('device-token-abc')
    expect(store.tokens[5]).toBe('device-token-abc')
    const persisted = JSON.parse(localStorage.getItem(DEVICE_SESSION_STORAGE_KEY) || '{}')
    expect(persisted['5']).toBe('device-token-abc')
  })

  it('startHeartbeat issues once then beats immediately, flipping the device online', async () => {
    const store = useDeviceSessionStore()
    const issue = vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    const heartbeat = vi.spyOn(deviceSessionApi, 'heartbeat').mockResolvedValue({ data: onlineResult } as never)
    store.startHeartbeat(5)
    await ready()
    expect(issue).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledWith('device-token-abc')
    expect(store.online[5]).toBe(true)
    store.stopHeartbeat()
  })

  it('reuses an existing token instead of re-issuing on every page open', async () => {
    const store = useDeviceSessionStore()
    vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    await store.issue(5)
    const issueAgain = vi.spyOn(deviceSessionApi, 'issue').mockClear()
    const heartbeat = vi.spyOn(deviceSessionApi, 'heartbeat').mockResolvedValue({ data: onlineResult } as never)
    store.startHeartbeat(5)
    await ready()
    expect(issueAgain).not.toHaveBeenCalled()
    expect(heartbeat).toHaveBeenCalledWith('device-token-abc')
    store.stopHeartbeat()
  })

  it('re-issues after an invalid (401) credential is cleared', async () => {
    const store = useDeviceSessionStore()
    vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    await store.issue(5)
    const heartbeat = vi.spyOn(deviceSessionApi, 'heartbeat').mockRejectedValue({
      response: { status: 401 },
    })
    store.startHeartbeat(5)
    await ready()
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(store.tokens[5]).toBeUndefined()
    expect(store.online[5]).toBe(false)
    expect(JSON.parse(localStorage.getItem(DEVICE_SESSION_STORAGE_KEY) || '{}')['5']).toBeUndefined()

    const reissue = vi.spyOn(deviceSessionApi, 'issue').mockClear().mockResolvedValue({
      data: { ...issued, token: 'device-token-xyz' },
    } as never)
    heartbeat.mockResolvedValue({ data: onlineResult } as never)
    store.startHeartbeat(5)
    await ready()
    expect(reissue).toHaveBeenCalledTimes(1)
    expect(store.online[5]).toBe(true)
    store.stopHeartbeat()
  })

  it('recording a disabled/fault heartbeat keeps the device offline', async () => {
    const store = useDeviceSessionStore()
    vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    vi.spyOn(deviceSessionApi, 'heartbeat').mockRejectedValue({ response: { status: 409 } })
    store.startHeartbeat(5)
    await ready()
    expect(store.online[5]).toBe(false)
    // 409（停用/故障/绑定）不满足连续心跳条件，但也不会清除可复用凭证。
    expect(store.tokens[5]).toBe('device-token-abc')
    store.stopHeartbeat()
  })

  it('stopHeartbeat clears the interval so no further heartbeats fire', async () => {
    const store = useDeviceSessionStore()
    vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: issued } as never)
    const heartbeat = vi.spyOn(deviceSessionApi, 'heartbeat').mockResolvedValue({ data: onlineResult } as never)
    store.startHeartbeat(5, 30_000)
    await ready()
    const callsAfterStart = heartbeat.mock.calls.length
    store.stopHeartbeat()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(heartbeat.mock.calls.length).toBe(callsAfterStart)
    expect(store.activeDeviceId).toBeNull()
  })

  it('A/B tokens are stored under separate keys and never overwrite each other', async () => {
    const store = useDeviceSessionStore()
    // 设备 A 和设备 B 并发存在，各自持有独立 token。
    const a = { deviceId: 5, token: 'device-A-token', id: 1, expiresAt: '2099-01-01T00:00:00.000Z' }
    const b = { deviceId: 6, token: 'device-B-token', id: 2, expiresAt: '2099-01-01T00:00:00.000Z' }
    const issue = vi.spyOn(deviceSessionApi, 'issue')
      .mockImplementation(async (deviceId: number) =>
        ({ data: deviceId === 5 ? a : b }) as never)

    await store.issue(5)
    await store.issue(6)
    await store.issue(5) // 已持有 A 的凭证，store 内去重，不再调后端

    const persisted = JSON.parse(localStorage.getItem(DEVICE_SESSION_STORAGE_KEY) || '{}')
    expect(persisted['5']).toBe('device-A-token')
    expect(persisted['6']).toBe('device-B-token')
    // 内存态同样各自独立。
    expect(store.tokens[5]).toBe('device-A-token')
    expect(store.tokens[6]).toBe('device-B-token')

    // clear 仅删除对应设备的凭证，不影响其它设备。
    store.clear(5)
    const afterClear = JSON.parse(localStorage.getItem(DEVICE_SESSION_STORAGE_KEY) || '{}')
    expect(afterClear['5']).toBeUndefined()
    expect(afterClear['6']).toBe('device-B-token')

    // A、B 各签发一次；重复签发 A 被 store 去重。
    expect(issue).toHaveBeenCalledTimes(2)
  })
})
