<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const props = defineProps<{ src: string; title: string }>()

const host = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref(false)
let generation = 0
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let animationFrame = 0
let resizeObserver: ResizeObserver | null = null
let scene: THREE.Scene | null = null

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose()
  }
  material.dispose()
}

function cleanup() {
  generation += 1
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
  controls?.dispose()
  controls = null
  scene?.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial)
    else if (mesh.material) disposeMaterial(mesh.material)
  })
  scene = null
  if (renderer) {
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
    renderer = null
  }
}

async function renderModel() {
  cleanup()
  const loadId = generation
  loading.value = true
  failed.value = false
  if (!props.src) return
  await nextTick()
  const element = host.value
  if (!element || loadId !== generation) return
  try {
    const nextScene = new THREE.Scene()
    nextScene.background = new THREE.Color(0xf8f1e9)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
    camera.position.set(0, 1.2, 4)
    const nextRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    nextRenderer.outputColorSpace = THREE.SRGBColorSpace
    element.appendChild(nextRenderer.domElement)
    renderer = nextRenderer
    scene = nextScene

    nextScene.add(new THREE.HemisphereLight(0xffffff, 0x75665c, 2.2))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    keyLight.position.set(3, 5, 4)
    nextScene.add(keyLight)

    controls = new OrbitControls(camera, nextRenderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 0.5
    controls.maxDistance = 20

    const resize = () => {
      const width = Math.max(element.clientWidth, 1)
      const height = Math.max(element.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      nextRenderer.setSize(width, height, false)
    }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(element)
    resize()

    const gltf = await new GLTFLoader().loadAsync(props.src)
    if (loadId !== generation) {
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial)
        else if (mesh.material) disposeMaterial(mesh.material)
      })
      return
    }
    nextScene.add(gltf.scene)
    const box = new THREE.Box3().setFromObject(gltf.scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maximum = Math.max(size.x, size.y, size.z, 0.1)
    gltf.scene.position.sub(center)
    camera.position.set(maximum * 1.4, maximum * 0.8, maximum * 2.2)
    camera.near = Math.max(maximum / 100, 0.01)
    camera.far = Math.max(maximum * 100, 100)
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
    controls.update()
    loading.value = false

    const animate = () => {
      controls?.update()
      nextRenderer.render(nextScene, camera)
      animationFrame = requestAnimationFrame(animate)
    }
    animate()
  } catch (error) {
    console.error('3D 模型加载失败：', error)
    if (loadId === generation) {
      loading.value = false
      failed.value = true
    }
  }
}

watch(() => props.src, () => void renderModel(), { immediate: true })
onBeforeUnmount(cleanup)
</script>

<template>
  <div ref="host" class="model-stage" :aria-label="`${title} 3D 预览`">
    <p v-if="loading && !failed" class="model-message">3D 模型加载中…</p>
    <div v-if="failed" class="model-error" role="alert">
      <strong>3D 模型加载失败</strong>
      <span>文件可能损坏，或包含未上传的外部贴图。</span>
    </div>
    <p v-if="!loading && !failed" class="model-help">拖动旋转 · 滚轮或双指缩放</p>
  </div>
</template>

<style scoped>
.model-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 12px;
  background: #f8f1e9;
}

.model-stage :deep(canvas) { display: block; width: 100%; height: 100%; }
.model-message,
.model-help {
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 14px;
  margin: 0;
  padding: 7px 12px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgb(255 255 255 / 88%);
  color: #7f695d;
}
.model-error {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: #9c433a;
}
.model-error span { color: #806c61; }
</style>
