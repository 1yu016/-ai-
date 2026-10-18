import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { disposeAvatarObject } from '@/avatar/AvatarLoader'

describe('avatar resource disposal', () => {
  it('releases geometry, every texture slot and material', () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map, normalMap })
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const mapDispose = vi.spyOn(map, 'dispose')
    const normalDispose = vi.spyOn(normalMap, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    root.add(new THREE.Mesh(geometry, material))

    disposeAvatarObject(root)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(mapDispose).toHaveBeenCalledTimes(1)
    expect(normalDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })
})

