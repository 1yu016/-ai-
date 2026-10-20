import { onScopeDispose, ref, watch } from 'vue'
import { pauseBrowserSpeech, playExclusiveAudio, resumeBrowserSpeech, stopBrowserSpeech } from '@/services/browserSpeech'

/** Owns only this teacher's teaching output. Never controls resource media or ASR tracks. */
export function useTeachingSpeech(deps: {
  identity: () => string
  allowed: () => boolean
  authorize: (text: string) => Promise<unknown>
  requestAudio: (text: string) => Promise<string>
  onSpeaking: (speaking: boolean) => void
  onError: (cause: unknown) => void
}) {
  const loading = ref(false), speaking = ref(false), paused = ref(false)
  let sequence = 0, control = 0, disposed = false, authorizing = false
  let audio: HTMLAudioElement | null = null
  let owner = ''
  function stop() {
    const wasSpeaking = speaking.value || paused.value
    sequence++; control++; authorizing = false
    const owned = audio; audio = null; owner = ''
    const stoppedOwnedAudio = owned ? stopBrowserSpeech(owned) : false
    loading.value = false; speaking.value = false; paused.value = false
    if (wasSpeaking && stoppedOwnedAudio) deps.onSpeaking(false)
  }
  const valid = (id: number, source: string) => !disposed && id === sequence && source === deps.identity() && deps.allowed()
  async function play(text: string) {
    if (!text.trim() || !deps.allowed() || disposed) return false
    stop()
    const id = sequence, source = deps.identity()
    owner = source; loading.value = true; authorizing = true
    try {
      await deps.authorize(text)
      if (id !== sequence) return false
      authorizing = false
      if (!valid(id, source)) { stop(); return false }
      const url = await deps.requestAudio(text)
      if (!valid(id, source)) return false
      if (!url.trim()) throw new Error('语音服务未返回可播放内容')
      const revision = control
      await playExclusiveAudio(url, {
        isCurrent: () => valid(id, source),
        onCreated: instance => { if (valid(id, source)) audio = instance },
        onEnded: () => { if (id === sequence) { audio = null; stop(); deps.onSpeaking(false) } },
        onError: () => { if (id === sequence) { audio = null; stop(); deps.onSpeaking(false); deps.onError(new Error('语音播放失败')) } },
      })
      if (!valid(id, source)) return false
      if (revision !== control) { if (paused.value && audio) pauseBrowserSpeech(audio); return false }
      speaking.value = true; deps.onSpeaking(true); return true
    } catch (cause) {
      if (id === sequence && !disposed) {
        if (cause instanceof DOMException && cause.name === 'AbortError') { stop(); return false }
        if (paused.value) return false
        stop(); deps.onError(cause)
      }
      return false
    } finally { if (id === sequence) loading.value = false }
  }
  function pause() {
    if (!audio || loading.value) { stop(); return }
    control++
    if (!pauseBrowserSpeech(audio)) { stop(); return }
    speaking.value = false; paused.value = true; deps.onSpeaking(false)
  }
  async function resume() {
    if (!audio || !paused.value || owner !== deps.identity() || !deps.allowed() || disposed) { stop(); return false }
    const id = sequence, revision = ++control, source = owner, owned = audio
    try {
      const resumed = await resumeBrowserSpeech(owned)
      if (!valid(id, source) || revision !== control || audio !== owned) {
        if (id === sequence && paused.value) pauseBrowserSpeech(owned)
        return false
      }
      if (!resumed) { stop(); return false }
      paused.value = false; speaking.value = true; deps.onSpeaking(true); return true
    } catch (cause) {
      if (id === sequence && revision === control) { stop(); deps.onError(cause) }
      return false
    }
  }
  watch(deps.identity, stop, { flush: 'sync' })
  watch(deps.allowed, allowed => { if (!allowed && !authorizing) stop() }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; stop() })
  return { loading, speaking, paused, play, pause, resume, stop }
}
