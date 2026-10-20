import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ play: vi.fn(), native: vi.fn<(text: string, options: { onStart?: () => void; onEnd?: () => void }) => boolean>(() => true) }))
vi.mock('@/services/backendTts', () => ({ playBackendTts: mocks.play }))
vi.mock('@/services/browserSpeech', () => ({ speakBrowserText: mocks.native }))
beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_CLASSROOM_REAL_TTS', 'true'); mocks.play.mockReset(); mocks.native.mockClear() })
afterEach(() => vi.unstubAllEnvs())
async function setup() {
  const { useDialogueSpeech } = await import('@/composables/useDialogueSpeech')
  const state = reactive({ allowed: true }), scope = effectScope()
  const speech = scope.run(() => useDialogueSpeech({ identity: () => 'r1', allowed: () => state.allowed, enabled: () => true, onSpeaking() {} }))!
  speech.begin(); return { speech, state, scope }
}
it('late synthesis failure after classroom pause never starts native fallback', async () => {
  let finish!: () => void
  mocks.play.mockImplementation(({ onError }) => new Promise(resolve => { finish = () => { onError?.(); resolve('failed') } }))
  const { speech, state, scope } = await setup()
  try {
    speech.append('旧回答。'); state.allowed = false; finish()
    await Promise.resolve(); await Promise.resolve()
    expect(mocks.native).not.toHaveBeenCalled(); expect(speech.occupied.value).toBe(false)
  } finally { scope.stop() }
})
it('startup failure can fall back once without invalidating the live queue', async () => {
  mocks.play.mockImplementation(async ({ onError }) => { onError?.(); return 'failed' })
  const { speech, scope } = await setup()
  try {
    speech.append('新回答。'); await Promise.resolve(); await Promise.resolve()
    expect(mocks.native).toHaveBeenCalledOnce()
    expect(speech.error.value).toBe(''); expect(speech.occupied.value).toBe(true)
    const callbacks = mocks.native.mock.calls[0]![1]
    callbacks.onStart?.(); expect(speech.speaking.value).toBe(true)
    callbacks.onEnd?.(); expect(speech.occupied.value).toBe(false)
  } finally { scope.stop() }
})
