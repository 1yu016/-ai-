import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { deviceSessionApi } from '@/api/deviceSession'
import { useLessonRunStore, type ClassroomScreenState } from '@/stores/lessonRun'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import ClassroomScreenView from '@/views/ClassroomScreenView.vue'

const mocks = vi.hoisted(() => ({ onState: null as null | ((s: ClassroomScreenState) => Promise<void>), resource: vi.fn() }))
vi.mock('@/services/classroomRealtime', () => ({ connectScreenRealtime: (options: { onState: typeof mocks.onState }) => { mocks.onState = options.onState; return new AbortController() } }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ accessToken: 'teacher', isLogin: true }) }))
vi.mock('@/stores/courseResource', () => ({ useCourseResourceStore: () => ({ getResourceById: () => null, ensureResourceById: mocks.resource, sortedResources: [], refreshLibrary: vi.fn() }) }))
vi.mock('@/stores/classroomAssistant', () => ({ useClassroomAssistantStore: () => ({ endInteraction: vi.fn() }) }))
vi.mock('@/components/DigitalHumanStage.vue', () => ({ default: { template: '<div data-test="avatar">数字人</div>' } }))
vi.mock('@/components/ResourcePlayer.vue', () => ({ default: { template: '<div />' } }))

let now = 0
function state(active = true, paused = false): ClassroomScreenState {
  return { page: active ? 'classroom' : 'idle', deviceId: 1, serverNow: new Date(++now * 1000).toISOString(), classroomState: active ? {
    id: 45, lessonPlanId: 1, deviceId: 1, classId: 1, version: 1, status: paused ? 'paused' : 'running', title: '当前课堂',
    currentStepIndex: 0, steps: [{ stepIndex: 0, title: '当前步骤', type: 'resource', content: '观察', durationSeconds: 60, resourceId: null }],
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), playerRecoverySuggestion: { resourceId: 3, status: 'playing', presentationCommandId: 'screen-A', presentationRevision: 1 },
  } : null }
}
async function setup(initial: ClassroomScreenState) {
  const pinia = createPinia(); setActivePinia(pinia)
  vi.spyOn(http, 'get').mockResolvedValue({ data: initial } as never)
  vi.spyOn(http, 'post').mockResolvedValue({ data: initial.classroomState } as never)
  vi.spyOn(deviceSessionApi, 'issue').mockResolvedValue({ data: { token: 'device-only' } } as never)
  const heartbeat = vi.spyOn(deviceSessionApi, 'heartbeat').mockResolvedValue({ data: { online: true, status: 'online' } } as never)
  mocks.resource.mockResolvedValue({ id: 3, title: '视频', mediaType: 'video' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/classroom/screen/:deviceId', component: ClassroomScreenView }] })
  await router.push('/classroom/screen/1')
  const wrapper = mount(ClassroomScreenView, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, heartbeat, run: useLessonRunStore(), player: useResourcePlayerStore() }
}
describe('screen terminal lifecycle', () => {
  it('debounced feedback keeps the original sample and command identity', async () => {
    const { wrapper, player } = await setup(state())
    vi.mocked(http.post).mockClear()
    player.setProgress(7, 30); player.setStatus('playing')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1800)
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(vi.mocked(http.post).mock.calls[0]![1]).toMatchObject({ deviceId: 1, playerState: {
      presentationCommandId: 'screen-A', presentationRevision: 1, currentTime: 7, status: 'playing',
    } })
    wrapper.unmount()
  })
  it('a queued A timer cannot be relabelled as B when the resource is unchanged', async () => {
    const { wrapper, player } = await setup(state())
    vi.mocked(http.post).mockClear()
    player.setProgress(99); await flushPromises()
    const next = state(); next.classroomState!.version = 2
    Object.assign(next.classroomState!.playerRecoverySuggestion!, { presentationCommandId: 'screen-B', presentationRevision: 2 })
    await mocks.onState!(next); await flushPromises()
    await vi.advanceTimersByTimeAsync(1800)
    const calls = vi.mocked(http.post).mock.calls
    for (const [, body] of calls) {
      expect(body).not.toMatchObject({ playerState: { presentationCommandId: 'screen-B', currentTime: 99 } })
      expect(body).not.toMatchObject({ playerState: { presentationCommandId: 'screen-A' } })
    }
    expect(player.origin?.presentationCommandId).toBe('screen-B')
    wrapper.unmount()
  })
  it('unmount cancels queued player feedback', async () => {
    const { wrapper, player } = await setup(state())
    vi.mocked(http.post).mockClear()
    player.setProgress(99); await flushPromises()
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(1800)
    expect(http.post).not.toHaveBeenCalled()
  })
  it('shows explicit student text and never falls back to teacher instruction', async () => {
    const initial = state();
    initial.classroomState!.playerRecoverySuggestion = undefined;
    Object.assign(initial.classroomState!.steps[0]!, { content: '一起寻找数字1', instruction: '内部备注：观察反应' });
    const { wrapper } = await setup(initial);
    expect(wrapper.text()).toContain('一起寻找数字1');
    expect(wrapper.text()).not.toContain('内部备注');
    const empty = state();
    empty.classroomState!.playerRecoverySuggestion = undefined;
    Object.assign(empty.classroomState!.steps[0]!, { content: '', instruction: '内部备注：不能展示' });
    await mocks.onState!(empty); await flushPromises();
    expect(wrapper.text()).not.toContain('一起寻找数字1');
    expect(wrapper.text()).not.toContain('内部备注');
    expect(wrapper.text()).toContain('请跟随老师');
    wrapper.unmount();
  });
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); now = 0; mocks.resource.mockReset() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
  it('a live play command autoplays after the screen already adopted a run without media', async () => {
    const initial = state();
    initial.classroomState!.playerRecoverySuggestion = undefined;
    const { wrapper, player } = await setup(initial);
    expect(player.currentResource).toBeNull();
    const next = state();
    next.classroomState!.playerRecoverySuggestion = { resourceId: 3, status: 'playing', operation: 'play_resource',
      presentationCommandId: 'screen-play', presentationRevision: 1, updatedAt: new Date().toISOString() };
    await mocks.onState!(next); await flushPromises();
    expect(player.currentResource?.id).toBe(3);
    expect(player.autoPlayOnOpen).toBe(true);
    wrapper.unmount();
  });
  it('restores static SUMMARY with handoff only, expires and does not load media', async () => {
    const summary: ClassroomScreenState = { ...state(false), page: 'summary', phase: 'summary',
      handoff: { id: 'server-lease' }, summary: { runId: 45, courseTitle: '认识数字1', endedAt: new Date().toISOString() },
      lifecycle: { schemaVersion: 1, phase: 'summary', runId: 45, deviceId: 1, bindingId: 1, revision: 3,
        enteredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5000).toISOString() }, serverNow: new Date().toISOString() };
    const { wrapper, player, run, heartbeat } = await setup(summary);
    expect(wrapper.get('[data-test="screen-summary"]').text()).toContain('谢谢小朋友');
    expect(sessionStorage.getItem('classroom-screen-handoff:1')).toBe('server-lease');
    expect(run.run).toBeNull(); expect(player.currentResource).toBeNull(); expect(mocks.resource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000); await flushPromises();
    expect(wrapper.find('[data-test="screen-summary"]').exists()).toBe(false);
    expect(sessionStorage.getItem('classroom-screen-handoff:1')).toBeNull();
    await mocks.onState!({ ...summary, serverNow: new Date().toISOString() }); await flushPromises();
    expect(wrapper.find('[data-test="screen-summary"]').exists()).toBe(false);
    expect(heartbeat).toHaveBeenCalled(); wrapper.unmount();
  });
  it('restores static opening without media, including pause/resume then teaching', async () => {
    const opening = { ...state(), phase: 'opening' as const, lifecycle: {
      schemaVersion: 1 as const, phase: 'opening' as const, runId: 45, deviceId: 1, bindingId: 1,
      revision: 1, enteredAt: new Date().toISOString(), expiresAt: null,
    } };
    const { wrapper, player } = await setup(opening);
    expect(wrapper.find('[data-test="screen-opening"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('等待老师进入教学');
    expect(player.currentResource).toBeNull(); expect(mocks.resource).not.toHaveBeenCalled();
    await mocks.onState!({ ...opening, ...state(true, true), phase: 'paused' }); await flushPromises();
    expect(wrapper.find('[data-test="screen-opening"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('课堂暂停，等待老师继续');
    await mocks.onState!({ ...opening, ...state(), phase: 'opening' }); await flushPromises();
    expect(mocks.resource).not.toHaveBeenCalled();
    await mocks.onState!({ ...state(), phase: 'teaching', lifecycle: { ...opening.lifecycle, phase: 'teaching', revision: 2 } }); await flushPromises();
    expect(wrapper.find('[data-test="screen-opening"]').exists()).toBe(false);
    await mocks.onState!(state(false)); await flushPromises();
    expect(wrapper.text()).toContain('等待老师开始课堂');
    wrapper.unmount();
  });
  it('renders server READY only, without Run, resource playback or lesson content', async () => {
    const ready: ClassroomScreenState = { ...state(false), page: 'ready', preparation: {
      preparationId: 'server-ready', revision: 1, deviceId: 1, classId: 1, classroomId: 1, lessonPlanId: 1, lessonPlanVersion: 1,
      courseTitle: '认识数字1', welcomeText: '欢迎小朋友，老师准备好后我们一起开始。', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(),
    }, serverNow: new Date().toISOString() }
    const { wrapper, run, player, heartbeat } = await setup(ready)
    expect(wrapper.get('[data-test="screen-ready"]').text()).toContain('认识数字1')
    expect(wrapper.text()).toContain('等待老师开始')
    expect(run.run).toBeNull(); expect(player.currentResource).toBeNull()
    expect(mocks.resource).not.toHaveBeenCalled()
    expect(wrapper.find('.lesson-copy').exists()).toBe(false)
    expect(heartbeat).toHaveBeenCalled()
    const idle = { ...state(false), serverNow: new Date(Date.now() + 1000).toISOString() }
    await mocks.onState!(idle); await flushPromises()
    expect(wrapper.find('[data-test="screen-ready"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('等待老师开始课堂')
    wrapper.unmount()
  })
  it('READY expires at its server deadline without stopping heartbeat', async () => {
    const ready: ClassroomScreenState = { ...state(false), page: 'ready', serverNow: new Date().toISOString(), preparation: {
      preparationId: 'expires-ready', revision: 1, deviceId: 1, classId: 1, classroomId: 1, lessonPlanId: 1, lessonPlanVersion: 1,
      courseTitle: '课程', welcomeText: '欢迎', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5000).toISOString(),
    } }
    const { wrapper, heartbeat } = await setup(ready)
    await vi.advanceTimersByTimeAsync(6000); await flushPromises()
    expect(wrapper.find('[data-test="screen-ready"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('等待老师开始课堂')
    await mocks.onState!({ ...ready, serverNow: new Date().toISOString() }); await flushPromises()
    expect(wrapper.find('[data-test="screen-ready"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(25000); await flushPromises()
    expect(heartbeat.mock.calls.length).toBeGreaterThan(1)
    wrapper.unmount()
  })
  it('keeps a clear waiting screen and heartbeats while idle; refresh remains idle', async () => {
    const { wrapper, heartbeat, run } = await setup(state(false))
    expect(wrapper.text()).toContain('等待老师开始课堂')
    expect(run.run).toBeNull()
    await vi.advanceTimersByTimeAsync(30000); await flushPromises()
    expect(heartbeat.mock.calls.length).toBeGreaterThan(1)
    expect(wrapper.text()).toContain('等待老师开始课堂')
    wrapper.unmount()
    const reopened = await setup(state(false))
    expect(reopened.wrapper.text()).toContain('等待老师开始课堂')
    expect(reopened.run.run).toBeNull()
    reopened.wrapper.unmount()
  })
  it.each([false, true])('restores running/paused and cleans everything on SSE idle (paused=%s)', async (paused) => {
    const { wrapper, run, player } = await setup(state(true, paused))
    expect(run.run?.status).toBe(paused ? 'paused' : 'running')
    expect(wrapper.get('[data-test="screen-classroom-status"]').text()).toBe(paused ? '课堂暂停，等待老师继续' : '正在课堂')
    expect(wrapper.find('[data-test="avatar"]').exists()).toBe(true)
    if (paused) expect(player.controlRequest?.action).toBe('pause')
    const old = state(true, paused)
    const idle = state(false)
    await mocks.onState!(idle); await flushPromises()
    expect(run.run).toBeNull(); expect(player.currentResource).toBeNull()
    expect(wrapper.find('[data-test="avatar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="screen-classroom-status"]').exists()).toBe(false)
    await mocks.onState!(old); await flushPromises()
    expect(run.run).toBeNull()
    wrapper.unmount()
  })
  it('ignores a resource load completing after idle', async () => {
    const { wrapper, run, player } = await setup(state(false))
    let resolve!: (resource: unknown) => void
    mocks.resource.mockImplementation(() => new Promise(r => { resolve = r }))
    const restoring = mocks.onState!(state())
    await flushPromises()
    await mocks.onState!(state(false))
    resolve({ id: 3, title: '旧视频', mediaType: 'video' })
    await restoring; await flushPromises()
    expect(run.run).toBeNull(); expect(player.currentResource).toBeNull()
    expect(wrapper.text()).toContain('等待老师开始课堂')
    wrapper.unmount()
  })
  it('pauses an already restored screen even when the presentation key is unchanged', async () => {
    const initial = state()
    initial.classroomState!.playerRecoverySuggestion!.currentTime = 12
    const { wrapper, run, player } = await setup(initial)
    expect(player.currentTime).toBe(12)
    const paused = state(true, true)
    paused.classroomState!.playerRecoverySuggestion!.currentTime = 12
    await mocks.onState!(paused); await flushPromises()
    expect(run.run?.status).toBe('paused')
    expect(wrapper.get('[data-test="screen-classroom-status"]').text()).toBe('课堂暂停，等待老师继续')
    expect(player.controlRequest?.action).toBe('pause')
    expect(player.currentTime).toBe(12)
    wrapper.unmount()
  })
  it('rejects an old GET after SSE idle and permits a new classroom', async () => {
    const { wrapper, run } = await setup(state())
    let resolve!: (response: unknown) => void
    vi.mocked(http.get).mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    const old = state()
    await vi.advanceTimersByTimeAsync(10000)
    await mocks.onState!(state(false))
    resolve({ data: old }); await flushPromises()
    expect(run.run).toBeNull()
    const next = state(); next.classroomState!.id = 46
    await mocks.onState!(next); await flushPromises()
    expect(run.run?.id).toBe(46)
    wrapper.unmount()
  })
  it('does not resurrect the run from a late checkpoint response', async () => {
    const { wrapper, run } = await setup(state())
    let resolve!: (response: unknown) => void
    vi.spyOn(http, 'post').mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    const result = run.savePlayerState({ currentTime: 2 }, useResourcePlayerStore().origin)
    const old = state().classroomState!
    await mocks.onState!(state(false))
    resolve({ data: { ...old, version: 2 } }); await result; await flushPromises()
    expect(run.run).toBeNull()
    wrapper.unmount()
  })
  it('shows recovery rather than a normal classroom when artwork hydration fails', async () => {
    const { wrapper, run, player } = await setup(state(false))
    vi.mocked(http.get).mockRejectedValueOnce(new Error('作品恢复失败'))
    const next = state()
    Object.assign(next.classroomState!.playerRecoverySuggestion!, { artworkId: 1, artworkFileUrl: '/artworks/1/file', artworkComment: '确认评价' })
    await mocks.onState!(next); await flushPromises()
    expect(wrapper.text()).toContain('课堂状态需要恢复')
    expect(run.run).toBeNull(); expect(player.currentResource).toBeNull()
    wrapper.unmount()
  })
})
