import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'
import { presentationOrigin, type PresentationOrigin, useResourcePlayerStore } from '@/stores/resourcePlayer'

const a = Object.freeze({ runId: 9, deviceId: 1, presentationCommandId: 'A', presentationRevision: 2 })
const b = Object.freeze({ ...a, presentationCommandId: 'B', presentationRevision: 3 })
function state(context: PresentationOrigin = a, version = 3): ClassroomRunPayload {
  return { id: context.runId, deviceId: context.deviceId, version, status: 'running', lessonPlanId: 1,
    currentStepIndex: 0, title: '合成课堂', steps: [], startedAt: '', updatedAt: '',
    playerRecoverySuggestion: { resourceId: 12, ...context } }
}
describe('player feedback immutable origin', () => {
  let store: ReturnType<typeof useLessonRunStore>
  beforeEach(() => { setActivePinia(createPinia()); store = useLessonRunStore(); store.adoptRun(state()) })
  afterEach(() => { store.clearRun(); vi.restoreAllMocks() })
  it('sends only observation fields with event origin, never current control JSON', async () => {
    const result = state(a, 4)
    result.playerRecoverySuggestion!.observation = { ...a, status: 'playing' }
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: result })
    expect(await store.savePlayerState({ status: 'playing', currentTime: 5, presentationCommandId: 'forged', presentationMode: 'avatar' }, a)).toEqual(result)
    expect(post.mock.calls[0]![1]).toMatchObject({ version: 3, deviceId: 1, playerState: { presentationCommandId: 'A', presentationRevision: 2, currentTime: 5 } })
    expect((post.mock.calls[0]![1] as { playerState: object }).playerState).not.toHaveProperty('presentationMode')
  })
  it('never fills missing identity from current Run', async () => {
    const post = vi.spyOn(http, 'post')
    expect(await store.savePlayerState({ currentTime: 99 })).toBeNull()
    expect(presentationOrigin(9, 1, { resourceId: 12 })).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it.each(['different resource', 'same resource'])('drops A timer after B: %s', async () => {
    const post = vi.spyOn(http, 'post')
    store.adoptRun(state(b, 5))
    expect(await store.savePlayerState({ resourceId: 12, currentTime: 99 }, a)).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it.each([{ ...a, runId: 10 }, { ...a, deviceId: 2 }])('drops old Run/device event %j', async next => {
    const post = vi.spyOn(http, 'post')
    store.adoptRun(state(next, 5))
    expect(await store.savePlayerState({ status: 'ended' }, a)).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
  it('late checkpoint response cannot overwrite B or newer query state', async () => {
    let resolve!: (value: { data: ClassroomRunPayload }) => void
    vi.spyOn(http, 'post').mockImplementation(() => new Promise(r => { resolve = r }))
    const pending = store.savePlayerState({ currentTime: 99 }, a)
    store.adoptRun(state(b, 5))
    resolve({ data: state(a, 9) }); await pending
    expect(store.run?.playerRecoverySuggestion?.presentationCommandId).toBe('B')
    expect(store.run?.version).toBe(5)
  })
  it('HTTP 200 with stale/absent observation does not confirm playback', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: state(b, 5) })
    expect(await store.savePlayerState({ status: 'playing' }, a)).toBeNull()
    expect(store.run?.playerRecoverySuggestion?.presentationCommandId).toBe('B')
  })
  it('preview open and close invalidate previous origin/session', () => {
    const player = useResourcePlayerStore()
    const resource = { id: 12, title: '合成视频', mediaType: 'video' } as Parameters<typeof player.openResource>[0]
    player.openResource(resource, false, a)
    const first = player.playbackSession
    player.openResource(resource, false, b)
    expect(player.origin).toEqual(b); expect(player.playbackSession).toBeGreaterThan(first)
    player.openResource(resource, false)
    expect(player.origin).toBeNull()
    player.close(); expect(player.origin).toBeNull()
  })
})
