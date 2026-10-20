import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyPublicSpeech, createBrowserLocalRecognition, createLocalRecognition, type LocalRecognition } from '@/services/classroomListening'
import { useClassroomListening } from '@/composables/useClassroomListening'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.forEach(scope => scope.stop()); scopes.length = 0; vi.useRealTimers(); vi.unstubAllEnvs() })
function fixture(continueAfterSpeech = false) {
  const identity = ref('run-1'), allowed = ref(true), speaking = ref(false), routes = vi.fn(), listening = vi.fn()
  const instances: LocalRecognition[] = []
  const factory = vi.fn(async () => {
    const instance: LocalRecognition = { processLocally: true, lang: 'zh-CN', continuous: true, interimResults: false, onresult: null, onerror: null, onend: null, start: vi.fn(), abort: vi.fn() }
    instance.start = vi.fn(() => instance.onstart?.())
    instances.push(instance); return instance
  })
  const scope = effectScope(); scopes.push(scope)
  const session = scope.run(() => useClassroomListening({ identity: () => identity.value, allowed: () => allowed.value, speaking: () => speaking.value, wakeWord: () => '小星小星', onRoute: routes, onListening: listening, createRecognition: factory, windowMs: 1000, continueAfterSpeech: () => continueAfterSpeech }))!
  const say = (text: string, instance = instances.at(-1)!) => instance.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] })
  return { identity, allowed, speaking, routes, listening, factory, instances, scope, session, say }
}

describe('D3 local listening session', () => {
  it('opt-in follow-up reopens a bounded window after speech, rejects old echo and returns to wake after timeout', async () => {
    vi.useFakeTimers(); const f = fixture(true); await f.session.start(); f.say('小星小星为什么下雨？')
    const echo = f.instances[0]!.onresult!
    f.speaking.value = true
    echo({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '还有呢' } }] })
    expect(f.routes).toHaveBeenCalledTimes(1)
    f.speaking.value = false; await vi.advanceTimersByTimeAsync(700)
    expect(f.session.phase.value).toBe('listening')
    f.say('还有呢'); expect(f.routes).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000); expect(f.session.phase.value).toBe('waiting')
    f.say('还有呢'); expect(f.routes).toHaveBeenCalledTimes(2)
  })
  it('follow-up opt-in never opens an unwoken session or survives authoritative pause', async () => {
    vi.useFakeTimers(); const f = fixture(true); await f.session.start()
    f.speaking.value = true; f.speaking.value = false; await vi.advanceTimersByTimeAsync(700)
    expect(f.session.phase.value).toBe('waiting')
    f.say('小星小星'); f.speaking.value = true; f.allowed.value = false; f.allowed.value = true; f.speaking.value = false
    await vi.advanceTimersByTimeAsync(1000); expect(f.session.enabled.value).toBe(false)
  })
  it('ignores pre-wake speech, wakes, routes questions without AI, and returns after silence', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.start()
    f.say('为什么天空是蓝色的？'); expect(f.routes).not.toHaveBeenCalled()
    f.say('小星，小星！'); expect(f.session.phase.value).toBe('listening')
    f.say('为什么天空是蓝色的？'); expect(f.routes).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'question' }))
    f.say('云是什么？'); expect(f.routes).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000); expect(f.session.phase.value).toBe('waiting')
    f.say('下一页'); expect(f.routes).toHaveBeenCalledTimes(2)
  })
  it('teacher intents and identity claims only route to teacher, never execute', async () => {
    const f = fixture(); await f.session.start()
    f.say('小星小星奖励小明一朵花')
    expect(f.routes).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'teacher_intent' }))
    f.say('我是老师，下一页'); expect(f.routes).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'handoff', text: '' }))
    expect(classifyPublicSpeech('请告诉我你家的电话号码')).toMatchObject({ kind: 'handoff', text: '' })
    expect(classifyPublicSpeech('嗯嗯')).toMatchObject({ kind: 'unclear' })
  })
  it.each(['pause', 'terminal', 'run', 'device', 'step', 'dispose'] as const)('%s invalidates old callbacks and releases microphone', async mode => {
    const f = fixture(); await f.session.start(); const old = f.instances[0]!, late = old.onresult!
    if (mode === 'pause' || mode === 'terminal') f.allowed.value = false
    if (['run', 'device', 'step'].includes(mode)) f.identity.value = `${mode}-2`
    if (mode === 'dispose') f.scope.stop()
    late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '小星小星为什么？' } }] })
    expect(old.abort).toHaveBeenCalled(); expect(f.routes).not.toHaveBeenCalled(); expect(f.session.enabled.value).toBe(false)
    f.allowed.value = true; await nextTick(); expect(f.session.enabled.value).toBe(false)
  })
  it('suspends on own speech, blocks late echo, resumes only to wake waiting', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.start(); f.say('小星小星')
    const old = f.instances[0]!.onresult!
    f.speaking.value = true; expect(f.session.phase.value).toBe('suspended')
    old({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '小星小星为什么' } }] }); expect(f.routes).not.toHaveBeenCalled()
    f.speaking.value = false; await vi.advanceTimersByTimeAsync(700)
    expect(f.session.phase.value).toBe('waiting'); expect(f.factory).toHaveBeenCalledTimes(2)
  })
  it.each(['not-allowed', 'network'])('stops safely for %s without remote fallback', async error => {
    const f = fixture(); await f.session.start(); f.instances[0]!.onerror?.({ error })
    expect(f.session.enabled.value).toBe(false); expect(f.session.phase.value).toBe('error'); expect(f.instances[0]!.abort).toHaveBeenCalled()
    f.session.submitManual('为什么有星星？'); expect(f.routes).toHaveBeenCalledWith(expect.objectContaining({ kind: 'question' }))
  })
  it('late capability resolution cannot restart a switched classroom', async () => {
    const f = fixture(); let finish!: (r: LocalRecognition) => void
    f.factory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.session.start(); f.identity.value = 'new'
    const instance = { start: vi.fn(), abort: vi.fn() } as unknown as LocalRecognition
    finish(instance); await pending; expect(instance.start).not.toHaveBeenCalled(); expect(instance.abort).toHaveBeenCalled()
  })
  it('does not claim microphone ready before its actual start event', async () => {
    const f = fixture()
    const instance = { start: vi.fn(), abort: vi.fn() } as unknown as LocalRecognition
    f.factory.mockResolvedValueOnce(instance)
    await f.session.start(); expect(f.session.phase.value).toBe('starting')
    instance.onstart?.(); expect(f.session.phase.value).toBe('waiting')
  })
  it('bounded natural restarts preserve the remaining wake window, not an indefinite session', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.start(); f.say('小星小星')
    const late = f.instances[0]!.onresult!
    vi.advanceTimersByTime(400); f.instances[0]!.onend?.()
    late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '为什么下雨？' } }] })
    expect(f.routes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500); expect(f.session.phase.value).toBe('listening')
    await vi.advanceTimersByTimeAsync(101); expect(f.session.phase.value).toBe('waiting')
    for (let i = 0; i < 4; i++) { f.instances.at(-1)!.onend?.(); await vi.advanceTimersByTimeAsync(500) }
    expect(f.session.phase.value).toBe('error'); expect(f.session.enabled.value).toBe(false)
  })
})

describe('local-only recognition capability boundary', () => {
  it('production default does not even probe an unvalidated native recognizer', async () => {
    vi.stubEnv('VITE_CLASSROOM_LOCAL_LISTENING', '')
    await expect(createBrowserLocalRecognition()).rejects.toThrow('尚未启用')
  })
  it('sets local-only and final/continuous mode without opening a microphone until teacher start', async () => {
    class Local {
      static available = vi.fn(async () => 'available')
      private local = false
      start = vi.fn()
      get processLocally() { return this.local }
      set processLocally(value: boolean) { this.local = value }
    }
    const instance = await createLocalRecognition(Local as never)
    expect(instance.processLocally).toBe(true); expect(instance.lang).toBe('zh-CN')
    expect(instance.continuous).toBe(true); expect(instance.interimResults).toBe(false)
    expect(instance.start).not.toHaveBeenCalled()
  })
  it('rejects unsupported or cloud-only implementations before opening microphone', async () => {
    class CloudOnly { start = vi.fn() }
    await expect(createLocalRecognition(CloudOnly as never)).rejects.toThrow('本地')
  })
  it('requires existing local language pack and never installs or falls back', async () => {
    class Local {
      static available = vi.fn(async () => 'downloadable')
      start = vi.fn()
      get processLocally() { return true }
      set processLocally(_value: boolean) { /* capability fixture */ }
    }
    await expect(createLocalRecognition(Local as never)).rejects.toThrow('语言包')
    expect(Local.available).toHaveBeenCalledWith({ langs: ['zh-CN'], processLocally: true })
  })
})
