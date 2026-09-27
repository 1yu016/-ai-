<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  AGE_GROUPS,
  RESOURCE_TYPES,
  resourceApi,
  toArrayField,
  guessResourceType,
  type ResourceAgeGroup,
  type ResourceResponse,
  type ResourceType,
} from '@/api/resources'
import { apiErrorMessage } from '@/api/http'

// 大文件分片上传状态机：
// idle -> starting -> uploading -> merging -> done
//              |          |          |
//              v          v          v
//          error ←-- paused -----> error
// 支持暂停/继续、取消并清理、刷新后基于 sessionStorage 会话续传。

const emit = defineEmits<{ (e: 'done', resource: ResourceResponse): void }>()

const CHUNK_SIZE = 4 * 1024 * 1024 // 4MB
const CONCURRENCY = 4
const MAX_RETRY = 3
const SESSION_KEY = 'course-library-resource-chunk-session'

type TaskState =
  | 'idle'
  | 'starting'
  | 'uploading'
  | 'paused'
  | 'merging'
  | 'done'
  | 'error'

type StoredSession = {
  sessionId: string
  totalChunks: number
  chunkSize: number
  totalSize: number
  fileName: string
}

const form = ref({
  title: '',
  category: '',
  ageGroup: 'all' as ResourceAgeGroup,
  resourceType: 'image' as ResourceType,
  aliases: '',
  description: '',
  domain: '',
  tags: '',
  duration: '',
})

// —— 状态机核心状态 ——
const taskState = ref<TaskState>('idle')
const sessionId = ref<string | null>(null)
const totalChunks = ref(0)
const chunkSize = ref(CHUNK_SIZE)
const uploaded = ref<Set<number>>(new Set())
const progress = ref(0) // 0-100
const error = ref('')
const paused = ref(false)
const pausedChunks = ref<Set<number>>(new Set())
const currentChunk = ref(0)

const file = ref<File | null>(null)
const fileName = ref('')
const hasFileType = ref(true)
const storedSession = ref<StoredSession | null>(null)

const ageGroupLabels: Record<ResourceAgeGroup, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '全部',
}
const resourceTypeLabels: Record<ResourceType, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  pdf: 'PDF 文档',
  ppt: 'PPT 演示',
  picture_book: '绘本',
  animation: '动画',
  question_bank: '题库',
  experiment: '实验',
  model_3d: '3D 模型',
  document: '文档',
}

const stateLabel = computed<string>(() => {
  switch (taskState.value) {
    case 'idle':
      return '等待开始'
    case 'starting':
      return '创建会话中…'
    case 'uploading':
      return '上传中'
    case 'paused':
      return '已暂停'
    case 'merging':
      return '合并中'
    case 'done':
      return '已完成'
    case 'error':
      return '出错'
  }
})

const stateBadgeClass = computed<string>(() => {
  if (taskState.value === 'done') return 'ok'
  if (taskState.value === 'paused') return 'warn'
  if (taskState.value === 'error') return 'bad'
  if (isBusy(taskState.value)) return 'running'
  return 'idle'
})

function isBusy(s: TaskState) {
  return s === 'starting' || s === 'uploading' || s === 'merging'
}

let taking = new Set<number>() // 已被 worker 领取的分片
let stopped = false // 出错/取消后阻止分发

onMounted(() => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession
      if (parsed && parsed.sessionId) storedSession.value = parsed
    }
  } catch {
    storedSession.value = null
  }
})

function persistSession(s: StoredSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
}
function clearStoredSession() {
  sessionStorage.removeItem(SESSION_KEY)
  storedSession.value = null
}

function resetCoreState() {
  sessionId.value = null
  totalChunks.value = 0
  chunkSize.value = CHUNK_SIZE
  uploaded.value = new Set()
  progress.value = 0
  error.value = ''
  paused.value = false
  pausedChunks.value = new Set()
  currentChunk.value = 0
  taking.clear()
  stopped = false
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  if (!picked) {
    file.value = null
    fileName.value = ''
    hasFileType.value = true
    return
  }
  file.value = picked
  fileName.value = picked.name
  const guessed = guessResourceType(picked.name)
  if (guessed) form.value.resourceType = guessed
  hasFileType.value = guessed !== null
}

function isSameStoredFile() {
  return (
    !!file.value &&
    !!storedSession.value &&
    file.value.name === storedSession.value.fileName
  )
}

function buildMeta() {
  const aliases = toArrayField(form.value.aliases)
  const tags = toArrayField(form.value.tags)
  const meta: {
    title: string
    category: string
    ageGroup: ResourceAgeGroup
    resourceType: ResourceType
    aliases?: string[]
    description?: string
    domain?: string
    tags?: string[]
    duration?: number
  } = {
    title: form.value.title.trim(),
    category: form.value.category.trim(),
    ageGroup: form.value.ageGroup,
    resourceType: form.value.resourceType,
  }
  if (aliases.length) meta.aliases = aliases
  if (form.value.description.trim()) meta.description = form.value.description.trim()
  if (form.value.domain.trim()) meta.domain = form.value.domain.trim()
  if (tags.length) meta.tags = tags
  if (form.value.duration.trim()) meta.duration = Number(form.value.duration)
  return meta
}

function validate(): string | null {
  if (!form.value.title.trim()) return '请填写资源标题'
  if (!form.value.category.trim()) return '请填写资源分类'
  if (!file.value) return '请选择文件'
  if (!hasFileType.value) return '无法识别该文件的扩展名类型'
  return null
}

function takenUpdate() {
  uploaded.value = new Set(uploaded.value)
  pausedChunks.value = new Set(pausedChunks.value)
}

function refreshProgress() {
  progress.value =
    totalChunks.value > 0
      ? Math.round((uploaded.value.size / totalChunks.value) * 100)
      : 0
}

function takeNextMissing(): number | null {
  for (let i = 0; i < totalChunks.value; i++) {
    if (uploaded.value.has(i) || taking.has(i)) continue
    taking.add(i)
    return i
  }
  return null
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function uploadChunkWithRetry(chunkNo: number): Promise<void> {
  const start = chunkNo * chunkSize.value
  const f = file.value!
  const chunk = f.slice(start, start + chunkSize.value)
  let sha = ''
  try {
    sha = await sha256Hex(chunk)
  } catch {
    // 签名计算异常走失败重试路径
  }
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    if (stopped) return
    try {
      await resourceApi.uploadChunk(sessionId.value!, chunkNo, chunk, sha)
      uploaded.value.add(chunkNo)
      taking.delete(chunkNo)
      currentChunk.value = chunkNo
      refreshProgress()
      takenUpdate()
      return
    } catch (e) {
      lastError = apiErrorMessage(e, `分片 ${chunkNo} 上传失败`)
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 400 * attempt))
      }
    }
  }
  error.value = lastError
  taskState.value = 'error'
  stopped = true
  ElMessage.error(lastError)
}

async function worker() {
  while (!stopped) {
    if (paused.value) return
    if (taskState.value !== 'uploading') return
    const chunkNo = takeNextMissing()
    if (chunkNo === null) return
    await uploadChunkWithRetry(chunkNo)
  }
}

async function startDispatcher() {
  taskState.value = 'uploading'
  const runners = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(runners)
  if (stopped) return
  if (paused.value) {
    taskState.value = 'paused'
    return
  }
  if (uploaded.value.size < totalChunks.value) return
  await doComplete()
}

async function loadUploaded() {
  if (!sessionId.value) return
  const { data } = await resourceApi.listUploadedChunks(sessionId.value)
  uploaded.value = new Set(data.uploadedChunks.map((chunk) => chunk.chunkNo))
  refreshProgress()
  takenUpdate()
}

async function doComplete() {
  if (!sessionId.value) return
  const sid = sessionId.value
  taskState.value = 'merging'
  error.value = ''
  try {
    const { data } = await resourceApi.completeUpload(sid)
    taskState.value = 'done'
    ElMessage.success('分片上传完成，资源已合并')
    clearStoredSession()
    emit('done', data)
  } catch (e) {
    error.value = apiErrorMessage(e, '合并文件失败')
    taskState.value = 'error'
    ElMessage.error(error.value)
  }
}

// —— 新建会话并上传 ——
async function startNewUpload() {
  const msg = validate()
  if (msg) {
    ElMessage.warning(msg)
    return
  }
  taskState.value = 'starting'
  error.value = ''
  stopped = false
  let f: File
  try {
    f = file.value!
    const res = await resourceApi.createUploadSession({
      ...buildMeta(),
      originalName: f.name,
      declaredMime: f.type,
      totalSize: f.size,
      chunkSize: CHUNK_SIZE,
    })
    const id = res.data.id
    const size = res.data.chunkSize || CHUNK_SIZE
    const total =
      res.data.totalChunks || Math.ceil(f.size / (res.data.chunkSize || CHUNK_SIZE))
    sessionId.value = id
    chunkSize.value = size
    totalChunks.value = total
    paused.value = false
    taking.clear()
    persistSession({
      sessionId: id,
      totalChunks: total,
      chunkSize: size,
      totalSize: f.size,
      fileName: f.name,
    })
    await loadUploaded()
    await startDispatcher()
  } catch (e) {
    error.value = apiErrorMessage(e, '创建上传会话失败')
    taskState.value = 'error'
    ElMessage.error(error.value)
  }
}

// —— 刷新/续传已有会话（仅传缺失分片） ——
async function resumeUpload() {
  if (!storedSession.value) {
    ElMessage.warning('没有可恢复的上传会话')
    return
  }
  const f = file.value
  if (!f || f.name !== storedSession.value.fileName || f.size !== storedSession.value.totalSize) {
    ElMessage.warning('请选择与原文件名称和大小都一致的文件后再继续')
    return
  }
  const stored = storedSession.value
  taskState.value = 'starting'
  error.value = ''
  stopped = false
  sessionId.value = stored.sessionId
  totalChunks.value = stored.totalChunks
  chunkSize.value = stored.chunkSize
  paused.value = false
  taking.clear()
  uploaded.value = new Set()
  takenUpdate()
  try {
    await loadUploaded()
    await startDispatcher()
  } catch (e) {
    error.value = apiErrorMessage(e, '恢复上传会话失败')
    taskState.value = 'error'
    ElMessage.error(error.value)
  }
}

function pauseUpload() {
  if (taskState.value !== 'uploading') return
  paused.value = true
  pausedChunks.value = new Set(taking)
  taskState.value = 'paused'
  ElMessage.info('已暂停，已发出的几个分片会继续完成接收')
}

async function continueUpload() {
  if (!sessionId.value) return
  paused.value = false
  pausedChunks.value = new Set()
  taskState.value = 'uploading'
  try {
    await loadUploaded()
    await startDispatcher()
  } catch (e) {
    error.value = apiErrorMessage(e, '继续上传失败')
    taskState.value = 'error'
    ElMessage.error(error.value)
  }
}

async function cancelUpload() {
  stopped = true
  paused.value = false
  const sid = sessionId.value
  resetCoreState()
  taskState.value = 'idle'
  clearStoredSession()
  if (sid) {
    try {
      await resourceApi.abortUpload(sid)
      ElMessage.info('已取消并清理分片上传')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '取消失败'))
    }
  }
}
</script>

<template>
  <div class="chunk-uploader">
    <div v-if="storedSession" class="restore-card">
      <div class="restore-info">
        <span class="badge warn">检测到未完成的上传</span>
        <span class="muted">上次上传文件：{{ storedSession.fileName }}（共 {{ storedSession.totalChunks }} 片）</span>
      </div>
      <p class="restore-tip">
        刷新后不提供无感恢复：请重新选择与原文件同名的文件，再点击「继续上次上传」。
      </p>
    </div>

    <div class="field">
      <label class="req">标题</label>
      <input v-model="form.title" type="text" maxlength="120" placeholder="资源标题" />
    </div>
    <div class="field">
      <label class="req">分类</label>
      <input v-model="form.category" type="text" placeholder="输入资源分类" />
    </div>
    <div class="field-row">
      <div class="field">
        <label class="req">适用年龄段</label>
        <select v-model="form.ageGroup">
          <option v-for="a in AGE_GROUPS" :key="a" :value="a">{{ ageGroupLabels[a] }}</option>
        </select>
      </div>
      <div class="field">
        <label class="req">资源类型</label>
        <select v-model="form.resourceType">
          <option v-for="t in RESOURCE_TYPES" :key="t" :value="t">{{ resourceTypeLabels[t] }}</option>
        </select>
      </div>
      <div class="field">
        <label>时长(秒)</label>
        <input v-model="form.duration" type="number" min="0" placeholder="音视频时长" />
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>学科领域</label>
        <input v-model="form.domain" type="text" placeholder="如：语言、科学" />
      </div>
      <div class="field">
        <label>标签</label>
        <input v-model="form.tags" type="text" placeholder="多个标签用逗号分隔" />
      </div>
    </div>
    <div class="field">
      <label>别名</label>
      <input v-model="form.aliases" type="text" placeholder="多个别名用逗号分隔" />
    </div>
    <div class="field">
      <label>描述</label>
      <textarea v-model="form.description" rows="3" placeholder="资源描述" />
    </div>

    <div class="field">
      <label class="req">文件（将按 4MB 自动分片并发上传）</label>
      <input type="file" @change="onFileChange" />
      <p v-if="fileName" class="file-name">已选择：{{ fileName }}</p>
    </div>

    <!-- 状态徽章 -->
    <div class="state-row">
      <span class="badge" :class="stateBadgeClass">{{ stateLabel }}</span>
      <span v-if="taskState === 'uploading' || taskState === 'paused'" class="muted">
        已传 {{ uploaded.size }}/{{ totalChunks }} 片
      </span>
      <span v-if="currentChunk > 0 && taskState === 'uploading'" class="muted">
        当前分片 #{{ currentChunk }}
      </span>
    </div>

    <!-- 进度 -->
    <div
      v-if="taskState === 'starting' || taskState === 'uploading' || taskState === 'paused' || taskState === 'merging'"
      class="progress-wrap"
    >
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: progress + '%' }" />
      </div>
      <span class="progress-text">{{ progress }}%</span>
    </div>
    <div v-if="taskState === 'merging'" class="hint ok">分片已全部上传，正在合并文件中…</div>
    <div v-else-if="taskState === 'error'" class="hint bad">{{ error }}</div>
    <div v-else-if="fileName && !hasFileType" class="hint warn">无法识别该文件的扩展名，无法上传。</div>

    <!-- 操作按钮 -->
    <div class="actions">
      <template v-if="taskState === 'idle' || taskState === 'error'">
        <button class="button primary" @click="startNewUpload">开始分片上传</button>
        <button
          v-if="storedSession"
          class="button outline"
          :disabled="!isSameStoredFile()"
          @click="resumeUpload"
        >
          {{ isSameStoredFile() ? '继续上次上传' : '续传（需重新选择同文件）' }}
        </button>
      </template>
      <template
        v-else-if="taskState === 'starting' || taskState === 'uploading' || taskState === 'paused' || taskState === 'merging'"
      >
        <button v-if="taskState === 'uploading'" class="button outline" @click="pauseUpload">
          暂停
        </button>
        <button v-if="taskState === 'paused'" class="button primary" @click="continueUpload">
          继续
        </button>
        <button class="button danger" @click="cancelUpload">取消并清理</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chunk-uploader {
  display: grid;
  gap: 16px;
}
.restore-card {
  border: 1px solid #f0d9a0;
  background: #fff8ea;
  border-radius: 10px;
  padding: 12px 14px;
  gap: 8px;
  display: grid;
}
.restore-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.restore-tip {
  margin: 0;
  font-size: 13px;
  color: #8a6d2f;
}
.field {
  display: grid;
  gap: 6px;
}
.field label {
  font-size: 13px;
  color: #40546a;
  font-weight: 600;
}
.field label.req::after {
  content: ' *';
  color: #d13b3b;
}
.field input,
.field select,
.field textarea {
  border: 1px solid #dce5ed;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
  width: 100%;
}
.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: #36aa89;
  box-shadow: 0 0 0 2px rgba(54, 170, 137, 0.15);
}
.field-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.field-row:has(.field:nth-child(2)) {
  grid-template-columns: repeat(2, 1fr);
}
.file-name {
  font-size: 13px;
  color: #229a7d;
}
.state-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.badge {
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
}
.badge.ok {
  background: #e6f7ef;
  color: #21936f;
}
.badge.warn {
  background: #fff3dc;
  color: #b77d20;
}
.badge.bad {
  background: #ffebeb;
  color: #c64e4e;
}
.badge.running {
  background: #e3f2fc;
  color: #1f7aa8;
}
.badge.idle {
  background: #eef2f5;
  color: #66788c;
}
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-track {
  flex: 1;
  height: 10px;
  background: #edf2f5;
  border-radius: 5px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #229a7d, #36aa89);
  transition: width 0.2s ease;
}
.progress-text {
  font-size: 13px;
  color: #229a7d;
  min-width: 42px;
  text-align: right;
}
.hint {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.hint.ok {
  background: #e6f7ef;
  color: #21936f;
}
.hint.warn {
  background: #fff3dc;
  color: #b77d20;
}
.hint.bad {
  background: #ffebeb;
  color: #c64e4e;
}
.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.button {
  border: 0;
  border-radius: 8px;
  padding: 11px 22px;
  cursor: pointer;
  font-size: 14px;
}
.button.primary {
  background: #36aa89;
  color: #fff;
}
.button.primary:hover {
  background: #229a7d;
}
.button.outline {
  background: #fff;
  border: 1px solid #36aa89;
  color: #229a7d;
}
.button.outline:hover {
  background: #edf7f4;
}
.button.danger {
  background: #ffebeb;
  color: #c64e4e;
}
.button.danger:hover {
  background: #ffdcdc;
}
.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.muted {
  font-size: 13px;
  color: #8191a2;
}
@media (max-width: 700px) {
  .field-row {
    grid-template-columns: 1fr;
  }
}
</style>
