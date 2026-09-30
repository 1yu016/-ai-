import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AvatarModelFormat } from './types'
import { AvatarActionResolver, type AvatarActionName } from './action/AvatarActionResolver'
import { ExpressionController, type AvatarExpressionName } from './expression/ExpressionController'
import { BlinkController } from './expression/BlinkController'

// 统一模型接口：无论 VRM / GLB / 程序化占位，渲染层只依赖这些能力，
// 避免 ThreeAvatarStage 中出现大量 if (vrm) / if (glb) 分支、
// 以及根据状态做业务判断（playAnimation / setExpression 只接收名字）。
export interface AvatarLoadedModel {
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  format: AvatarModelFormat
  /** AnimationMixer 实例：统一混音器管理（GLB 动画播放）。 */
  mixer: THREE.AnimationMixer
  /** 每帧更新：GLB 驱动 mixer + 自动眨眼；VRM 预留 springBone/lookAt。 */
  update: (deltaSeconds: number, timeSeconds: number) => void
  /** 播放动作：解析动作名 → clip → 播放；返回是否播放成功。 */
  playAnimation: (actionName: AvatarActionName) => boolean
  /** 施加表情：VRM 对应 ExpressionManager；GLB 对应 morph target；返回是否应用。 */
  setExpression: (name: AvatarExpressionName, value: number) => boolean
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
  const blink = new BlinkController(0)

  // 收集带 morph target 的网格（GLB 表情通道）
  const morphMeshes: THREE.Mesh[] = []
  gltf.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.morphTargetDictionary && Object.keys(obj.morphTargetDictionary).length) {
      morphMeshes.push(obj)
    }
  })

  let currentExpression: AvatarExpressionName | null = null

  // 对命中关键词的所有 morph target 设置权重（value <= 0 时归零即清除）。
  function applyMorph(keyword: string, value: number): boolean {
    let applied = false
    const needle = keyword.toLowerCase()
    for (const mesh of morphMeshes) {
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
        if (!name.toLowerCase().includes(needle)) continue
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value
        applied = true
      }
    }
    return applied
  }

  function applyBlink(eyeOpen: number): void {
    for (const keyword of ExpressionController.targets('blink')) {
      applyMorph(keyword, Math.max(0, 1 - eyeOpen))
    }
  }

  return {
    root: gltf.scene,
    animations,
    format,
    mixer,
    update(deltaSeconds: number, timeSeconds: number) {
      mixer.update(deltaSeconds)
      applyBlink(blink.eyeOpen(timeSeconds * 1000))
    },
    playAnimation(actionName: AvatarActionName): boolean {
      const clip = resolver.resolve(actionName)
      if (!clip) return false
      mixer.stopAllAction()
      mixer.clipAction(clip, gltf.scene).play()
      return true
    },
    setExpression(name: AvatarExpressionName, value: number): boolean {
      // 先清除上一个表情的 morph 权重，避免叠加。
      if (currentExpression && currentExpression !== name) {
        for (const keyword of ExpressionController.targets(currentExpression)) applyMorph(keyword, 0)
      }
      currentExpression = name
      let applied = false
      for (const keyword of ExpressionController.targets(name)) {
        if (applyMorph(keyword, value)) applied = true
      }
      return applied
    },
    dispose() {
      mixer.stopAllAction()
      disposeObject(gltf.scene)
    },
  }
}

/**
 * 加载数字人模型。
 * - glb / gltf：GLTFLoader，内建 AnimationMixer、动作解析、表情(morph target)与自动眨眼。
 * - vrm：预留。Phase 后续接入 @pixiv/three-vrm（ExpressionManager/springBone），
 *   当前不支持则抛出错误，由调用方按「VRM → GLB → 2D」三级降级继续运行。
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
  void ExpressionController
  throw new Error('VRM 模型尚未接入（预留格式），请使用 GLB/GLTF 模型。')
}