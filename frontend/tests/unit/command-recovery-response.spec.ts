import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'
import { executeClassroomCommand, type ClassroomCommandOperation } from '@/services/classroomCommandBus'

function state(version = 1, id = 9): ClassroomRunPayload {
  return { id, lessonPlanId: 3, classId: 1, deviceId: 1, version, status: 'running', currentStepIndex: 0,
    title: '合成测试课堂', steps: [{ stepIndex: 0, title: '观察', type: 'introduction', content: '学生内容', resourceId: null, durationSeconds: 60 }], startedAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:01Z' }
}
function recovered(operation: ClassroomCommandOperation = 'reward_student', requestId = 'original-request', committedVersion = 2) {
  return { requestId, runId: 9, operation, source: 'teacher_panel', targetDeviceId: 1, status: 'success',
    result: { recordId: 42, student: { id: 2 } }, classroomState: null,
    currentClassroomState: { id: 9, version: 6, status: 'completed', title: '精简Run，不含steps' },
    recovery: { source: 'canonical_business_receipt', contractVersion: 1, committedRunVersion: committedVersion, refreshRequired: true } }
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }

describe('I-2-1 real CommandBus success/recovery envelopes', () => {
  let store: ReturnType<typeof useLessonRunStore>
  beforeEach(() => { setActivePinia(createPinia()); store = useLessonRunStore(); store.adoptRun(state()) })
  afterEach(() => { store.$dispose(); vi.restoreAllMocks() })

  it('normal success retains result and adopts full state without an extra GET', async () => {
    const envelope = { ...recovered(), classroomState: state(2), recovery: undefined, currentClassroomState: undefined }
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: envelope }); const get = vi.spyOn(http, 'get')
    expect(await store.command('reward_student')).toEqual(envelope)
    expect(store.run?.version).toBe(2); expect(post).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled()
  })
  it.each(['reward_student', 'attendance_update', 'random_roll_call'] as const)('%s recovery preserves first result and separately queries complete current state', async operation => {
    const envelope = recovered(operation)
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: envelope })
    const get = vi.spyOn(http, 'get').mockResolvedValue({ data: { ...state(7), status: 'completed' } })
    const result = await store.command(operation)
    expect(result).toEqual(envelope); expect(result?.classroomState).toBeNull()
    expect(result?.result).toEqual({ recordId: 42, student: { id: 2 } })
    expect(store.run).toMatchObject({ version: 7, status: 'completed', steps: state().steps })
    expect(get).toHaveBeenCalledExactlyOnceWith('/classroom-runs/9'); expect(post).toHaveBeenCalledTimes(1)
  })
  it('refresh failure never rejects a committed command; query-only retry retains first receipt', async () => {
    const envelope = recovered(); const post = vi.spyOn(http, 'post').mockResolvedValue({ data: envelope })
    const get = vi.spyOn(http, 'get').mockRejectedValueOnce(new Error('查询断网')).mockResolvedValueOnce({ data: state(8) })
    await expect(store.command('reward_student')).resolves.toEqual(envelope)
    expect(store.lastCommandResult).toEqual(envelope)
    expect(store.commandStateRefresh).toMatchObject({ status: 'failed', requestId: envelope.requestId, runId: 9 })
    expect(store.commandStateRefresh.message).toContain('已成功'); expect(store.run?.version).toBe(1)
    await store.retryCommandStateRefresh()
    expect(store.run?.version).toBe(8); expect(store.commandStateRefresh.status).toBe('idle')
    expect(store.lastCommandResult).toEqual(envelope); expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(2)
  })
  it('late earlier recovery refresh cannot replace a newer refresh', async () => {
    const first = deferred<{ data: ClassroomRunPayload }>(); const second = deferred<{ data: ClassroomRunPayload }>()
    vi.spyOn(http, 'post').mockResolvedValueOnce({ data: recovered('reward_student', 'first') }).mockResolvedValueOnce({ data: recovered('attendance_update', 'second', 3) })
    const get = vi.spyOn(http, 'get').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = store.command('reward_student'); const b = store.command('attendance_update')
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    second.resolve({ data: state(8) }); const bResult = await b
    first.resolve({ data: state(7) }); const aResult = await a
    expect(store.run?.version).toBe(8); expect(aResult?.requestId).toBe('first'); expect(bResult?.requestId).toBe('second')
    expect(store.lastCommandResult?.requestId).toBe('second'); expect(store.commandStateRefresh.status).toBe('idle')
  })
  it('a normal later command invalidates an older pending refresh', async () => {
    const pending = deferred<{ data: ClassroomRunPayload }>()
    vi.spyOn(http, 'post').mockResolvedValueOnce({ data: recovered() }).mockResolvedValueOnce({ data: { ...recovered('attendance_update', 'new'), classroomState: state(9), recovery: undefined } })
    const get = vi.spyOn(http, 'get').mockReturnValueOnce(pending.promise)
    const a = store.command('reward_student'); await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await store.command('attendance_update'); pending.resolve({ data: state(7) }); await a
    expect(store.run?.version).toBe(9); expect(store.lastCommandResult?.requestId).toBe('new')
  })
  it('does not resurrect a cleared classroom after a late GET', async () => {
    const pending = deferred<{ data: ClassroomRunPayload }>()
    vi.spyOn(http, 'post').mockResolvedValue({ data: recovered() }); const get = vi.spyOn(http, 'get').mockReturnValueOnce(pending.promise)
    const command = store.command('reward_student'); await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    store.clearRun(); pending.resolve({ data: state(7) }); await command
    expect(store.run).toBeNull()
  })
  it('does not overwrite a newer state adopted during refresh', async () => {
    const pending = deferred<{ data: ClassroomRunPayload }>()
    vi.spyOn(http, 'post').mockResolvedValue({ data: recovered() }); const get = vi.spyOn(http, 'get').mockReturnValueOnce(pending.promise)
    const command = store.command('reward_student'); await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    store.adoptRun(state(10)); pending.resolve({ data: state(7) }); await command
    expect(store.run?.version).toBe(10)
  })
  it('invalid or older-than-commit GET is a synchronization failure, not business failure', async () => {
    const envelope = recovered('attendance_update', 'original', 4)
    vi.spyOn(http, 'post').mockResolvedValue({ data: envelope }); vi.spyOn(http, 'get').mockResolvedValue({ data: state(3) })
    await expect(store.command('attendance_update')).resolves.toEqual(envelope)
    expect(store.run?.version).toBe(1); expect(store.commandStateRefresh.status).toBe('failed')
  })
  it('unified HTTP adapter keeps the recovery envelope and an explicitly supplied requestId intact', async () => {
    const envelope = recovered(); const post = vi.spyOn(http, 'post').mockResolvedValue({ data: envelope })
    const result = await executeClassroomCommand(state(), 'reward_student', { requestId: 'original-request' })
    expect(result).toEqual(envelope); expect(post.mock.calls[0]![1]).toMatchObject({ requestId: 'original-request' })
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('a polling GET started before recovery cannot roll back the refreshed state', async () => {
    vi.useFakeTimers()
    try {
      const poll = deferred<{ data: ClassroomRunPayload }>()
      const get = vi.spyOn(http, 'get').mockReturnValueOnce(poll.promise).mockResolvedValueOnce({ data: state(9) })
      vi.spyOn(http, 'post').mockResolvedValue({ data: recovered() })
      store.startPolling(100)
      await vi.advanceTimersByTimeAsync(100); expect(get).toHaveBeenCalledTimes(1)
      await store.command('reward_student'); expect(store.run?.version).toBe(9)
      poll.resolve({ data: state(2) }); await Promise.resolve(); await Promise.resolve()
      expect(store.run?.version).toBe(9); store.stopPolling()
    } finally { vi.useRealTimers() }
  })
})
