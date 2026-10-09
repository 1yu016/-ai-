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
import { loadAvatarModel, type AvatarLoadedModel, type AvatarLoadContext } from '@/avatar/AvatarLoader'
import type { AvatarModelFormat } from '@/avatar/types'
import { useUserStore } from '@/stores/user'

const store = useDigitalHumanStore()
const { action, expression, compact, roleId } = storeToRefs(store)
const mountEl = ref<HTMLElement | null>(null)
// opening：开场舞台使用更远的相机机位，确保看到完整身体；不影响普通课堂参数。
// far：数字人大屏模式，同样使用宽松取景（配合 fit 取景），但保留普通 UI（字幕/角色控制由上层控制）。
const props = defineProps<{ opening?: boolean; far?: boolean }>()
const isOpening = typeof props.opening === 'boolean' ? props.opening : false
const isFar = typeof props.far === 'boolean' ? props.far : false

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
let loadGeneration = 0

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

function buildProceduralBear(): THREE.Group {
  const group = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color: 0xb97842, roughness: 0.82 })
  const lightFur = new THREE.MeshStandardMaterial({ color: 0xf4c995, roughness: 0.78 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x3d2922, roughness: 0.72 })
  const sweater = new THREE.MeshStandardMaterial({ color: 0x79b9aa, roughness: 0.7 })
  const scarf = new THREE.MeshStandardMaterial({ color: 0xf18f6b, roughness: 0.62 })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 32, 24), sweater)
  body.scale.set(0.92, 1.08, 0.72)
  body.position.y = 0.22

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), lightFur)
  belly.scale.set(0.9, 1.05, 0.34)
  belly.position.set(0, 0.18, 0.39)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), fur)
  head.scale.set(1, 0.92, 0.92)
  head.position.y = 1.06

  const earGeometry = new THREE.SphereGeometry(0.18, 20, 16)
  const earL = new THREE.Mesh(earGeometry, fur)
  const earR = new THREE.Mesh(earGeometry, fur)
  earL.position.set(-0.36, 1.42, 0.02)
  earR.position.set(0.36, 1.42, 0.02)

  const innerEarGeometry = new THREE.SphereGeometry(0.1, 16, 12)
  const innerEarL = new THREE.Mesh(innerEarGeometry, lightFur)
  const innerEarR = new THREE.Mesh(innerEarGeometry, lightFur)
  innerEarL.position.set(-0.36, 1.43, 0.14)
  innerEarR.position.set(0.36, 1.43, 0.14)

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 18), lightFur)
  muzzle.scale.set(1, 0.72, 0.58)
  muzzle.position.set(0, 0.94, 0.42)

  const eyeGeometry = new THREE.SphereGeometry(0.055, 14, 10)
  const eyeL = new THREE.Mesh(eyeGeometry, dark)
  const eyeR = new THREE.Mesh(eyeGeometry, dark)
  eyeL.position.set(-0.17, 1.17, 0.43)
  eyeR.position.set(0.17, 1.17, 0.43)

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), dark)
  nose.scale.set(1.1, 0.75, 0.65)
  nose.position.set(0, 1.01, 0.62)

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), dark)
  mouth.scale.set(1, 0.35, 0.45)
  mouth.position.set(0, 0.88, 0.61)

  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.065, 12, 28), scarf)
  scarfRing.rotation.x = Math.PI / 2
  scarfRing.position.set(0, 0.66, 0.03)

  const armGeometry = new THREE.CapsuleGeometry(0.12, 0.43, 8, 16)
  const armL = new THREE.Mesh(armGeometry, fur)
  const armR = new THREE.Mesh(armGeometry, fur)
  armL.position.set(-0.57, 0.29, 0)
  armR.position.set(0.57, 0.29, 0)
  armL.rotation.z = -0.16
  armR.rotation.z = 0.16

  const legGeometry = new THREE.CapsuleGeometry(0.14, 0.28, 8, 16)
  const legL = new THREE.Mesh(legGeometry, fur)
  const legR = new THREE.Mesh(legGeometry, fur)
  legL.position.set(-0.23, -0.46, 0.02)
  legR.position.set(0.23, -0.46, 0.02)

  group.add(
    body,
    belly,
    head,
    earL,
    earR,
    innerEarL,
    innerEarR,
    muzzle,
    eyeL,
    eyeR,
    nose,
    mouth,
    scarfRing,
    armL,
    armR,
    legL,
    legR,
  )
  parts.head = head
  parts.mouth = mouth
  parts.armL = armL
  parts.armR = armR
  return group
}

function playAction(actionName: DigitalHumanAction) {
  currentAction = actionName
  // 真实模型：动作名 → AvatarLoader 内 AvatarActionResolver → clip 播放。
  // 表情由 store.expression（状态机快照）单独驱动，组件不判断业务状态。
  const canonicalAction = actionName === 'thinking' ? 'think' : actionName === 'praise' ? 'encourage' : actionName
  if (currentModel && !currentModel.playAnimation(canonicalAction) && actionName !== 'idle') {
    currentModel.playAnimation('idle')
    currentAction = 'idle'
  }
}

watch(action, (next) => playAction(next))
// 表情：只转发状态机输出的 expression 快照，不做任何业务判断。
watch(expression, (next) => {
  currentModel?.setExpression(next ?? 'neutral', 1)
})

// 程序化占位角色：按动作施加简单姿态
function applyPose(time: number) {
  if (!root) return
  const t = time / 1000
  const bob = Math.sin(t * 2) * 0.03
  root.position.y = 0
  if (currentAction === 'talk') root.position.y = bob + Math.abs(Math.sin(t * 6)) * 0.04
  else if (currentAction === 'happy') root.position.y = Math.abs(Math.sin(t * 5)) * 0.06
  else root.position.y = bob

  if (parts.head) {
    parts.head.rotation.set(0, 0, 0)
    if (currentAction === 'listen') parts.head.rotation.x = 0.22
    else if (currentAction === 'think') parts.head.rotation.z = Math.sin(t * 2) * 0.16
    else if (currentAction === 'question') parts.head.rotation.z = Math.sin(t * 2) * 0.2 + 0.1
  }
  if (parts.mouth) {
    const open = currentAction === 'talk' ? 0.6 + Math.abs(Math.sin(t * 9)) * 0.5 : 0.25
    parts.mouth.scale.y = open
  }
  if (parts.armR) {
    if (currentAction === 'wave' || currentAction === 'goodbye') parts.armR.rotation.z = Math.sin(t * 7) * 0.9 - 0.2
    else if (currentAction === 'happy') parts.armR.rotation.z = Math.sin(t * 5) * 0.5 - 0.4
    else parts.armR.rotation.z = 0
  }
  if (parts.armL) {
    parts.armL.rotation.z = currentAction === 'happy' ? -Math.sin(t * 5) * 0.5 + 0.4 : 0
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

function fitCameraToObject(object: THREE.Object3D) {
  if (!camera) return
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const heightDistance = size.y / (2 * Math.tan(verticalFov / 2))
  const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2))
  const depth = Math.max(size.z, 0.1)
  const distance = Math.max(heightDistance, widthDistance, depth) * 1.28

  camera.position.set(center.x, center.y + size.y * 0.03, center.z + distance)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = Math.max(distance + Math.max(size.x, size.y, size.z) * 12, 100)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

function bindModel(model: AvatarLoadedModel) {
  currentModel = model
  root = model.root
  scene?.add(root)
  fitCameraToObject(root)
}

// fit 取景：根据模型实际包围盒调整相机距离，保证「人物主体完整可辨认 + 适当留白」。
// 统一覆盖 opening / 普通课堂 / 数字人大屏三种模式，不依赖模型具体高度；
// 普通课堂 margin 1.9，开场 2.2（更宽松 breathing space），
// 大屏 far 1.5：容器已放大，收紧留白让数字人主体成为大屏视觉焦点。
function frameCamera() {
  if (!root || !camera) return
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const margin = isOpening ? 2.2 : isFar ? 1.5 : 1.9
  const targetHeight = size.y * margin
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const distance = (targetHeight / 2) / Math.tan(vFov / 2)
  camera.position.set(center.x, center.y, center.z + distance)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
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
    // 容器尺寸变化后重新按模型包围盒取景，保证不裁头/裁脚。
    frameCamera()
  })
  resizeObserver.observe(mountEl.value)
}

async function init() {
  const generation = ++loadGeneration
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
  if (isOpening) {
    // 开场舞台：拉远机位以显示完整身体，保留 breathing space；非 opener 不改变课堂机位。
    camera.position.set(0, 1.05, 4.2)
    camera.lookAt(0, 1.05, 0)
  } else {
    camera.position.set(0, 0.95, 2.6)
    camera.lookAt(0, 0.95, 0)
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.8)
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(1.5, 2.5, 2)
  scene.add(ambient, key)

  // 本地角色使用旧字符串 ID；正式角色库使用数据库数字 ID。
  // 因此渲染选择必须同时读取后端角色分类，避免小熊老师仍显示默认机器人。
  const roleCategory = store.runtime?.character?.category ?? null
  const roleName = store.runtime?.character?.name ?? ''
  const isBearRole =
    roleId.value === 'bear' ||
    roleCategory === 'cartoon_animal' ||
    roleName.includes('小熊')
  const isKindergartenRole =
    roleId.value === 'garden' || roleCategory === 'kindergarten_custom'

  if (isBearRole) {
    root = buildProceduralBear()
    scene.add(root)
    fitCameraToObject(root)
    store.setModelState('loaded')
    playAction(store.action)
    startRenderLoop()
    return
  }

  if (isKindergartenRole) {
    root = buildProcedural()
    scene.add(root)
    fitCameraToObject(root)
    store.setModelState('loaded')
    playAction(store.action)
    startRenderLoop()
    return
  }

  // 三级降级：课堂运行时模型（resolve contentUrl）→ 内置默认 GLB → 程序化占位/2D。
  // 模型始终不阻塞课堂：任意一级失败都继续尝试下一级。
  const runtimeModelUrl = store.runtime?.model?.modelUrl ?? null
  const runtimeFormat = store.runtime?.model?.modelFormat ?? null
  const candidates: Array<[string, AvatarModelFormat | null]> = runtimeModelUrl
    ? [[runtimeModelUrl, runtimeFormat], [DEFAULT_MODEL_URL, 'glb']]
    : [[DEFAULT_MODEL_URL, 'glb']]
  // 受保护资产：只向 loader 提供 token，Authorization 组装与 fetch 全部在 AvatarLoader 内部完成。
  const loadContext: AvatarLoadContext = { getToken: () => useUserStore().accessToken }

  for (const [url, format] of candidates) {
    if (disposed || generation !== loadGeneration) return
    try {
      const model = await loadAvatarModel(url, format, loadContext)
      if (disposed || generation !== loadGeneration) {
        model.dispose()
        return
      }
      bindModel(model)
      store.setModelState('loaded')
      playAction(store.action)
      currentModel?.setExpression(store.expression ?? 'neutral', 1)
      frameCamera()
      startRenderLoop()
      return
    } catch {
      // 本级别模型加载失败，尝试下一候选。
    }
  }
  if (disposed) return
  root = buildProcedural()
  scene.add(root)
  fitCameraToObject(root)
  store.setModelState('loaded')
  playAction(store.action)
  frameCamera()
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
  loadGeneration += 1
  disposed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  if (renderer) {
    renderer.setAnimationLoop(null)
    renderer.dispose()
    try { renderer.forceContextLoss?.() } catch { /* 忽略 */ }
  }
  disposeScene()
  currentModel?.resetExpressions()
  currentModel?.dispose()
  currentModel = null
  root = null
  renderer = null
  camera = null
  if (mountEl.value) mountEl.value.replaceChildren()
}

watch([roleId, () => store.runtime?.model?.modelUrl], () => {
  disposeAll()
  disposed = false
  void init()
})

onMounted(() => { void init() })
onBeforeUnmount(() => disposeAll())
</script>

<template>
  <div ref="mountEl" class="three-avatar-stage" :class="{ compact }" aria-label="3D 数字人模型">
    <span class="interact-zone" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.three-avatar-stage { position: relative; width: 100%; height: 100%; min-width: 160px; min-height: 180px; pointer-events: none; transition: transform .25s ease, opacity .25s ease }
.three-avatar-stage :deep(canvas) { display: block; width: 100%; height: 100% }
/* 仅人物渲染的中心区域可点击（触发 listen），其余透明区域不拦截其下课堂助教按钮的点击。 */
.interact-zone { position: absolute; left: 50%; top: 50%; width: 74%; height: 78%; transform: translate(-50%, -48%); border-radius: 50%; pointer-events: auto; cursor: pointer }
.three-avatar-stage.compact { transform: scale(.7); transform-origin: bottom right }
</style>
