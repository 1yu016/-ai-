import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { AvatarModelFormat } from './types'
import { AvatarActionResolver, type AvatarActionName } from './action/AvatarActionResolver'
import { ExpressionController, type AvatarExpressionName } from './expression/ExpressionController'
import { BlinkController } from './expression/BlinkController'
import { VrmVisualController } from './animation/VrmVisualController'

// 统一模型接口：无论 VRM / GLB / 程序化占位，渲染层只依赖这些能力。
// playAnimation / setExpression 只接收名字，不处理鉴权与解析细节。
export interface AvatarLoadedModel {
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  format: AvatarModelFormat
  mixer: THREE.AnimationMixer
  update: (deltaSeconds: number, timeSeconds: number) => void
  playAnimation: (actionName: AvatarActionName) => boolean
  setExpression: (name: AvatarExpressionName, value: number) => boolean
  resetExpressions: () => void
  dispose: () => void
}

// 加载上下文：由调用方（组件）注入 token 提供者，AvatarLoader 内部完成 Authorization 组装。
// 禁止在组件/URL 中直接处理凭证。
export interface AvatarLoadContext {
  getToken?: () => string | null
  signal?: AbortSignal
}

export function disposeAvatarObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()
  const disposeTexture = (value: unknown) => {
    if (!(value instanceof THREE.Texture) || disposedTextures.has(value)) return
    disposedTextures.add(value)
    value.dispose()
  }
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry && !geometries.has(obj.geometry)) { geometries.add(obj.geometry); obj.geometry.dispose() }
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) {
        if (disposedMaterials.has(material)) continue
        disposedMaterials.add(material)
        for (const value of Object.values(material)) disposeTexture(value)
        const uniforms = (material as THREE.ShaderMaterial).uniforms
        if (uniforms) {
          for (const uniform of Object.values(uniforms)) disposeTexture(uniform?.value)
        }
        material.dispose?.()
      }
      disposeTexture((obj as THREE.SkinnedMesh).skeleton?.boneTexture)
    }
  })
}

function formatFromUrl(url: string): AvatarModelFormat {
  const lower = url.toLowerCase()
  if (lower.endsWith('.vrm')) return 'vrm'
  if (lower.endsWith('.gltf')) return 'gltf'
  return 'glb'
}

/** 受保护资产下载：带 Authorization 的 fetch → ArrayBuffer（token 不进入 URL）。 */
async function fetchAsset(url: string, context?: AvatarLoadContext): Promise<ArrayBuffer> {
  const token = context?.getToken?.()?.trim() || null
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: context?.signal,
  })
  if (!response.ok) throw new Error(`模型资源下载失败：HTTP ${response.status}`)
  return response.arrayBuffer()
}

function parseGltf(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer as ArrayBuffer, '', resolve, reject)
  })
}

function buildGltfModel(gltf: GLTF, format: AvatarModelFormat): AvatarLoadedModel {
  const animations = gltf.animations ?? []
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const resolver = new AvatarActionResolver(animations, { fallbackToFirst: false })
  const blink = new BlinkController(0)

  const morphMeshes: THREE.Mesh[] = []
  gltf.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.morphTargetDictionary && Object.keys(obj.morphTargetDictionary).length) {
      morphMeshes.push(obj)
    }
  })

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

  let currentExpression: AvatarExpressionName | null = null
  let activeAction: THREE.AnimationAction | null = null
  let speaking = false
  let visualTime = 0

  return {
    root: gltf.scene,
    animations,
    format,
    mixer,
    update(deltaSeconds: number, timeSeconds: number) {
      mixer.update(deltaSeconds)
      visualTime += deltaSeconds
      for (const keyword of ExpressionController.targets('talk')) applyMorph(keyword, speaking ? 0.15 + 0.5 * Math.pow(Math.sin(visualTime * 11), 2) : 0)
      for (const keyword of ExpressionController.targets('blink')) {
        applyMorph(keyword, Math.max(0, 1 - blink.eyeOpen(timeSeconds * 1000)))
      }
    },
    playAnimation(actionName: AvatarActionName): boolean {
      speaking = actionName === 'talk'
      const clip = resolver.resolve(actionName) ?? resolver.resolve('idle')
      if (!clip) return false
      const next = mixer.clipAction(clip, gltf.scene)
      if (next !== activeAction) {
        next.reset().setLoop(['wave', 'happy', 'encourage', 'goodbye'].includes(actionName) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
        next.clampWhenFinished = true
        next.fadeIn(0.2).play()
        activeAction?.fadeOut(0.2)
        activeAction = next
      }
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
    resetExpressions() {
      speaking = false
      for (const keyword of ExpressionController.targets('talk')) applyMorph(keyword, 0)
      if (currentExpression) {
        for (const keyword of ExpressionController.targets(currentExpression)) applyMorph(keyword, 0)
        currentExpression = null
      }
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(gltf.scene)
      disposeAvatarObject(gltf.scene)
    },
  }
}

// VRM ExpressionManager 预设名（VRM 0.x / 1.0 均通过 ExpressionManager.setValue）
// thinking 无标准预设 → null（安全 no-op）。
const VRM_PRESET: Record<AvatarExpressionName, string | null> = {
  neutral: null,
  happy: 'happy',
  question: 'surprised',
  encourage: 'happy',
  goodbye: 'sad',
  talk: 'aa',
  thinking: null,
  blink: 'blink',
}

function buildVrmModel(vrm: VRM): AvatarLoadedModel {
  const root = vrm.scene
  const animations: THREE.AnimationClip[] = []
  const mixer = new THREE.AnimationMixer(root)
  const visual = new VrmVisualController(vrm)
  let currentExpression: AvatarExpressionName | null = null

  return {
    root,
    animations,
    format: 'vrm',
    mixer,
    // VRM：驱动骨架/springBone/lookAt 等（three-vrm 官方 update）
    update(deltaSeconds: number) {
      visual.update(deltaSeconds)
      vrm.update(deltaSeconds)
    },
    playAnimation(actionName: AvatarActionName): boolean {
      return visual.play(actionName)
    },
    setExpression(name: AvatarExpressionName, value: number): boolean {
      const manager = vrm.expressionManager
      const preset = VRM_PRESET[name]
      if (!manager || !preset) return false
      // 存在性校验：模型不提供该预设时安全返回 false（如 VRM 0.51 无 surprised）。
      // expressions 为对象数组（数字索引），按 expressionName 匹配。
      const exists = Array.isArray(manager.expressions)
        ? (manager.expressions as unknown as Array<{ expressionName?: string }>).some((e) => e.expressionName === preset)
        : preset in manager.expressions
      if (!exists) return false
      // 先清除上一个表情预设，避免叠加
      if (currentExpression && currentExpression !== name) {
        const previous = VRM_PRESET[currentExpression]
        if (previous) manager.setValue(previous, 0)
      }
      currentExpression = name
      manager.setValue(preset, value)
      return true
    },
    resetExpressions() {
      visual.reset()
      const manager = vrm.expressionManager
      if (manager && currentExpression) {
        const previous = VRM_PRESET[currentExpression]
        if (previous) manager.setValue(previous, 0)
        currentExpression = null
      }
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      ;(vrm as { dispose?: () => void }).dispose?.()
      disposeAvatarObject(root)
    },
  }
}

/**
 * 加载数字人模型（统一入口）。
 * - glb / gltf：three GLTFLoader，内建 AnimationMixer/动作解析/表情(morph)/自动眨眼。
 * - vrm：@pixiv/three-vrm（VRMLoaderPlugin，同时支持 VRM 0.x 与 1.0）。
 * 模型资源若需鉴权，由 getToken 提供 Axios-同源 token，Authorization 在内部组装。
 */
export async function loadAvatarModel(
  url: string,
  format?: AvatarModelFormat | null,
  context?: AvatarLoadContext,
): Promise<AvatarLoadedModel> {
  const resolvedFormat: AvatarModelFormat = format ?? formatFromUrl(url)
  const buffer = await fetchAsset(url, context)

  if (resolvedFormat === 'vrm') {
    return VRMBufferLoader(buffer)
  }

  const gltf = await parseGltf(buffer)
  return buildGltfModel(gltf, resolvedFormat === 'gltf' ? 'gltf' : 'glb')
}

/** GLB/GLTF 加载器（受保护下载 + parse）。 */
export async function GLBLoader(url: string, context?: AvatarLoadContext): Promise<AvatarLoadedModel> {
  const gltf = await parseGltf(await fetchAsset(url, context))
  return buildGltfModel(gltf, 'glb')
}

/** GLB/GLTF Buffer 解析加载器（测试/离线场景直接输入 ArrayBuffer）。 */
export async function GLBBufferLoader(
  buffer: ArrayBuffer,
  format: 'glb' | 'gltf' = 'glb',
): Promise<AvatarLoadedModel> {
  const gltf = await parseGltf(buffer)
  return buildGltfModel(gltf, format)
}

/** VRM 加载器：从 ArrayBuffer 解析 VRM（支持 VRM 0.x / 1.0）。 */
export async function VRMBufferLoader(buffer: ArrayBuffer): Promise<AvatarLoadedModel> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer as ArrayBuffer, '', resolve, reject)
  })
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('模型不包含合法的 VRM 数据')
  // Normalize the legacy VRM 0.x forward axis; providers share the same camera convention.
  VRMUtils.rotateVRM0(vrm)
  return buildVrmModel(vrm)
}

/** VRM 加载器（受保护下载 + VRM 解析）。 */
export async function VRMLoader(url: string, context?: AvatarLoadContext): Promise<AvatarLoadedModel> {
  return VRMBufferLoader(await fetchAsset(url, context))
}
