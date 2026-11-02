import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/stores/user'
import { classroomMobileApi, type MobileClassroomState } from '@/api/classroomMobile'
import { useClassroomMobileStore } from '@/stores/classroomMobile'
import { http } from '@/api/http'

const session = {
  id: 'mobile-session',
  token: 'secret-control-token',
  classroomRunId: 9,
  targetDeviceId: 5,
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function state(online = true): MobileClassroomState {
  return {
    controlActive: true,
    serverNow: '2026-10-07T00:00:00.000Z',
    session: { id: session.id, expiresAt: session.expiresAt, lastHeartbeatAt: null },
    classroom: {
      id: 9,
      lessonPlanId: 2,
      deviceId: 5,
      version: 3,
      status: 'running',
      currentStepIndex: 0,
      title: '测试课堂',
      steps: [{ stepIndex: 0, title: '导入', type: 'resource', content: '', durationSeconds: 60, resourceId: 8 }],
      elapsedSeconds: 10,
      startedAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    },
    screen: { deviceId: 5, online, status: online ? 'online' : 'offline', lastOnlineAt: null },
    attendance: { runId: 9, classId: 3, items: [], attendanceState: {} },
    recentRollCall: null,
    recentReward: null,
    interaction: {},
  }
}

describe('classroom mobile realtime store', () => {
  it('uses unique non-secret URLs and no-cache headers for every mobile state read', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({ data: state() })
    await classroomMobileApi.state(session.token)
    await classroomMobileApi.state(session.token)
    const first = get.mock.calls[0]![1]!
    const second = get.mock.calls[1]![1]!
    expect((first.params as Record<string, string>)._fresh).not.toBe((second.params as Record<string, string>)._fresh)
    expect(JSON.stringify(first.params)).not.toContain(session.token)
    expect(first.headers?.['Cache-Control']).toContain('no-store')
  })

  it('rejects cached terminal state from another classroom instead of revoking this scan', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    const cached = state()
    cached.classroom.id = 8
    cached.classroom.status = 'completed'
    cached.controlActive = false
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: cached } as never)
    await expect(store.refreshState()).rejects.toThrow('连接数据与本次扫码课堂不一致')
    expect(store.session?.classroomRunId).toBe(9)
    expect(store.connection).not.toBe('expired')
    store.stop(true)
  })

  it.each(['ended', 'rejected'] as const)('a late old-session %s response cannot expire a newly scanned classroom', async outcome => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    let resolve!: (value: unknown) => void
    let reject!: (reason: unknown) => void
    vi.spyOn(classroomMobileApi, 'state').mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej }) as never)
    const pending = store.refreshState().catch(() => null)
    const next = { ...session, token: 'new-token', classroomRunId: 10 }
    store.setSession(next)
    if (outcome === 'ended') resolve({ data: { ...state(), controlActive: false } })
    else reject({ response: { status: 410, data: { message: '课堂已结束' } } })
    await pending
    expect(store.session?.classroomRunId).toBe(10)
    expect(store.connection).toBe('idle')
    expect(store.state).toBeNull()
    expect(store.lastError).toBe('')
    store.stop(true)
  })

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(classroomMobileApi, 'queryCommand').mockRejectedValue(new Error('no stored command'))
  })

  it('does not send commands while the target screen is offline', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(false)
    const command = vi.spyOn(classroomMobileApi, 'command')
    await expect(store.execute('next_step')).rejects.toThrow('大屏离线')
    expect(command).not.toHaveBeenCalled()
  })

  it.each([-180_000, -30_000, 0, 30_000, 180_000])('uses server time for issuedAt with device bias %i', async (bias) => {
    const server = Date.parse(state().serverNow)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(server + bias)
    const store = useClassroomMobileStore()
    store.setSession(session)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state() } as never)
    await store.refreshState()
    const command = vi.spyOn(classroomMobileApi, 'command').mockResolvedValue({ data: { executionStatus: 'executed' } } as never)
    await store.execute('next_step')
    expect(Math.abs(Date.parse(command.mock.calls[0]![1].issuedAt) - server)).toBeLessThan(100)
    expect(Date.parse(store.commands[0]!.expiresAt) - Date.parse(store.commands[0]!.issuedAt)).toBe(30_000)
  })

  it.each([29_999, 30_000, 30_001])('keeps retry identity but stops at the conservative TTL boundary %i', async elapsed => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let monotonic = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    const store = useClassroomMobileStore()
    store.setSession(session)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state() } as never)
    await store.refreshState()
    const command = vi.spyOn(classroomMobileApi, 'command').mockImplementationOnce(async () => {
      monotonic = elapsed
      throw new Error('response lost')
    }).mockResolvedValue({ data: { executionStatus: 'executed' } } as never)
    const outcome = store.execute('next_step').then(() => 'success', () => 'expired')
    await vi.advanceTimersByTimeAsync(900)
    expect(await outcome).toBe(elapsed < 30_000 ? 'success' : 'expired')
    expect(command).toHaveBeenCalledTimes(elapsed < 30_000 ? 2 : 1)
    if (command.mock.calls.length === 2) expect(command.mock.calls[0]![1]).toEqual(command.mock.calls[1]![1])
    store.stop(true)
  })

  it('resynchronizes before declaring a stored session expired on a fast phone, including reconnect', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2099-01-01')
    const store = useClassroomMobileStore()
    store.setSession({ ...session, expiresAt: '2026-10-07T00:01:00.000Z' })
    useUserStore().accessToken = 'synthetic-only'
    const query = vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state() } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } }))
    store.start()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(query).toHaveBeenCalledTimes(1)
    expect(store.session).not.toBeNull()
    window.dispatchEvent(new Event('offline'))
    expect(store.connection).toBe('offline')
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(query).toHaveBeenCalledTimes(2)
    store.stop(true)
  })

  it('waits for server confirmation and refreshes authoritative state', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    const refreshed = state(true)
    refreshed.classroom.version = 4
    vi.spyOn(classroomMobileApi, 'command').mockResolvedValue({
      data: {
        deliveryStatus: 'confirmed',
        confirmedAt: '2026-10-07T00:00:01.000Z',
        result: { classroomState: refreshed.classroom },
      },
    } as never)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: refreshed } as never)
    await store.execute('next_step')
    expect(store.state?.classroom.version).toBe(4)
    expect(store.lastConfirmedAt).toBe('2026-10-07T00:00:01.000Z')
  })

  it('retains a confirmed newer command version when an older refresh arrives before the next command', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    const confirmed = state(true)
    confirmed.classroom.version = 4
    const command = vi.spyOn(classroomMobileApi, 'command').mockResolvedValue({
      data: { deliveryStatus: 'confirmed', confirmedAt: confirmed.serverNow, result: { classroomState: confirmed.classroom } },
    } as never)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state(true) } as never)
    await store.execute('child_qa_stop')
    expect(store.state?.classroom.version).toBe(4)
    await store.execute('play_resource', { resourceId: 8 })
    expect(command.mock.calls[1]?.[1].expectedVersion).toBe(4)
    expect(command).toHaveBeenCalledTimes(2)
    store.stop(true)
  })

  it('rejects late lower-version frames even with a newer server timestamp, but honors revocation', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    const latest = state()
    latest.classroom.version = 5
    store.state = latest
    const late = state()
    late.serverNow = '2026-10-07T00:00:30.000Z'
    const query = vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: late } as never)
    await store.refreshState()
    expect(store.state?.classroom.version).toBe(5)
    query.mockResolvedValue({ data: { ...late, controlActive: false } } as never)
    await store.refreshState()
    expect(store.session).toBeNull()
    expect(store.connection).toBe('expired')
  })

  it('retries a network failure with the same requestId and issuedAt', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    const command = vi.spyOn(classroomMobileApi, 'command')
      .mockRejectedValueOnce(new Error('weak network'))
      .mockResolvedValueOnce({
        data: {
          deliveryStatus: 'confirmed',
          confirmedAt: '2026-10-07T00:00:02.000Z',
          result: { classroomState: state(true).classroom },
        },
      } as never)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state(true) } as never)
    await store.execute('reward_student', { studentId: 7 })
    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[0]?.[1].requestId).toBe(command.mock.calls[1]?.[1].requestId)
    expect(command.mock.calls[0]?.[1].issuedAt).toBe(command.mock.calls[1]?.[1].issuedAt)
  })

  it('records server execution status and does not treat received as success', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    vi.spyOn(classroomMobileApi, 'command').mockResolvedValue({
      data: { deliveryStatus: 'received', executionStatus: 'received', errorCode: null },
    } as never)
    await expect(store.execute('next_step')).rejects.toThrow('服务端尚未确认指令执行')
    expect(store.commands[0]?.executionStatus).toBe('received')
  })

  it('版本冲突时刷新权威状态并清理待发送操作', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    vi.spyOn(classroomMobileApi, 'command').mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { message: '课堂版本已变化' } },
    })
    const refreshed = state(true)
    refreshed.classroom.version = 4
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: refreshed } as never)
    await expect(store.execute('next_step')).rejects.toThrow('课堂版本已变化')
    expect(store.state?.classroom.version).toBe(4)
    expect(store.commands[0]?.executionStatus).toBe('failed')
    expect(store.commands[0]?.errorCode).toBe('VERSION_CONFLICT')
  })

  it('preserves a business rejection instead of calling it a version conflict', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    const command = vi.spyOn(classroomMobileApi, 'command').mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { message: '不支持的奖励动画' } },
    })
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state(true) } as never)
    await expect(store.execute('reward_student', { studentId: 7 })).rejects.toThrow('不支持的奖励动画')
    expect(command).toHaveBeenCalledTimes(1)
    expect(store.commands[0]?.errorCode).toBe('COMMAND_REJECTED')
    expect(store.lastConfirmedAt).toBeNull()
  })

  it('recovers a lost success response through the original read-only command query', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(true)
    const command = vi.spyOn(classroomMobileApi, 'command').mockRejectedValue(new Error('response lost'))
    vi.spyOn(classroomMobileApi, 'queryCommand').mockImplementation(async requestId => ({ data: {
      requestId, classroomRunId: 9, targetDeviceId: 5, source: 'mobile', operation: 'reward_student', status: 'success', updatedAt: state().serverNow,
      responsePayload: { requestId, runId: 9, operation: 'reward_student', source: 'mobile', targetDeviceId: 5, status: 'success', result: { recordId: 123 }, classroomState: null },
    } }) as never)
    vi.spyOn(classroomMobileApi, 'state').mockResolvedValue({ data: state(true) } as never)
    const response = await store.execute('reward_student', { studentId: 7 })
    expect(command).toHaveBeenCalledTimes(1)
    expect(classroomMobileApi.queryCommand).toHaveBeenCalledWith(command.mock.calls[0]![1].requestId)
    expect(response.result).toMatchObject({ result: { recordId: 123 } })
    expect(store.commands[0]?.executionStatus).toBe('executed')
  })
})
