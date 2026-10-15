import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classroomMobileApi, type MobileClassroomState } from '@/api/classroomMobile'
import { useClassroomMobileStore } from '@/stores/classroomMobile'

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
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('does not send commands while the target screen is offline', async () => {
    const store = useClassroomMobileStore()
    store.setSession(session)
    store.state = state(false)
    const command = vi.spyOn(classroomMobileApi, 'command')
    await expect(store.execute('next_step')).rejects.toThrow('大屏离线')
    expect(command).not.toHaveBeenCalled()
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
})
