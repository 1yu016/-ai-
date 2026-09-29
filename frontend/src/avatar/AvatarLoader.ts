import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AvatarModelFormat } from './types'

// 统一模型接口：无论 VRM / GLB / 程序化占位，渲染层只依赖这四个能力，
// 避免 ThreeAvatarStage 中出现大量 if (vrm) / if (glb) 分支。
export interface AvatarLoadedModel {
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  format: AvatarModelFormat
  /** 每帧更新：GLB 无操作；VRM 预留驱动 springBone/lookAt/表情。 */
  update: (deltaSeconds: number, timeSeconds: number) => void
  /** 释放模型自身持有资源（几何/材质/贴图）。 */
  dispose: () => void
}

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf), undefined, reject)
  })
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose?.()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) {
        material.map?.dispose?.()
        material.dispose?.()
      }
    }
  })
}

function formatFromUrl(url: string): AvatarModelFormat {
  const lower = url.toLowerCase()
  if (lower.endsWith('.vrm')) return 'vrm'
  if (lower.endsWith('.gltf')) return 'gltf'
  return 'glb'
}

/**
 * 加载数字人模型。
 * - glb / gltf：使用 Three.js GLTFLoader（现有渲染链路，不经网络代理验证即可直连）。
 * - vrm：预留。Phase 后续接入 @pixiv/three-vrm 的 VRMLoaderPlugin，当前不支持则抛出错误，
 *   由调用方按「VRM → GLB → 2D」三级降级继续运行，课堂不受影响。
 */
export async function loadAvatarModel(
  url: string,
  format?: AvatarModelFormat | null,
): Promise<AvatarLoadedModel> {
  const resolvedFormat: AvatarModelFormat = format ?? formatFromUrl(url)

  if (resolvedFormat === 'vrm') {
    throw new Error('VRM 模型尚未接入（预留格式），请使用 GLB/GLTF 模型。')
  }

  const gltf = await loadGltf(url)
  return {
    root: gltf.scene,
    animations: gltf.animations ?? [],
    format: resolvedFormat === 'gltf' ? 'gltf' : 'glb',
    update: () => undefined,
    dispose: () => disposeObject(gltf.scene),
  }
}