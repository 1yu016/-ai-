import { afterEach, beforeEach, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

enableAutoUnmount(afterEach)

beforeEach(() => {
  // Node 环境（如真实模型解析测试）无 DOM 全局，跳过浏览器相关 stub。
  if (typeof localStorage !== 'undefined') localStorage.clear()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  if (typeof document === 'undefined') return
  if (typeof window !== 'undefined') vi.stubGlobal('scrollTo', vi.fn())
  if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = vi.fn()
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
