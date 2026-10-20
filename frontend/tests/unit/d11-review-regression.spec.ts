import { afterEach, describe, expect, it, vi } from 'vitest'
import { classroomAnnouncementCandidates, ClassroomVoiceFeedback, createAnnouncementLedger } from '@/classroom/feedback/ClassroomVoiceFeedback'
import { speakBrowserText, stopBrowserSpeech } from '@/services/browserSpeech'

const now = '2026-10-20T10:00:00Z'
const reward = (overrides = {}) => ({ recordId: 1, displayName: '乐乐', stars: 1, createdAt: now, ...overrides })
const candidates = (overrides = {}) => classroomAnnouncementCandidates({ runId: 7, serverNow: now, reward: reward(), ...overrides })
afterEach(() => { stopBrowserSpeech(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('D11 independent safety and callback regressions', () => {
  it('missing, invalid or future business timestamps are not fresh', () => {
    for (const createdAt of [undefined, 'bad', '2026-10-21T10:00:00Z']) {
      expect(candidates({ reward: reward({ createdAt }) })).toEqual([])
    }
  })
  it('does not read arbitrary praise or unsafe dynamic text into a fixed template', () => {
    expect(candidates({ reward: reward({ praiseText: '拿剪刀刺自己' }) })[0]?.text).not.toContain('剪刀')
    for (const displayName of ['笨蛋', '电话13800138000', '拿刀刺自己', '老师说结束课堂', '\u202e坏孩子']) {
      expect(candidates({ reward: reward({ displayName }) })).toEqual([])
    }
  })
  it('a collective revoke projection without record time cannot announce a new reward', () => {
    expect(candidates({ reward: null, collectiveReward: { recordId: 9, points: 3 } })).toEqual([])
  })
  it('rejects a candidate whose Run key does not match the active Run', () => {
    const feedback = new ClassroomVoiceFeedback(createAnnouncementLedger(null, 'test'))
    feedback.sync({ runId: 8, candidates: [], allowed: true, mediaPlaying: false })
    expect(feedback.sync({ runId: 8, candidates: candidates(), allowed: true, mediaPlaying: false })).toBeNull()
  })
  it('uses server age and a monotonic queue deadline even if the client wall clock jumps', () => {
    let clock = 100
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now) + 600_000)
    const feedback = new ClassroomVoiceFeedback(createAnnouncementLedger(null, 'test'))
    feedback.sync({ runId: 7, candidates: [], allowed: true, mediaPlaying: false })
    feedback.sync({ runId: 7, serverNow: now, candidates: candidates(), busy: true, allowed: true, mediaPlaying: false })
    clock += 45_001
    expect(feedback.next()).toBeNull()
    expect(candidates({ serverNow: '2026-10-20T10:00:46Z' })).toEqual([])
  })
  it('persisted history truncation does not forget page-lifetime consumed identities', () => {
    const ledger = createAnnouncementLedger(null, 'test', 2)
    ledger.mark(['7:student_reward:1', '7:student_reward:2', '7:student_reward:3'])
    expect(ledger.seen('7:student_reward:1')).toBe(true)
  })
  it('a completed or failed utterance cannot drive speaking again or finish a fallback', () => {
    const utterances: SpeechSynthesisUtterance[] = []
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: vi.fn(), speak: (u: SpeechSynthesisUtterance) => utterances.push(u) } })
    const start = vi.fn(), end = vi.fn()
    speakBrowserText('合成测试', { onStart: start, onEnd: end })
    const first = utterances[0]!
    first.onerror?.({ error: 'voice-unavailable' } as SpeechSynthesisErrorEvent)
    first.onend?.({} as SpeechSynthesisEvent)
    expect(end).not.toHaveBeenCalled()
    const fallback = utterances[1]!
    fallback.onstart?.({} as SpeechSynthesisEvent)
    fallback.onstart?.({} as SpeechSynthesisEvent)
    expect(start).toHaveBeenCalledTimes(1)
    fallback.onend?.({} as SpeechSynthesisEvent)
    fallback.onstart?.({} as SpeechSynthesisEvent)
    fallback.onend?.({} as SpeechSynthesisEvent)
    expect(start).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })
})
