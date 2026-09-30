import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AvatarModelFormat } from './types'
import { AvatarActionResolver, type AvatarActionName } from './action/AvatarActionResolver'

// 统一模型接口：无论 VRM / GLB / 程序化占位，渲染层只依赖这些能力，
// 避免 ThreeAvatarStage 中出现大量 if (vrm) / if (glb) 分支、
// 以及根据状态做业务判断（playAnimation 只接收动作名，内部完成 clip 解析）。
export interface AvatarLoadedModel {
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  format: AvatarModelFormat
  /** AnimationMixer 实例：统一混音器管理（GLB 动画播放）。 */
  mixer: THREE.AnimationMixer
  /** 每帧更新：GLB 驱动 mixer；VRM 预留驱动 springBone/lookAt/表情。 */
  update: (deltaSeconds: number, timeSeconds: number) => void
  /** 播放动作：解析动作名 → clip → 播放；返回是否播放成功（无 clip 时为 false）。 */
  playAnimation: (actionName: AvatarActionName) => boolean
  /** 释放模型自身持有资源（几何/材质/贴图/混音器）。 */
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

function buildGltfModel(gltf: GLTF, format: AvatarModelFormat): AvatarLoadedModel {
  const animations = gltf.animations ?? []
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const resolver = new AvatarActionResolver(animations)
  return {
    root: gltf.scene,
    animations,
    format,
    mixer,
    update(deltaSeconds: number) {
      mixer.update(deltaSeconds)
    },
    playAnimation(actionName: AvatarActionName): boolean {
      const clip = resolver.resolve(actionName)
      if (!clip) return false
      mixer.stopAllAction()
      mixer.clipAction(clip, gltf.scene).play()
      return true
    },
    dispose() {
      mixer.stopAllAction()
      disposeObject(gltf.scene)
    },
  }
}

/**
 * 加载数字人模型。
 * - glb / gltf：使用 Three.js GLTFLoader，内建 AnimationMixer 与动作解析。
 * - vrm：预留。Phase 后续接入 @pixiv/three-vrm 的 VRMLoaderPlugin，当前不支持则抛出错误，
 *   由调用方按「VRM → GLB → 2D」三级降级继续运行，课堂不受影响。
 */
export async function loadAvatarModel(
  url: string,
  format?: AvatarModelFormat | null,
): Promise<AvatarLoadedModel> {
  const resolvedFormat: AvatarModelFormat = format ?? formatFromUrl(url)

  if (resolvedFormat === 'vrm') {
    return VRMLoader(url)
  }

  const gltf = await loadGltf(url)
  return buildGltfModel(gltf, resolvedFormat === 'gltf' ? 'gltf' : 'glb')
}

/** GLB/GLTF 加载器（Three.js GLTFLoader）。 */
export function GLBLoader(url: string): Promise<AvatarLoadedModel> {
  return loadGltf(url).then((gltf) => buildGltfModel(gltf, 'glb'))
}

/** VRM 加载器占位：预留接入 @pixiv/three-vrm，当前统一走降级。 */
export async function VRMLoader(_url: string): Promise<AvatarLoadedModel> {
  void _url
  void buildGltfModel
  throw new Error('VRM 模型尚未接入（预留格式），请使用 GLB/GLTF 模型。')
}