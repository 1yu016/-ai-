import { describe, expect, it, vi } from 'vitest'
import { announcementBaseline, loadAnnouncementRecords } from '@/classroom/feedback/ClassroomAnnouncementRecords'
import { ClassroomVoiceFeedback, createAnnouncementLedger } from '@/classroom/feedback/ClassroomVoiceFeedback'

const at = '2026-10-20T10:00:00Z'
const record = (id: number, extra = {}) => ({ id, source: 'canonical', recordType: 'collective_reward', classroomRunId: 7, classId: 3, points: 2, createdAt: at, revokedAt: null, ...extra })
describe('D11 formal announcement reads', () => {
  it('uses each current Run collective record, excludes revoked/cross-class/cross-Run/legacy and expired results', async () => {
    const get = vi.fn(async () => ({ data: { collectiveRewards: [record(1), record(2, { revokedAt: at }), record(3, { classroomRunId: 8 }), record(4, { classId: 4 }), record(5, { source: 'legacy_engagement' }), record(6, { createdAt: '2026-10-20T09:59:00Z' })] } }))
    const list = await loadAnnouncementRecords({ runId: 7, serverNow: at, collectiveState: { recordIds: [1, 2, 3, 4, 5, 6], points: 99 } }, 3, get)
    expect(list.map(item => item.key)).toEqual(['7:collective_reward:1'])
    expect(list[0]!.text).toContain('两点')
    expect(list[0]!.text).not.toContain('99')
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('recovers intermediate formal roll calls and reward counts, never records newer than the captured projection', async () => {
    const get = vi.fn(async (path: string) => ({ data: path.endsWith('timeline') ? { run: { id: 7 }, items: [1, 2, 3].map(id => ({ key: `roll-call:${id}`, type: 'roll_call', source: 'roll_call', description: '乐乐（random）', occurredAt: at, details: { mode: 'random' } })) } : { items: [record(1, { recordType: 'reward', studentName: '乐乐', stars: 3 }), record(2, { recordType: 'reward', studentName: '乐乐', stars: 1 })] } }))
    const list = await loadAnnouncementRecords({ runId: 7, serverNow: at, rollCall: { lastRecordId: 2 }, reward: { recordId: 1 } }, 3, get)
    expect(list.map(item => item.key)).toEqual(['7:random_roll_call:1', '7:random_roll_call:2', '7:student_reward:1'])
    expect(list[2]!.text).toContain('三朵')
  })
  it('first-state baseline consumes history before delayed reads; new records still queue in formal order', async () => {
    const source = { runId: 7, serverNow: at, collectiveState: { recordIds: [1], points: 2 } }
    const feedback = new ClassroomVoiceFeedback(createAnnouncementLedger(null, 'test'))
    feedback.sync({ runId: 7, candidates: [], baselineKeys: announcementBaseline(source), allowed: true, mediaPlaying: false })
    const list = await loadAnnouncementRecords({ ...source, collectiveState: { recordIds: [1, 2, 3], points: 6 } }, 3, async () => ({ data: { collectiveRewards: [record(3), record(2), record(1)] } }))
    expect(feedback.sync({ runId: 7, serverNow: at, candidates: list, allowed: true, mediaPlaying: false })?.key).toBe('7:collective_reward:2')
    expect(feedback.next()?.key).toBe('7:collective_reward:3')
    expect(feedback.next()).toBeNull()
  })
  it('read errors do not create speech from untimed collective projections', async () => {
    expect(await loadAnnouncementRecords({ runId: 7, serverNow: at, collectiveState: { recordIds: [1], points: 2 } }, 3, async () => { throw Error('offline') })).toEqual([])
  })
})
