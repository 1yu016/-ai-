import { describe, expect, it, vi } from 'vitest'
import { TeacherInstructionSession, type TeacherInstructionDeps } from '@/classroom/command/TeacherInstructionSession'
import type { ClassroomCommandResult } from '@/services/classroomCommandBus'

function fixture() {
  let context = { id: 1, deviceId: 2, classId: 3, version: 4, currentStepIndex: 0, status: 'running' }
  const students = vi.fn(async () => [{ id: 5, classId: 3, name: '小明', nickname: null, status: 'active' }])
  const execute = vi.fn<TeacherInstructionDeps['execute']>(async (match, requestId) => ({
    requestId, runId: 1, operation: match.operation, source: 'teacher_panel', targetDeviceId: 2,
    status: 'success', result: { recordId: 7, student: { id: 5, displayName: '小明' } }, classroomState: null,
  }))
  const query = vi.fn<TeacherInstructionDeps['query']>()
  const adopt = vi.fn()
  const check = vi.fn()
  const currentResource = vi.fn<NonNullable<TeacherInstructionDeps['currentResource']>>(() => ({ id: 8, title: '合成课件' }))
  const session = new TeacherInstructionSession({ context: () => context, students, execute, query, adopt, check, currentResource })
  return { session, students, execute, query, adopt, check, currentResource, change: () => { context = { ...context, id: 9 }; session.invalidate() } }
}
describe('authenticated teacher instruction session', () => {
  it('random call reports only returned canonical student', async () => {
    const f = fixture()
    expect((await f.session.submit('随机点名')).message).toContain('小明')
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.execute.mock.calls[0]![0].operation).toBe('random_roll_call')
  })
  it('specified name resolves current active class identity without repeated confirmation', async () => {
    const f = fixture()
    await f.session.submit('点名小明')
    expect(f.execute.mock.calls[0]![0].parameters).toEqual({ studentId: 5 })
  })
  it('teacher ASR remains a candidate until authenticated teacher confirmation', async () => {
    const f = fixture()
    const candidate = await f.session.submit('给小明一朵小红花', true)
    expect(candidate.confirmation?.operation).toBe('reward_student')
    expect(f.execute).not.toHaveBeenCalled()
    await f.session.execute(candidate.confirmation!)
    expect(f.execute).toHaveBeenCalledOnce()
  })
  it('current resource uses actual resource identity, not an AI-created id', async () => {
    const f = fixture()
    await f.session.submit('播放当前资源')
    expect(f.execute.mock.calls[0]![0]).toMatchObject({ operation: 'play_resource', parameters: { resourceId: 8 } })
  })
  it('missing current resource is explicitly unavailable', async () => {
    const f = fixture(); f.currentResource.mockReturnValue(null)
    expect((await f.session.submit('播放当前资源')).message).toContain('没有可用资源')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('simultaneous button/enter submissions cannot enqueue a second write', async () => {
    const f = fixture()
    let resolve!: (items: Awaited<ReturnType<typeof f.students>>) => void
    f.students.mockImplementation(() => new Promise(done => { resolve = done }))
    const first = f.session.submit('奖励小明')
    expect((await f.session.submit('奖励小明')).message).toContain('稍候')
    resolve([{ id: 5, classId: 3, name: '小明', nickname: null, status: 'active' }])
    await first
    expect(f.execute).toHaveBeenCalledOnce()
  })
  it('asks only for missing object, retaining flower amount', async () => {
    const f = fixture()
    expect((await f.session.submit('给他两朵小红花')).message).toContain('补充')
    expect(f.execute).not.toHaveBeenCalled()
    await f.session.submit('小明')
    expect(f.execute.mock.calls[0]![0].parameters).toMatchObject({ studentId: 5, stars: 2, rewardForms: ['flower'] })
  })
  it.each(['不要奖励小明', '为什么要奖励小明？', '结束课堂是什么意思？'])('questions and negation never execute: %s', async text => {
    const f = fixture(); await f.session.submit(text); expect(f.execute).not.toHaveBeenCalled()
  })
  it('duplicate student names never guessed', async () => {
    const f = fixture()
    const one = (await f.students())[0]!
    f.students.mockResolvedValue([one, { ...one, id: 6 }])
    expect((await f.session.submit('奖励小明')).message).toContain('多名')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('inactive/foreign students never resolved', async () => {
    const f = fixture()
    f.students.mockResolvedValue([{ id: 5, classId: 7, name: '小明', nickname: null, status: 'active' }])
    await f.session.submit('奖励小明')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('lifecycle completion keeps confirmation and group names cannot masquerade as group ids', async () => {
    const f = fixture()
    expect((await f.session.submit('结束课堂')).confirmation?.operation).toBe('complete_class')
    await f.session.submit('一组点名')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('context change while roster loads invalidates old task', async () => {
    const f = fixture()
    f.students.mockImplementation(async () => { f.change(); return [{ id: 5, classId: 3, name: '小明', nickname: null, status: 'active' }] })
    await f.session.submit('奖励小明')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('policy admission failure is not a pending submitted command', async () => {
    const f = fixture(); f.check.mockImplementation(() => { throw Error('当前课堂已暂停') })
    expect((await f.session.submit('奖励小明')).message).toContain('暂停')
    expect(f.execute).not.toHaveBeenCalled(); expect(f.session.unresolvedRequestId).toBeNull()
  })
  it('lost response recovers by GET, preserves first result even when refresh fails, never reposts', async () => {
    const f = fixture()
    f.execute.mockRejectedValue(Error('network'))
    await f.session.submit('奖励小明')
    const requestId = f.session.unresolvedRequestId!
    f.query.mockResolvedValue({ requestId, classroomRunId: 1, deviceId: 2, operation: 'reward_student', status: 'success',
      responsePayload: { requestId, runId: 1, operation: 'reward_student', status: 'success', result: { id: 44 }, classroomState: null } as ClassroomCommandResult })
    f.adopt.mockRejectedValue(Error('refresh'))
    const feedback = await f.session.submit('奖励小明')
    expect(feedback.result).toEqual({ id: 44 })
    expect(f.query).toHaveBeenCalledWith(requestId)
    expect(f.execute).toHaveBeenCalledOnce()
    expect(feedback.message).toContain('正式记录')
  })
  it('processing or mismatched receipt never implies success', async () => {
    const f = fixture(); f.execute.mockRejectedValue(Error('network'))
    await f.session.submit('随机点名')
    const requestId = f.session.unresolvedRequestId!
    f.query.mockResolvedValue({ requestId, classroomRunId: 99, deviceId: 2, operation: 'random_roll_call', status: 'success', responsePayload: null })
    expect((await f.session.query()).result).toBeUndefined()
    expect(f.session.unresolvedRequestId).toBe(requestId)
    expect(f.execute).toHaveBeenCalledOnce()
  })
})
