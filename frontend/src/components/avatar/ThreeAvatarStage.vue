<script setup lang="ts">
/**
 * 3D 数字人渲染组件（步骤2）。
 * - 创建/销毁 WebGL 场景、相机、灯光。
 * - 优先加载 public/avatar 下的 GLB 模型；模型缺失或解析失败时回退为程序化占位角色，
 *   二者共用同一套动作状态机，保证「链路先行」。
 * - 通过 digitalHuman store 的动作白名单驱动动画（不执行任意脚本）。
 * - WebGL 不可用由父级容器拦截，本组件仅在 webglSupported 为真时挂载。
 * - 卸载时释放 renderer、几何、材质、贴图、动画、事件监听与渲染循环。
 * - 带重复加载保护和帧率看门狗（持续低帧率触发 2D 降级）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { storeToRefs } from 'pinia'
import { useDigitalHumanStore, type DigitalHumanAction } from '@/stores/digitalHuman'
import { loadAvatarModel, type AvatarLoadedModel } from '@/avatar/AvatarLoader'
import type { AvatarModelFormat } from '@/avatar/types'
import { ExpressionController } from '@/avatar/expression/ExpressionController'

const store = useDigitalHumanStore()
const { action, compact, roleId } = storeToRefs(store)
const mountEl = ref<HTMLElement | null>(null)

// 模型部署路径：文件存在时走真实 GLTF 加载，否则用程序化占位角色
const DEFAULT_MODEL_URL = '/avatar/RobotExpressive.glb'
const FPS_LOW_THRESHOLD = 12
const FPS_WINDOW_MS = 1500
const FPS_MAX_BAD_FRAMES = 3

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let root: THREE.Object3D | null = null
let currentModel: AvatarLoadedModel | null = null
let resizeObserver: ResizeObserver | null = null
let disposed = false
let lastTime = 0
let fpsWindowStart = 0
let fpsFrames = 0
let fpsBadCount = 0
let currentAction: DigitalHumanAction = 'idle'

// 程序化占位角色的可动部件引用
const parts = { head: null as THREE.Object3D | null, mouth: null as THREE.Object3D | null, armR: null as THREE.Object3D | null, armL: null as THREE.Object3D | null }

function fail(message: string, disposeAfter = true) {
  if (disposed) return
  store.setModelState('error')
  if (message) store.error = message
  if (disposeAfter) disposeAll()
}

function buildProcedural(): THREE.Group {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33b5a8, roughness: 0.55 })
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf2a65e, roughness: 0.5 })
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xfff2df })
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x3d2c2c })
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x9b4f3f })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.82, 0.5), bodyMat)
  body.position.y = 0.16

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), faceMat)
  head.position.y = 1.06

  const eyeGeo = new THREE.SphereGeometry(0.05, 12, 10)
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.14, 1.17, 0.37)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.14, 1.17, 0.37)

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), mouthMat)
  mouth.position.set(0, 0.85, 0.4)
  head.add(eyeL, eyeR, mouth)

  const armGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16)
  const armL = new THREE.Mesh(armGeo, accentMat); armL.position.set(-0.52, 0.46, 0)
  const armR = new THREE.Mesh(armGeo, accentMat); armR.position.set(0.52, 0.46, 0)

  group.add(body, head, armL, armR)
  parts.head = head
  parts.mouth = mouth
  parts.armL = armL
  parts.armR = armR
  return group
}

function playAction(actionName: DigitalHumanAction) {
  currentAction = actionName
  // 真实模型：动作名 → AvatarLoader 内 AvatarActionResolver → clip 播放；
  // 表情名 → ExpressionController → model.setExpression（VRM ExpressionManager / GLB morph target）。
  // 程序化占位：无 clip/morph，由 applyPose 按 currentAction 施加姿势。
  currentModel?.playAnimation(actionName)
  currentModel?.setExpression(ExpressionController.fromAction(actionName), 1)
}

watch(action, (next) => playAction(next))

// 程序化占位角色：按动作施加简单姿态
function applyPose(time: number) {
  if (!root) return
  const t = time / 1000
  const bob = Math.sin(t * 2) * 0.03
  root.position.y = 0
  if (currentAction === 'talk') root.position.y = bob + Math.abs(Math.sin(t * 6)) * 0.04
  else if (currentAction === 'happy' || currentAction === 'praise') root.position.y = Math.abs(Math.sin(t * 5)) * 0.06
  else root.position.y = bob

  if (parts.head) {
    parts.head.rotation.set(0, 0, 0)
    if (currentAction === 'listen') parts.head.rotation.x = 0.22
    else if (currentAction === 'thinking') parts.head.rotation.z = Math.sin(t * 2) * 0.16
    else if (currentAction === 'question') parts.head.rotation.z = Math.sin(t * 2) * 0.2 + 0.1
  }
  if (parts.mouth) {
    const open = currentAction === 'talk' ? 0.6 + Math.abs(Math.sin(t * 9)) * 0.5 : 0.25
    parts.mouth.scale.y = open
  }
  if (parts.armR) {
    if (currentAction === 'wave' || currentAction === 'goodbye') parts.armR.rotation.z = Math.sin(t * 7) * 0.9 - 0.2
    else if (currentAction === 'happy' || currentAction === 'praise') parts.armR.rotation.z = Math.sin(t * 5) * 0.5 - 0.4
    else parts.armR.rotation.z = 0
  }
  if (parts.armL) {
    parts.armL.rotation.z = currentAction === 'happy' || currentAction === 'praise' ? -Math.sin(t * 5) * 0.5 + 0.4 : 0
  }
}

function loop(time: number) {
  if (disposed) return
  // 帧率看门狗
  fpsFrames += 1
  if (fpsWindowStart === 0 || time - fpsWindowStart >= FPS_WINDOW_MS) {
    const elapsed = (time - fpsWindowStart) / 1000
    const fps = elapsed > 0 ? fpsFrames / elapsed : 60
    if (fps < FPS_LOW_THRESHOLD) {
      fpsBadCount += 1
      if (fpsBadCount >= FPS_MAX_BAD_FRAMES) { fail('设备性能不足，已切换 2D 形象'); return }
    } else fpsBadCount = 0
    fpsWindowStart = time
    fpsFrames = 0
  }
  const dt = lastTime ? (time - lastTime) / 1000 : 0.016
  currentModel?.update(dt, time / 1000)
  applyPose(time)
  if (renderer && scene && camera) renderer.render(scene, camera)
  lastTime = time
}

function bindModel(model: AvatarLoadedModel) {
  currentModel = model
  root = model.root
  scene?.add(root)
}

function startRenderLoop() {
  if (!renderer || !camera || !mountEl.value) return
  renderer.setAnimationLoop(loop)
  lastTime = 0
  fpsWindowStart = 0
  fpsFrames = 0
  fpsBadCount = 0
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !mountEl.value) return
    const w = mountEl.value.clientWidth || 180
    const h = mountEl.value.clientHeight || 200
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(mountEl.value)
}

async function init() {
  if (disposed) return
  store.setModelState('loading')
  if (!mountEl.value) return
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch {
    fail('WebGL 渲染器创建失败'); return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(mountEl.value.clientWidth || 180, mountEl.value.clientHeight || 200)
  mountEl.value.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, renderer.domElement.width / renderer.domElement.height, 0.1, 100)
  camera.position.set(0, 0.95, 2.6)
  camera.lookAt(0, 0.95, 0)

  const ambient = new THREE.AmbientLight(0xffffff, 0.8)
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(1.5, 2.5, 2)
  scene.add(ambient, key)

  // 三级降级：课堂运行时模型（resolve contentUrl）→ 内置默认 GLB → 程序化占位/2D。
  // 模型始终不阻塞课堂：任意一级失败都继续尝试下一级。
  const runtimeModelUrl = store.runtime?.model?.modelUrl ?? null
  const runtimeFormat = store.runtime?.model?.modelFormat ?? null
  const candidates: Array<[string, AvatarModelFormat | null]> = runtimeModelUrl
    ? [[runtimeModelUrl, runtimeFormat], [DEFAULT_MODEL_URL, 'glb']]
    : [[DEFAULT_MODEL_URL, 'glb']]

  for (const [url, format] of candidates) {
    if (disposed) return
    try {
      const model = await loadAvatarModel(url, format)
      if (disposed) return
      bindModel(model)
      store.setModelState('loaded')
      playAction(store.action)
      startRenderLoop()
      return
    } catch {
      // 本级别模型加载失败，尝试下一候选。
    }
  }
  if (disposed) return
  root = buildProcedural()
  scene.add(root)
  store.setModelState('loaded')
  playAction(store.action)
  startRenderLoop()
}

function disposeScene() {
  if (scene) scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose?.()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) { m.map?.dispose?.(); m.dispose?.() }
    }
  })
  scene = null
}

function disposeAll() {
  if (disposed) return
  disposed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  if (renderer) {
    renderer.setAnimationLoop(null)
    renderer.dispose()
    try { renderer.forceContextLoss?.() } catch { /* 忽略 */ }
  }
  disposeScene()
  currentModel?.dispose()
  currentModel = null
  root = null
  renderer = null
  camera = null
  if (mountEl.value) mountEl.value.replaceChildren()
}

watch(roleId, () => {
  disposeAll()
  disposed = false
  void init()
})

onMounted(() => { void init() })
onBeforeUnmount(() => disposeAll())
</script>

<template>
  <div ref="mountEl" class="three-avatar-stage" :class="{ compact }" aria-label="3D 数字人模型"></div>
</template>

<style scoped>
.three-avatar-stage { width: 100%; height: 100%; min-width: 160px; min-height: 180px; pointer-events: auto; transition: transform .25s ease, opacity .25s ease }
.three-avatar-stage :deep(canvas) { display: block; width: 100%; height: 100% }
.three-avatar-stage.compact { transform: scale(.7); transform-origin: bottom right }
</style>
