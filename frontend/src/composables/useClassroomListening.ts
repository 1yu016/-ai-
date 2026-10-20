import { onScopeDispose, ref, watch } from 'vue'
import { classifyPublicSpeech, createBrowserLocalRecognition, type ListeningRoute, type LocalRecognition } from '@/services/classroomListening'

type Options = {
  identity: () => string; allowed: () => boolean; speaking: () => boolean; wakeWord: () => string
  onRoute: (route: ListeningRoute) => void; onListening: (active: boolean) => void
  createRecognition?: () => Promise<LocalRecognition>; windowMs?: number
  continueAfterSpeech?: () => boolean
}
/** A cancellable microphone session, not a classroom lifecycle or command state machine. */
export function useClassroomListening(options: Options) {
  const enabled = ref(false), phase = ref<'off' | 'starting' | 'waiting' | 'listening' | 'processing' | 'suspended' | 'error'>('off')
  const feedback = ref('互动尚未开启'), error = ref('')
  let generation = 0, recognition: LocalRecognition | null = null, deadline: ReturnType<typeof setTimeout> | undefined
  let restart: ReturnType<typeof setTimeout> | undefined
  let owner = '', expiresAt = 0, endedCount = 0
  let resumeAfterOutput = false
  let permission: PermissionStatus | null = null
  const permissionChanged = () => { if (permission?.state === 'denied') fail('麦克风权限已撤销，采集已停止，请使用手动输入。') }
  function detachPermission() { permission?.removeEventListener('change', permissionChanged); permission = null }
  const current = (id: number) => id === generation && enabled.value && options.allowed() && owner === options.identity() && !options.speaking()
  const clearWindow = () => { clearTimeout(deadline); expiresAt = 0; options.onListening(false) }
  function detach() {
    const old = recognition; recognition = null
    if (old) { old.onresult = old.onerror = old.onend = old.onstart = null; try { old.abort() } catch { /* inactive browser capture */ } }
  }
  function stop(message = '互动已关闭') {
    generation++; enabled.value = false; resumeAfterOutput = false; clearTimeout(restart); clearWindow(); detach()
    detachPermission()
    phase.value = 'off'; feedback.value = message
  }
  function fail(message: string) { stop(message); error.value = message; phase.value = 'error' }
  function waitForWake() {
    clearWindow(); phase.value = 'waiting'; feedback.value = `等待唤醒：“${options.wakeWord().trim()}”`
  }
  function listen(id: number) {
    clearTimeout(deadline); expiresAt = Date.now() + (options.windowMs ?? 10000)
    phase.value = 'listening'; feedback.value = '我在听，请说出问题。'; options.onListening(true)
    deadline = setTimeout(() => { if (current(id)) waitForWake() }, options.windowMs ?? 10000)
  }
  function receive(raw: string, id: number) {
    if (!current(id)) return
    const text = raw.trim().slice(0, 500), wake = options.wakeWord().trim()
    const normalized = text.replace(/[\s，。！？、,.!?]/g, '')
    const word = wake.replace(/\s/g, '')
    let content = text
    if (!expiresAt || Date.now() >= expiresAt) {
      if (!word || !normalized.startsWith(word)) { waitForWake(); return }
      listen(id); content = normalized.slice(word.length)
      if (!content) return
    } else if (normalized.startsWith(word)) content = normalized.slice(word.length)
    if (!content.trim()) return
    phase.value = 'processing'; options.onListening(false)
    const result = classifyPublicSpeech(content)
    options.onRoute(result)
    if (!current(id)) return
    listen(id); feedback.value = result.message
  }
  async function attach(id: number) {
    try {
      if (!permission && navigator.permissions?.query) {
        // Only observe permission; this does not request access or upload audio.
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null)
        if (!current(id)) return
        if (status) { permission = status; permission.addEventListener('change', permissionChanged) }
        if (permission?.state === 'denied') { fail('麦克风权限被拒绝，请使用手动输入。'); return }
      }
      const instance = await (options.createRecognition ?? createBrowserLocalRecognition)()
      if (!current(id)) { instance.abort(); return }
      recognition = instance
      const ownsCapture = () => current(id) && recognition === instance
      instance.onstart = () => {
        if (!ownsCapture()) return
        if (resumeAfterOutput && options.continueAfterSpeech?.()) { resumeAfterOutput = false; listen(id); feedback.value = '可以继续问，短暂免唤醒窗口已开启。' }
        else if (expiresAt > Date.now()) phase.value = 'listening'
        else waitForWake()
      }
      instance.onresult = event => {
        if (!ownsCapture()) return
        endedCount = 0
        for (let index = event.resultIndex; index < event.results.length; index++) {
          if (event.results[index]?.isFinal) receive(event.results[index]![0].transcript, id)
        }
      }
      instance.onerror = event => { if (ownsCapture()) fail(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? '麦克风或本地识别权限被拒绝，请使用手动输入。' : `识别已停止（${event.error}），请重新开启或手动输入；不会转用云端。`) }
      instance.onend = () => {
        if (!ownsCapture()) return
        detach()
        if (++endedCount > 3) { fail('本地识别连续结束，请检查麦克风后重新开启。'); return }
        restart = setTimeout(() => { if (current(id)) void attach(id) }, 500)
      }
      instance.start()
    } catch (cause) { if (current(id)) fail(cause instanceof Error ? cause.message : '本地识别不可用，请手动输入。') }
  }
  async function start() {
    stop(); error.value = ''
    if (!options.allowed()) { feedback.value = '当前课堂不允许开启互动，请进入正式教学。'; return }
    const word = options.wakeWord().trim()
    if (word.length < 2 || word.length > 20) { fail('请设置 2 至 20 字的唤醒词。'); return }
    enabled.value = true; owner = options.identity(); endedCount = 0
    phase.value = 'starting'; feedback.value = '正在检查本地识别能力…'
    if (options.speaking()) { phase.value = 'suspended'; feedback.value = '数字人讲话中，暂不监听。'; return }
    await attach(generation)
  }
  function submitManual(text: string) {
    if (!options.allowed() || !text.trim()) return
    const result = classifyPublicSpeech(text)
    options.onRoute(result); feedback.value = result.message
  }
  watch(options.identity, () => stop('课堂来源已变化，互动已关闭。'), { flush: 'sync' })
  watch(options.allowed, allowed => { if (!allowed) stop('课堂暂停、退出或当前阶段不允许互动。') }, { flush: 'sync' })
  watch(options.wakeWord, () => stop('唤醒词已更改，请重新开启互动。'), { flush: 'sync' })
  watch(options.speaking, speaking => {
    if (!enabled.value) return
    if (speaking) resumeAfterOutput = !!options.continueAfterSpeech?.() && expiresAt > Date.now()
    generation++; clearTimeout(restart); clearWindow(); detach()
    if (speaking) { phase.value = 'suspended'; feedback.value = '数字人讲话中，暂不监听，避免回声误唤醒。' }
    else {
      const id = generation
      restart = setTimeout(() => { if (current(id)) void attach(id) }, 700)
    }
  }, { flush: 'sync' })
  watch(() => options.continueAfterSpeech?.() ?? false, value => { if (!value) resumeAfterOutput = false }, { flush: 'sync' })
  const hidden = () => { if (document.hidden) stop('页面已隐藏，互动已关闭。') }
  document.addEventListener('visibilitychange', hidden)
  onScopeDispose(() => { stop(); document.removeEventListener('visibilitychange', hidden) })
  return { enabled, phase, feedback, error, start, stop, submitManual }
}
