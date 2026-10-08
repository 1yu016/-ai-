import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import {
  normalizeServerResource,
  type ServerResource,
} from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const videoResource: ServerResource = {
  id: 2, title: '忍者', aliases: [], description: '认识忍者',
  resourceType: 'video', category: '视频动画', ageGroup: 'all', tags: [],
  fileUrl: '/resources/2/download', coverUrl: null, fileName: 'ino.mp4',
  mimeType: 'video/mp4', fileSize: 7000000, duration: 17,
  reviewStatus: 'approved', createdAt: '2026-01-01T00:00:00.000Z',
}
const secondVideo: ServerResource = { ...videoResource, id: 3, title: '第二段', fileUrl: '/resources/3/download' }

const mocks = vi.hoisted(() => ({ fetchBlob: vi.fn() }))
vi.mock('@/api/resources', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/resources')>()
  return { ...original, fetchAuthedBlob: mocks.fetchBlob }
})

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const revokeSpies: ReturnType<typeof vi.fn>[] = []
let committedBlobs: string[] = []

function setupBlobGlobals() {
  committedBlobs = []
  revokeSpies.length = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const blob = `blob:media-${committedBlobs.length}`
    committedBlobs.push(blob)
    return blob
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    const idx = committedBlobs.indexOf(String(url))
    if (idx >= 0) committedBlobs.splice(idx, 1)
  })
}

function stubMediaElement() {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true, get() { return this._t ?? 0 }, set(v: number) { this._t = v },
  })
}

async function openVideo(store: ReturnType<typeof useResourcePlayerStore>, server: ServerResource) {
  const normalized = normalizeServerResource(server)!
  store.openResource(normalized, false)
  await flushPromises()
}

describe('ResourcePlayer protected media blob lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupBlobGlobals()
    stubMediaElement()
    mocks.fetchBlob.mockReset()
  })
  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('loads a video via the authenticated blob and binds the object URL as the video src', async () => {
    mocks.fetchBlob.mockImplementation(async (id: number) => {
      const revoke = vi.fn(); revokeSpies.push(revoke)
      return { url: `blob:media-${id}`, revoke }
    })
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    await openVideo(useResourcePlayerStore(), videoResource)
    expect(mocks.fetchBlob).toHaveBeenCalledWith(2)
    expect(wrapper.get('video.stage-video').attributes('src')).toMatch(/^blob:media-2/)
  })

  it('revokes the previous blob object URL when switching resources', async () => {
    mocks.fetchBlob.mockImplementation(async (id: number) => {
      const revoke = vi.fn(); revokeSpies.push(revoke)
      return { url: `blob:media-${id}`, revoke }
    })
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    await openVideo(store, videoResource)
    await openVideo(store, secondVideo)
    expect(revokeSpies.length).toBe(2)
    expect(revokeSpies[0]).toHaveBeenCalled()
    expect(wrapper.get('video.stage-video').attributes('src')).toBe('blob:media-3')
  })

  it('revokes the object URL when the player is closed', async () => {
    mocks.fetchBlob.mockImplementation(async (id: number) => {
      const revoke = vi.fn(); revokeSpies.push(revoke)
      return { url: `blob:media-${id}`, revoke }
    })
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    await openVideo(store, videoResource)
    await (wrapper.vm as unknown as { close: () => Promise<void> }).close()
    await flushPromises()
    expect(revokeSpies[0]).toHaveBeenCalled()
    expect(store.currentResource).toBeNull()
  })

  it('revokes the object URL on component unmount', async () => {
    mocks.fetchBlob.mockImplementation(async (id: number) => {
      const revoke = vi.fn(); revokeSpies.push(revoke)
      return { url: `blob:media-${id}`, revoke }
    })
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    await openVideo(useResourcePlayerStore(), videoResource)
    wrapper.unmount()
    // blob 回收在元素 src 引用清空后的 nextTick 执行，需等待微任务。
    await flushPromises()
    expect(revokeSpies[0]).toHaveBeenCalled()
  })

  it('does not clear the previous source or play an empty source while a fetch is in flight', async () => {
    // 首次打开：fetch 挂起（未 resolve），mediaSource 仍为空，此时发起播放不应抛 NotSupportedError，
    // 也不应调用底层 media.play()（空源播放）。
    let resolveFetch!: (v: { url: string; revoke: () => void }) => void
    const pendingRevoke = vi.fn()
    mocks.fetchBlob.mockImplementation(() => new Promise((res) => { resolveFetch = res }))

    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    await openVideo(store, videoResource) // flushPromises 后 fetch 仍未 resolve

    const mediaPlay = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>
    await (wrapper.vm as unknown as { play: () => Promise<void> }).play()
    // 空源守卫：未调用底层 play
    expect(mediaPlay).not.toHaveBeenCalled()
    expect((store.playerStatus as string)).not.toBe('error')

    // fetch 完成后才释放上一条 blob 并绑定新源
    resolveFetch({ url: 'blob:media-2', revoke: pendingRevoke })
    await flushPromises()
    expect(wrapper.get('video.stage-video').attributes('src')).toBe('blob:media-2')
  })

  it('does not keep a dirty object URL and reports an error when the protected fetch fails', async () => {
    mocks.fetchBlob.mockRejectedValue(new Error('401'))
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    await openVideo(store, videoResource)
    await flushPromises()
    expect(store.playerStatus).toBe('error')
    expect(store.errorMessage).toContain('暂时无法加载')
    expect(wrapper.get('video.stage-video').attributes('src') ?? '').toBe('')
    expect(revokeSpies.length).toBe(0)
  })

  it('does not call media.play() on an empty protected source (NotSupportedError guard)', async () => {
    // fetch 悬而未决：mediaSource 保持为空字符串，模拟加载竞态窗口。
    mocks.fetchBlob.mockImplementation(() => new Promise(() => {}))
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    store.openResource(normalizeServerResource(videoResource)!, false)
    await flushPromises()
    expect(wrapper.get('video.stage-video').attributes('src') ?? '').toBe('')
    // 源为空时任何播放入口（resume/play 控制请求）都不得真正调用 play()。
    store.requestControl('resume')
    store.requestControl('play')
    await flushPromises()
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('discards a slow stale fetch that resolves after a newer resource, revoking only its own blob', async () => {
    // A(id2) 慢、B(id3) 快：B 先 resolve 成为当前资源；A 之后才 resolve。
    // 期望：mediaSource 仍是 blob:B；A 自己的 blob 被 revoke；当前 B 的 blob 不受影响。
    let resolveA!: (v: { url: string; revoke: () => void }) => void
    let resolveB!: (v: { url: string; revoke: () => void }) => void
    const revokeA = vi.fn()
    const revokeB = vi.fn()
    mocks.fetchBlob.mockImplementation((id: number) => {
      if (id === 2) return new Promise((res) => { resolveA = res })
      return new Promise((res) => { resolveB = res })
    })

    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()

    // 打开 A → fetch(2) 挂起
    store.openResource(normalizeServerResource(videoResource)!, false)
    await flushPromises()
    // 切到 B → fetch(3) 挂起
    store.openResource(normalizeServerResource(secondVideo)!, false)
    await flushPromises()

    // B 先返回：B 成为当前 mediaSource
    resolveB({ url: 'blob:media-3', revoke: revokeB })
    await flushPromises()
    expect(wrapper.get('video.stage-video').attributes('src')).toBe('blob:media-3')

    // A 后返回（迟到/stale）：不得覆盖 B，只回收自己的 blobA
    resolveA({ url: 'blob:media-2', revoke: revokeA })
    await flushPromises()
    expect(wrapper.get('video.stage-video').attributes('src')).toBe('blob:media-3')
    expect(store.currentResource?.id).toBe(3)
    expect(revokeA).toHaveBeenCalled()
    expect(revokeB).not.toHaveBeenCalled()
  })

  it('invalidates a pending load on close: late blob is revoked and never re-opens the player', async () => {
    let resolveA!: (v: { url: string; revoke: () => void }) => void
    const revokeA = vi.fn()
    mocks.fetchBlob.mockImplementation(() => new Promise((res) => { resolveA = res }))

    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    store.openResource(normalizeServerResource(videoResource)!, false)
    await flushPromises() // fetch(2) 仍 pending

    await (wrapper.vm as unknown as { close: () => Promise<void> }).close()
    await flushPromises()
    expect(store.currentResource).toBeNull()
    expect(store.playerStatus).toBe('idle')

    // close 之后 A 才返回：必须视为 stale，只 revoke 自己，不得写回 mediaSource / 重开播放器
    resolveA({ url: 'blob:media-2', revoke: revokeA })
    await flushPromises()
    expect(revokeA).toHaveBeenCalled()
    expect(store.currentResource).toBeNull()
    expect(store.playerStatus).toBe('idle')
    expect(wrapper.find('video.stage-video').exists()).toBe(false)
  })

  it('invalidates pending loads on unmount: late blob is revoked without leaking or writing state', async () => {
    let resolveA!: (v: { url: string; revoke: () => void }) => void
    const revokeA = vi.fn()
    mocks.fetchBlob.mockImplementation(() => new Promise((res) => { resolveA = res }))

    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    useResourcePlayerStore().openResource(normalizeServerResource(videoResource)!, false)
    await flushPromises() // fetch(2) 仍 pending

    wrapper.unmount() // 触发 onBeforeUnmount → invalidateMediaLoad

    resolveA({ url: 'blob:media-2', revoke: revokeA })
    await flushPromises()
    expect(revokeA).toHaveBeenCalled() // stale → 回收自身 blob，无 object URL 泄漏
  })

  it('treats a pending video fetch as stale when switching to a protected image', async () => {
    const imageResource: ServerResource = {
      id: 4, title: '插图', aliases: [], description: '认识忍者',
      resourceType: 'image', category: '视频动画', ageGroup: 'all', tags: [],
      fileUrl: '/resources/4/download', coverUrl: null, fileName: 'ninja.png',
      mimeType: 'image/png', fileSize: 2048, duration: null,
      reviewStatus: 'approved', createdAt: '2026-01-01T00:00:00.000Z',
    }
    let resolveA!: (v: { url: string; revoke: () => void }) => void
    let resolveImage!: (v: { url: string; revoke: () => void }) => void
    const revokeA = vi.fn()
    const revokeImage = vi.fn()
    mocks.fetchBlob.mockImplementation((id: number) => new Promise((res) => {
      if (id === 2) resolveA = res
      else resolveImage = res
    }))

    const wrapper = mount(ResourcePlayer, { props: { resources: [] }, global: { plugins: [ElementPlus] } })
    const store = useResourcePlayerStore()
    store.openResource(normalizeServerResource(videoResource)!, false)
    await flushPromises() // video A 的 fetch 仍 pending

    store.openResource(normalizeServerResource(imageResource)!, false)
    await flushPromises() // 切到 image：新的鉴权请求使 A 失效

    resolveImage({ url: 'blob:image-4', revoke: revokeImage })
    await flushPromises()

    resolveA({ url: 'blob:media-2', revoke: revokeA })
    await flushPromises()
    expect(revokeA).toHaveBeenCalled() // A stale → 只 revoke 自己
    expect(store.currentResource?.id).toBe(4) // 当前仍是 image
    expect(wrapper.find('video.stage-video').exists()).toBe(false) // video 已卸载
    expect(wrapper.get('img.stage-image').attributes('src')).toBe('blob:image-4')
    expect(revokeImage).not.toHaveBeenCalled()
  })
})
