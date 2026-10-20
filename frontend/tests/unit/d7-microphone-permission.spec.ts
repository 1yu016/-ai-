import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useClassroomListening } from '@/composables/useClassroomListening'
import type { LocalRecognition } from '@/services/classroomListening'

afterEach(() => vi.unstubAllGlobals())
it.each(['denied-before-start', 'revoked-during-listening'])('%s never leaves capture active or restarts automatically', async mode => {
  const permission = new EventTarget() as PermissionStatus
  Object.defineProperty(permission, 'state', { configurable: true, value: mode === 'denied-before-start' ? 'denied' : 'granted' })
  const abort = vi.fn(), start = vi.fn()
  let instance!: LocalRecognition
  const create = vi.fn(async () => { instance = { processLocally: true, lang: 'zh-CN', continuous: true, interimResults: false, onresult: null, onerror: null, onend: null, start, abort }; start.mockImplementation(() => instance.onstart?.()); return instance })
  vi.stubGlobal('navigator', { permissions: { query: vi.fn(async () => permission) } })
  const scope = effectScope()
  const session = scope.run(() => useClassroomListening({ identity: () => 'run1', allowed: () => true, speaking: () => false, wakeWord: () => '小星小星', onRoute() {}, onListening() {}, createRecognition: create }))!
  try {
    await session.start()
    if (mode === 'denied-before-start') { expect(create).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled() }
    else {
      expect(start).toHaveBeenCalledOnce()
      Object.defineProperty(permission, 'state', { configurable: true, value: 'denied' }); permission.dispatchEvent(new Event('change'))
      expect(abort).toHaveBeenCalledOnce()
      expect(instance.onresult).toBeNull()
    }
    expect(session.enabled.value).toBe(false); expect(session.phase.value).toBe('error')
    expect(session.error.value).toContain('权限')
  } finally { scope.stop() }
})
