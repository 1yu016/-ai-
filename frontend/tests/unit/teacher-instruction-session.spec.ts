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
  const rollCallState = vi.fn<NonNullable<TeacherInstructionDeps['rollCallState']>>(()=>({lastStudentId:5,lastStudentDisplayName:'小明',updatedAt:new Date().toISOString(),counts:{5:1}}))
  const deps = { context: () => context, students, execute, query, adopt, check, currentResource, rollCallState }
  const session = new TeacherInstructionSession(deps)
  return { session, deps, rollCallState, students, execute, query, adopt, check, currentResource, change: () => { context = { ...context, id: 9 }; session.invalidate() } }
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
    const candidate = await f.session.submit('奖励小明')
    const first = f.session.execute(candidate.confirmation!)
    expect((await f.session.submit('奖励小明')).message).toContain('稍候')
    resolve([{ id: 5, classId: 3, name: '小明', nickname: null, status: 'active' }])
    await first
    expect(f.execute).toHaveBeenCalledOnce()
  })
  it('asks only for missing object, retaining flower amount', async () => {
    const f = fixture()
    f.rollCallState.mockReturnValue({})
    expect((await f.session.submit('给他两朵小红花')).message).toContain('补充')
    expect(f.execute).not.toHaveBeenCalled()
    const candidate = await f.session.submit('小明')
    await f.session.execute(candidate.confirmation!)
    expect(f.execute.mock.calls[0]![0].parameters).toMatchObject({ studentId: 5, stars: 2, rewardForms: ['flower'] })
  })
  it.each(['不要奖励小明', '为什么要奖励小明？', '结束课堂是什么意思？'])('questions and negation never execute: %s', async text => {
    const f = fixture(); await f.session.submit(text); expect(f.execute).not.toHaveBeenCalled()
  })
  it('duplicate student names never guessed', async () => {
    const f = fixture()
    const one = (await f.students())[0]!
    f.students.mockResolvedValue([one, { ...one, id: 6 }])
    const candidate = await f.session.submit('奖励小明')
    expect((await f.session.execute(candidate.confirmation!)).message).toContain('多名')
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
    const candidate=await f.session.submit('奖励小明')
    await f.session.execute(candidate.confirmation!)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('current authoritative referent is revalidated and reward waits for confirmation',async()=>{
    const f=fixture();const result=await f.session.submit('给刚才那个孩子两颗星星')
    expect(f.execute).not.toHaveBeenCalled()
    await f.session.execute(result.confirmation!)
    expect(f.execute.mock.calls[0]![0].parameters).toMatchObject({studentId:5,stars:2})
  })
  it('expired or ambiguous referents ask instead of guessing',async()=>{
    const f=fixture();f.rollCallState.mockReturnValue({lastStudentId:5,lastStudentDisplayName:'小明',updatedAt:'2000-01-01'})
    expect((await f.session.submit('给她一颗星星')).message).toContain('补充')
    expect(f.execute).not.toHaveBeenCalled()
    const other=new TeacherInstructionSession({...f.deps,referentAmbiguous:()=>true})
    expect((await other.submit('给她一颗星星')).message).toContain('补充')
  })
  it('bare pronoun with multiple recent students asks, explicit latest referent still resolves',async()=>{
    const f=fixture();f.rollCallState.mockReturnValue({lastStudentId:5,lastStudentDisplayName:'小明',updatedAt:new Date().toISOString(),recentResults:[{studentId:5},{studentId:6}]})
    expect((await f.session.submit('也给她一颗星星')).message).toContain('补充')
    expect((await f.session.submit('给刚才那个孩子一颗星星')).confirmation).toBeTruthy()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('confirmation cannot be reused after changing run',async()=>{
    const f=fixture();const result=await f.session.submit('给小明一颗星星');f.change()
    await f.session.execute(result.confirmation!)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('uncalled exhaustion asks permission, never silently repeats',async()=>{
    const f=fixture();expect((await f.session.submit('找一个还没被点到的孩子')).message).toContain('是否允许重复')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('refresh recovers unknown request only by query',async()=>{
    const f=fixture();let saved:string|null=null
    const journal={read:()=>saved,write:(v:string|null)=>{saved=v}}
    const first=new TeacherInstructionSession({...f.deps,journal})
    f.execute.mockRejectedValue(Error('network'));await first.submit('随机点名')
    const requestId=first.unresolvedRequestId!
    const refreshed=new TeacherInstructionSession({...f.deps,journal})
    f.query.mockResolvedValue({requestId,classroomRunId:1,deviceId:2,operation:'random_roll_call',status:'processing',responsePayload:null})
    await refreshed.submit('随机点名')
    expect(f.execute).toHaveBeenCalledOnce();expect(f.query).toHaveBeenCalledWith(requestId)
  })
  it('policy admission failure is not a pending submitted command', async () => {
    const f = fixture(); f.check.mockImplementation(() => { throw Error('当前课堂已暂停') })
    const candidate = await f.session.submit('奖励小明')
    expect((await f.session.execute(candidate.confirmation!)).message).toContain('暂停')
    expect(f.execute).not.toHaveBeenCalled(); expect(f.session.unresolvedRequestId).toBeNull()
  })
  it('lost response recovers by GET, preserves first result even when refresh fails, never reposts', async () => {
    const f = fixture()
    f.execute.mockRejectedValue(Error('network'))
    const candidate = await f.session.submit('奖励小明')
    await f.session.execute(candidate.confirmation!)
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
