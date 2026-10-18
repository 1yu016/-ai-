import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

const runtime = vi.hoisted(() => ({
  load: vi.fn(),
  renderers: [] as Array<{ setAnimationLoop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeRenderer {
    domElement = document.createElement('canvas')
    renderLists = { dispose: vi.fn() }
    setAnimationLoop = vi.fn()
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    forceContextLoss = vi.fn()
    constructor() { runtime.renderers.push(this) }
  }
  return { ...actual, WebGLRenderer: FakeRenderer }
})

vi.mock('@/avatar/AvatarLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/avatar/AvatarLoader')>()
  return { ...actual, loadAvatarModel: runtime.load }
})

import ThreeAvatarStage from '@/components/avatar/ThreeAvatarStage.vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

function model() {
  return {
    root: new THREE.Group(),
    animations: [],
    format: 'glb' as const,
    mixer: {} as THREE.AnimationMixer,
    update: vi.fn(),
    playAnimation: vi.fn(() => true),
    setExpression: vi.fn(() => true),
    resetExpressions: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('ThreeAvatarStage lifecycle', () => {
  beforeEach(() => {
    runtime.load.mockReset()
    runtime.renderers.length = 0
    setActivePinia(createPinia())
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('disposes the previous model on every role switch and pauses rendering while hidden', async () => {
    const first = model()
    const second = model()
    runtime.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const store = useDigitalHumanStore()
    store.previewRuntime({
      character: { id: 11, name: '角色一', category: 'teacher_assistant' },
      model: { versionId: 1, engineVersion: '1', modelFormat: 'glb', modelUrl: '/avatar/one.glb' },
      voice: null,
      personality: null,
      fallbackLevel: 'none',
      reason: null,
      sourceScope: 'run',
    })
    const wrapper = mount(ThreeAvatarStage)
    await flushPromises()
    expect(runtime.load).toHaveBeenCalledTimes(1)

    store.previewRuntime({
      character: { id: 12, name: '角色二', category: 'teacher_assistant' },
      model: { versionId: 2, engineVersion: '1', modelFormat: 'glb', modelUrl: '/avatar/two.glb' },
      voice: null,
      personality: null,
      fallbackLevel: 'none',
      reason: null,
      sourceScope: 'run',
    })
    await flushPromises()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(runtime.load).toHaveBeenCalledTimes(2)

    const renderer = runtime.renderers.at(-1)!
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(expect.any(Function))

    wrapper.unmount()
    expect(second.dispose).toHaveBeenCalledTimes(1)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })
})

