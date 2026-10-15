<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import type { Student } from '@/api/platform'
import {
  confirmArtworkReview,
  deliverArtworkReview,
  generateArtworkAiDraft,
  uploadStudentArtwork,
  validateArtworkFile,
  type StudentArtwork,
} from '@/services/studentArtwork'

const props = defineProps<{
  runId: number
  lessonStepIndex: number | null
  students: Student[]
  /** 后端作品上传接口是否已可用；默认自动探测（未就绪时页面阻塞）。 */
  backendReady?: boolean
  deviceId?: number
  runVersion?: number
}>()

type Stage =
  | 'file_pick' // 待选文件
  | 'preview' // 已选，校验通过，待上传
  | 'uploading' // 上传中
  | 'ai_reviewing' // AI 草稿生成中
  | 'teacher_confirm' // 待教师确认（有 AI 草稿或教师自行填写）
  | 'confirmed' // 已确认
  | 'backend_not_ready' // 后端未就绪，显式阻塞
  | 'error' // 上传/生成/确认失败

const stage = ref<Stage>('file_pick')
const errorText = ref('')
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const selectedStudentId = ref<number | null>(props.students[0]?.id ?? null)
const artwork = ref<StudentArtwork | null>(null)
const aiDraft = ref('')
const teacherComment = ref('')
const confirmSaving = ref(false)
const delivering = ref(false)
const delivered = ref(false)
const cameraActive = ref(false)
const cameraVideo = ref<HTMLVideoElement | null>(null)
let cameraStream: MediaStream | null = null

if (props.backendReady === false) {
  stage.value = 'backend_not_ready'
}

async function startCamera() {
  try {
    stopCamera()
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    cameraActive.value = true
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (cameraVideo.value) {
      cameraVideo.value.srcObject = cameraStream
      await cameraVideo.value.play()
    }
  } catch (e) {
    stopCamera()
    ElMessage.error(apiErrorMessage(e, '摄像头不可用，请检查权限或改用本地图片。'))
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop())
  cameraStream = null
  cameraActive.value = false
  if (cameraVideo.value) cameraVideo.value.srcObject = null
}

async function capturePhoto() {
  const video = cameraVideo.value
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')?.drawImage(video, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) {
    ElMessage.error('拍照失败，请重新尝试。')
    return
  }
  stopCamera()
  resetObjectUrl()
  file.value = new File([blob], `artwork-${Date.now()}.jpg`, { type: 'image/jpeg' })
  previewUrl.value = URL.createObjectURL(file.value)
  stage.value = 'preview'
}

function resetObjectUrl() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function pickFile(event: Event) {
  const target = event.target as HTMLInputElement
  const selected = target.files?.[0] ?? null
  if (!selected) return
  const result = validateArtworkFile(selected)
  if (!result.ok) {
    ElMessage.error(result.reason)
    stage.value = 'error'
    errorText.value = result.reason
    file.value = null
    return
  }
  resetObjectUrl()
  file.value = selected
  previewUrl.value = URL.createObjectURL(selected)
  stage.value = 'preview'
  errorText.value = ''
}

async function upload() {
  if (!file.value) return
  if (selectedStudentId.value == null) {
    ElMessage.warning('请先选择幼儿，以核验照片和作品授权。')
    return
  }
  stage.value = 'uploading'
  errorText.value = ''
  try {
    artwork.value = await uploadStudentArtwork(props.runId, {
      studentId: selectedStudentId.value,
      lessonStepIndex: props.lessonStepIndex,
      file: file.value,
    })
    // 上传成功后才进入后续阶段
    stage.value = 'ai_reviewing'
    void requestAiDraft()
  } catch (e) {
    stage.value = 'error'
    errorText.value = apiErrorMessage(e, '作品上传失败，请重试。')
  }
}

async function requestAiDraft() {
  if (!artwork.value) return
  stage.value = 'ai_reviewing'
  errorText.value = ''
  try {
    const result = await generateArtworkAiDraft({ artworkId: artwork.value.id })
    aiDraft.value = result.aiDraft
    teacherComment.value = result.aiDraft
    stage.value = 'teacher_confirm'
  } catch (e) {
    // AI 视觉能力未接入：明确失败，绝不伪造文案。教师仍可自行填写后确认。
    aiDraft.value = ''
    errorText.value =
      apiErrorMessage(e, 'AI 评价能力暂未接入，可手动填写教师评价后保存。')
    teacherComment.value = ''
    stage.value = 'teacher_confirm'
  }
}

async function confirmComment() {
  if (!artwork.value) return
  const text = teacherComment.value.trim()
  if (!text) {
    ElMessage.warning('请先填写或确认教师评价。')
    return
  }
  confirmSaving.value = true
  errorText.value = ''
  try {
    const confirmed = await confirmArtworkReview({
      artworkId: artwork.value.id,
      teacherComment: text,
    })
    artwork.value = { ...artwork.value, teacherComment: confirmed.teacherComment, confirmedAt: confirmed.confirmedAt }
    stage.value = 'confirmed'
  } catch (e) {
    // 确认失败保持 teacher_confirm 待确认态，不假装成功。
    errorText.value = apiErrorMessage(e, '评价保存失败，请重试。')
  } finally {
    confirmSaving.value = false
  }
}

async function deliver() {
  if (!artwork.value || !props.deviceId || !props.runVersion) return
  delivering.value = true
  try {
    await deliverArtworkReview({
      artworkId: artwork.value.id,
      requestId: globalThis.crypto?.randomUUID?.() ?? `artwork-${Date.now()}`,
      deviceId: props.deviceId,
      targetDeviceId: props.deviceId,
      expectedVersion: props.runVersion,
    })
    delivered.value = true
    ElMessage.success('作品和教师评价已投递到课堂大屏。')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '投递失败，请刷新课堂状态后重试。'))
  } finally {
    delivering.value = false
  }
}

function startOver() {
  stopCamera()
  resetObjectUrl()
  file.value = null
  previewUrl.value = null
  artwork.value = null
  aiDraft.value = ''
  teacherComment.value = ''
  stage.value = 'file_pick'
  errorText.value = ''
  delivered.value = false
}

function onUnmount() {
  stopCamera()
  resetObjectUrl()
}

onBeforeUnmount(onUnmount)
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <div>
        <h2>绘画作品评价</h2>
        <p class="muted">拍照或上传作品 → AI 生成可编辑草稿 → 教师确认后才能投递大屏。</p>
      </div>
    </div>

    <!-- 后端未就绪：明确阻塞 -->
    <div v-if="stage === 'backend_not_ready'" class="blocked">
      <span class="tag">后端未就绪</span>
      <p>儿童作品上传与评价接口尚未部署（FRONTEND_READY_BACKEND_BLOCKED）。</p>
      <p class="muted">
        接口就绪后此处自动变为可用。当前不会用 localStorage 或硬编码文案冒充保存成功。
        <br>
        范围见《STAGE_7_6_ARTWORK_BACKEND_HANDOFF.md》与《STAGE_7_6_ARTWORK_AI_HANDOFF.md》。
      </p>
    </div>

    <div v-else-if="stage === 'error'" class="bad">
      {{ errorText }}
      <button class="ghost" @click="startOver">重新选择</button>
    </div>

    <template v-else>
      <div v-if="stage === 'file_pick' || stage === 'preview'" class="pick">
        <select v-model.number="selectedStudentId">
          <option :value="null">请选择幼儿（用于核验授权）</option>
          <option v-for="student in students" :key="student.id" :value="student.id">
            {{ student.nickname || student.name }}
          </option>
        </select>
        <div class="camera-actions">
          <button v-if="!cameraActive" class="ghost" type="button" @click="startCamera">📷 使用大屏摄像头</button>
          <template v-else>
            <button class="button" type="button" @click="capturePhoto">拍下作品</button>
            <button class="ghost" type="button" @click="stopCamera">关闭摄像头</button>
          </template>
        </div>
        <video v-show="cameraActive" ref="cameraVideo" class="camera-preview" muted playsinline></video>
        <label class="upload-box">
          <span>🖼️</span>
          <strong>{{ file ? file.name : '选择一幅作品' }}</strong>
          <small>支持 JPG、PNG · ≤10MB</small>
          <input type="file" accept="image/jpeg,image/png" @change="pickFile">
        </label>
        <img v-if="previewUrl" :src="previewUrl" alt="作品预览" class="preview">
        <button class="button" :disabled="!file || selectedStudentId == null" @click="upload">
          上传作品
        </button>
      </div>

      <div v-else-if="stage === 'uploading'" class="blocked">
        <p>作品上传中…</p>
      </div>

      <div v-else-if="stage === 'ai_reviewing'" class="blocked">
        <p>正在生成 AI 评价草稿…</p>
      </div>

      <div v-else-if="stage === 'teacher_confirm'" class="draft">
        <span class="tag">待教师确认</span>
        <p v-if="aiDraft" class="muted">以下是 AI 草稿，请核对后确认。未确认不会对外播放。</p>
        <textarea v-model="teacherComment" rows="5" :disabled="confirmSaving"></textarea>
        <p v-if="errorText" class="bad">{{ errorText }}</p>
        <div>
          <button class="button" :disabled="confirmSaving" @click="confirmComment">
            {{ confirmSaving ? '保存中…' : '确认并保存' }}
          </button>
          <button class="ghost" @click="startOver">重新开始</button>
        </div>
      </div>

      <div v-else-if="stage === 'confirmed'" class="confirmed">
        <span class="tag ok">已确认 ✓</span>
        <p class="review">{{ artwork?.teacherComment }}</p>
        <p class="muted">评价已正式保存为教师确认版本。</p>
        <button
          v-if="deviceId && runVersion"
          class="button"
          :disabled="delivering || delivered"
          @click="deliver"
        >
          {{ delivered ? '已投递到大屏' : delivering ? '投递中…' : '在大屏展示并朗读' }}
        </button>
        <button class="ghost" @click="startOver">再评价一件作品</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel { border: 1px solid #f0ddce; border-radius: 18px; background: #fffdf9; padding: 20px; box-shadow: 0 10px 28px #b9795114; }
.section-head { margin-bottom: 12px; }
.section-head h2, .panel h2 { margin: 0 0 6px; color: #60483e; }
.muted { color: #9a7e6e; line-height: 1.6; }
.tag { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #f5d9bf; color: #a9654c; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
.tag.ok { background: #dfe9d8; color: #47713d; }
.blocked { padding: 14px 16px; border: 1px dashed #d9a77e; border-radius: 12px; background: #fff6ec; color: #876b5d; }
.bad { color: #c64e4e; padding: 10px 12px; border: 1px solid #efc6bf; border-radius: 10px; background: #fff4f1; }
.pick { display: grid; gap: 12px; }
.camera-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.camera-preview { width: 100%; max-height: 280px; border-radius: 12px; background: #2b2927; object-fit: contain; }
.pick select { height: 40px; border: 1px solid #efd9c8; border-radius: 10px; padding: 0 11px; background: #fff; color: #60483e; }
.upload-box { display: grid; gap: 4px; justify-items: center; padding: 18px; border: 1px dashed #e0c2ad; border-radius: 12px; background: #fff8f0; cursor: pointer; text-align: center; color: #9a7e6e; }
.upload-box input { display: none; }
.preview { max-height: 220px; border-radius: 10px; border: 1px solid #f0ddce; }
.button { border: 0; border-radius: 11px; padding: 12px 20px; cursor: pointer; background: #e99168; color: #fff; }
.button:disabled { opacity: 0.55; cursor: not-allowed; }
.ghost { border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; border-radius: 10px; padding: 8px 14px; cursor: pointer; }
.draft { display: grid; gap: 10px; margin-top: 12px; }
.draft textarea { width: 100%; border: 1px solid #efd9c8; border-radius: 10px; padding: 10px; resize: vertical; color: #60483e; }
.draft div, .confirmed { display: flex; gap: 8px; align-items: center; }
.confirmed { flex-direction: column; gap: 10px; align-items: flex-start; }
.review { font-size: 15px; color: #6b584c; border: 1px solid #e4d5c8; border-radius: 10px; padding: 12px; background: #fff8f0; }
</style>
