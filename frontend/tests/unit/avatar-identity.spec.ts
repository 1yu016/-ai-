import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/avatar'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

const response = (id: number): api.ResolveAvatarResponse => ({ character: { id, name: `班级角色${id}`, category: 'teacher_assistant' },
  version: { id, version: 1, engineVersion: 'avatar-engine-1', modelFormat: 'glb' }, renderAsset: { id, assetType: 'model', contentUrl: `/avatars/assets/${id}/content`, mimeType: 'model/gltf-binary' },
  sourceScope: 'class', action: { requested: 'idle', effective: null, contentUrl: null }, voice: null, personality: null, fallbackLevel: null, reason: null })
describe('server-owned classroom avatar identity', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks() })
  it('deduplicates multiple surfaces and prevents local role selection from changing class identity', async () => {
    const resolve = vi.spyOn(api, 'resolveAvatar').mockResolvedValue(response(11))
    const store = useDigitalHumanStore(), context = { classId: 1, classroomRunId: 8, deviceId: 4 }
    await Promise.all([store.loadRuntime(context), store.loadRuntime(context)])
    store.selectRole('bear')
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(store.roleId).toBe('11')
    expect(store.roleName).toBe('班级角色11')
  })
  it('late old-class resolution cannot replace the new class model or resurrect after reset', async () => {
    let finish!: (value: api.ResolveAvatarResponse) => void
    vi.spyOn(api, 'resolveAvatar').mockImplementationOnce(() => new Promise(r => { finish = r })).mockResolvedValueOnce(response(22))
    const store = useDigitalHumanStore()
    const old = store.loadRuntime({ classId: 1, classroomRunId: 8 })
    await store.loadRuntime({ classId: 2, classroomRunId: 9 })
    finish(response(11)); await old
    expect(store.runtime?.character?.id).toBe(22)
    expect(store.identityKey).toContain('22')
    store.reset(); expect(store.runtime).toBeNull()
    expect(store.classroomContext).toBeNull()
  })
  it('resolve failure clears previous identity and provides safe nonblocking fallback', async () => {
    vi.spyOn(api, 'resolveAvatar').mockResolvedValueOnce(response(11)).mockRejectedValueOnce(Error('offline'))
    const store = useDigitalHumanStore()
    await store.loadRuntime({ classId: 1 }); await store.loadRuntime({ classId: 2 })
    expect(store.runtime).toBeNull()
    expect(store.roleId).toBe('flower')
    expect(store.fallback).toBe(true)
    expect(store.error).toContain('课堂可以继续')
  })
})
