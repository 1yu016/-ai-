import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { http } from '@/api/http'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'
import { commandCapability } from '@/services/classroomCapabilities'

function state(actions?: string[], version = 1, status: ClassroomRunPayload['status'] = 'running'): ClassroomRunPayload {
  return { id: 9, deviceId: 1, version, status, lessonPlanId: 1, title: '合成课堂', currentStepIndex: 0,
    steps: [], startedAt: '', updatedAt: '', allowedActions: actions, attendanceState: { '1': 'present' } }
}
function cockpit(actions: string[], version = 1) {
  return { schemaVersion: 1, run: { id: 9, deviceId: 1 }, versions: { runVersion: version, snapshotVersion: null }, capabilities: { allowedActions: actions } }
}
describe('teacher server capabilities', () => {
  let store: ReturnType<typeof useLessonRunStore>
  beforeEach(() => { setActivePinia(createPinia()); store = useLessonRunStore() })
  afterEach(() => { store.clearRun(); vi.restoreAllMocks(); vi.useRealTimers() })
  it.each([
    ['OPENING', 'running', ['complete_opening', 'skip_opening', 'pause', 'complete', 'reward_revoke', 'attendance_correction'], false],
    ['TEACHING', 'running', ['change_step', 'resource_start', 'reward', 'roll_call', 'attendance_new'], true],
    ['PAUSED', 'paused', ['resume', 'safe_stop', 'attendance_correction', 'reward_revoke', 'collective_reward_revoke'], false],
    ['break', 'running', ['end_break', 'complete', 'attendance_correction', 'reward_revoke'], false],
    ['recovery', 'running', ['recover', 'takeover', 'safe_stop', 'complete'], false],
    ['terminal', 'completed', ['query', 'prepare', 'start'], false],
  ] as const)('%s uses server list, not running/paused inference', (_phase, status, actions, teaching) => {
    store.adoptRun(state([...actions], 1, status))
    expect(store.can('reward')).toBe(teaching)
    expect(store.can('resource_start')).toBe(teaching)
    for (const action of actions) expect(store.can(action)).toBe(true)
  })
  it('absent or expired capability never infers write permission', () => {
    vi.useFakeTimers(); store.adoptRun(state())
    expect(store.can('reward')).toBe(false)
    store.adoptRun(state(['reward']))
    expect(store.can('reward')).toBe(true)
    vi.advanceTimersByTime(6001); expect(store.can('reward')).toBe(false)
  })
  it('loads existing versioned cockpit projection without adopting it as full Run', async () => {
    store.adoptRun(state()); vi.spyOn(http, 'get').mockResolvedValue({ data: cockpit(['resume']) })
    await store.refreshCapabilities()
    expect(store.can('resume')).toBe(true); expect(store.run?.lessonTitle).toBe('合成课堂')
  })
  it('late capability and old Run responses cannot overwrite newer capabilities', async () => {
    store.adoptRun(state(['reward']))
    let resolve!: (r: unknown) => void
    vi.spyOn(http, 'get').mockImplementation(() => new Promise(r => { resolve = r }) as never)
    const pending = store.refreshCapabilities()
    store.adoptRun(state(['resume'], 2, 'paused'))
    resolve({ data: cockpit(['reward']) }); await pending
    store.adoptRun(state(['reward'], 1))
    expect(store.run?.version).toBe(2); expect(store.can('resume')).toBe(true); expect(store.can('reward')).toBe(false)
  })
  it('cockpit version mismatch does not grant permission', async () => {
    store.adoptRun(state()); vi.spyOn(http, 'get').mockResolvedValue({ data: cockpit(['reward'], 5) })
    await store.refreshCapabilities(); expect(store.can('reward')).toBe(false)
  })
  it('PAUSED preserves existing attendance corrections, but not new/mixed attendance', async () => {
    store.adoptRun(state(['attendance_correction'], 1, 'paused'))
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { status: 'success', result: {}, classroomState: state(['attendance_correction'], 2, 'paused') } })
    await store.teacherCommand('attendance_update', { studentId: 1, status: 'late' })
    expect(post).toHaveBeenCalledTimes(1)
    await expect(store.teacherCommand('attendance_update', { updates: [{ studentId: 1 }, { studentId: 2 }] })).rejects.toThrow()
    expect(post).toHaveBeenCalledTimes(1)
  })
  it.each([403, 409])('%i rejection refreshes by query, throws original error, never resends write', async status => {
    store.adoptRun(state(['roll_call']))
    const error = new AxiosError('rejected', undefined, undefined, undefined, { status, data: { code: 'CLASSROOM_OPERATION_FORBIDDEN', message: '阶段或权限已变化' } } as never)
    const post = vi.spyOn(http, 'post').mockRejectedValue(error)
    const get = vi.spyOn(http, 'get').mockImplementation(async url => ({ data: String(url).endsWith('/cockpit') ? cockpit(['resume'], 2) : state(undefined, 2, 'paused') }))
    await expect(store.teacherCommand('random_roll_call')).rejects.toBe(error)
    expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(2)
    expect(store.can('roll_call')).toBe(false); expect(store.can('resume')).toBe(true)
  })
  it('policy mapping preserves safe stop vs resource start distinction', () => {
    expect(commandCapability('pause_media')).toBe('safe_stop')
    expect(commandCapability('resume_media')).toBe('resource_start')
    expect(commandCapability('revoke_reward')).toBe('reward_revoke')
    expect(commandCapability('attendance_update')).toBeNull()
  })
  it('teacher wrapper preserves committed result even when recovery refresh fails', async () => {
    store.adoptRun(state(['reward']))
    const envelope = { requestId: 'committed', runId: 9, operation: 'reward_student', status: 'success', result: { recordId: 42 }, classroomState: null,
      recovery: { source: 'canonical_business_receipt', contractVersion: 1, committedRunVersion: 2, refreshRequired: true } }
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: envelope })
    vi.spyOn(http, 'get').mockRejectedValue(new Error('query offline'))
    const result = await store.teacherCommand('reward_student')
    expect(result?.result).toEqual({ recordId: 42 }); expect(store.lastCommandResult?.status).toBe('success')
    expect(store.commandStateRefresh.status).toBe('failed'); expect(store.can('reward')).toBe(false)
    expect(post).toHaveBeenCalledTimes(1)
  })
})
