import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDigitalHumanStore, type DigitalHumanAction } from '@/stores/digitalHuman'

describe('digital human store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('has sane defaults with 2D fallback enabled', () => {
    const store = useDigitalHumanStore()
    expect(store.action).toBe('idle')
    expect(store.visible).toBe(true)
    expect(store.compact).toBe(false)
    expect(store.fallback).toBe(true)
    expect(store.modelState).toBe('idle')
    expect(store.webglSupported).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('only drives actions from the whitelist, ignoring unknown actions', () => {
    const store = useDigitalHumanStore()
    store.setAction('listen')
    expect(store.action).toBe('listen')
    // 传入非法动作（运行时而非类型层面）应被忽略，保持原动作
    store.setAction('runScript' as DigitalHumanAction)
    expect(store.action).toBe('listen')
  })

  it('isSpeaking reflects the talk action', () => {
    const store = useDigitalHumanStore()
    expect(store.isSpeaking).toBe(false)
    store.setAction('talk')
    expect(store.isSpeaking).toBe(true)
  })

  it('model state transitions keep fallback/loading consistent', () => {
    const store = useDigitalHumanStore()
    store.setModelState('loading')
    expect(store.loading).toBe(true)
    expect(store.fallback).toBe(false)
    expect(store.error).toBe('')

    store.setModelState('loaded')
    expect(store.loading).toBe(false)
    expect(store.fallback).toBe(false)

    store.setModelState('error')
    expect(store.loading).toBe(false)
    expect(store.fallback).toBe(true)
  })

  it('tracks WebGL capability separately from model loading', () => {
    const store = useDigitalHumanStore()
    store.setWebglSupported(true)
    expect(store.webglSupported).toBe(true)
    expect(store.modelState).toBe('idle')
  })

  it('switches only between configured local roles and resets model loading state', () => {
    const store = useDigitalHumanStore()
    store.setModelState('error')
    store.selectRole('bear')
    expect(store.roleId).toBe('bear')
    expect(store.roleName).toBe('小熊老师')
    expect(store.modelState).toBe('idle')
    store.selectRole('unknown-role')
    expect(store.roleId).toBe('bear')
  })

  it('setFallback clears loading and stops at idle', () => {
    const store = useDigitalHumanStore()
    store.setModelState('loading')
    store.setFallback('加载失败')
    expect(store.fallback).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.error).toBe('加载失败')
    expect(store.action).toBe('idle')
  })

  it('reset restores defaults without clearing capability flags', () => {
    const store = useDigitalHumanStore()
    store.setWebglSupported(true)
    store.setAction('happy')
    store.setCompact(true)
    store.setModelState('error')
    store.reset()
    expect(store.action).toBe('idle')
    expect(store.compact).toBe(false)
    expect(store.visible).toBe(true)
    expect(store.modelState).toBe('idle')
    expect(store.webglSupported).toBe(true)
  })
})
