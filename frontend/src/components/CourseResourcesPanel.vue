<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElButton, ElDialog, ElMessage, ElMessageBox, ElProgress } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import {
  COURSE_RESOURCE_CATEGORIES,
  RESOURCE_AGE_GROUPS,
  RESOURCE_TYPES,
  type CourseResource,
  type CourseResourceCategory,
  type CourseResourceMediaType,
  type ResourceAgeGroup,
  type ResourceForm,
  useCourseResourceStore,
} from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useUserStore } from '@/stores/user'

const emit = defineEmits<{ copyToChat: [resource: CourseResource] }>()
const resourceStore = useCourseResourceStore()
const playerStore = useResourcePlayerStore()
const userStore = useUserStore()
void resourceStore.initialize()

const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班', middle: '中班', large: '大班', all: '全年龄',
}
const TYPE_LABELS: Record<CourseResourceMediaType, string> = {
  image: '图片', audio: '音频', video: '视频', document: '文档/课件',
}
const MIME_LIMITS: Record<string, number> = {
  'image/jpeg': 10, 'image/png': 10, 'audio/mpeg': 30,
  'audio/wav': 30, 'video/mp4': 200, 'application/pdf': 30,
  'application/vnd.ms-powerpoint': 50,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 50,
}

const selectedCategory = ref<'' | CourseResourceCategory>('')
const selectedType = ref<'' | CourseResourceMediaType>('')
const selectedAgeGroup = ref<'' | ResourceAgeGroup>('')
const keyword = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const uploadVisible = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const resourcePlayerRef = ref<InstanceType<typeof ResourcePlayer> | null>(null)
const editingResource = ref<CourseResource | null>(null)
const editVisible = ref(false)
const saving = ref(false)
const migrating = ref(false)
const migrationProgress = ref(0)
const form = ref<ResourceForm>(emptyForm())

const filteredResources = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return resourceStore.sortedResources.filter((resource) => {
    if (selectedCategory.value && resource.category !== selectedCategory.value) return false
    if (selectedType.value && resource.mediaType !== selectedType.value) return false
    if (selectedAgeGroup.value && resource.ageGroup !== selectedAgeGroup.value) return false
    if (!normalizedKeyword) return true
    return [resource.title, resource.fileName, ...resource.aliases, ...resource.tags]
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedKeyword))
  })
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch([selectedCategory, selectedType, selectedAgeGroup, keyword], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void refresh(), 280)
})
watch(() => userStore.isLogin, (isLogin) => {
  if (isLogin) void refresh()
})

function emptyForm(): ResourceForm {
  return { title: '', aliases: [], description: '', category: '图片卡片', ageGroup: 'all', tags: [] }
}

function splitValues(value: string): string[] {
  return [...new Set(value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))]
}

function currentFilters() {
  return {
    category: selectedCategory.value || undefined,
    resourceType: selectedType.value || undefined,
    ageGroup: selectedAgeGroup.value || undefined,
    keyword: keyword.value.trim() || undefined,
  }
}

async function refresh() {
  await resourceStore.refreshLibrary(currentFilters())
}

function openFilePicker() {
  if (!userStore.isLogin) {
    ElMessage.warning('请先登录教师账号后上传课程资源')
    return
  }
  fileInputRef.value?.click()
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const maxMb = MIME_LIMITS[file.type]
  if (!maxMb) {
    ElMessage.error('仅支持 JPG、PNG、MP3、WAV、MP4、PDF、PPT 和 PPTX 文件')
    return
  }
  if (file.size > maxMb * 1024 * 1024) {
    ElMessage.error(`该类型文件不能超过 ${maxMb}MB`)
    return
  }
  selectedFile.value = file
  form.value = {
    ...emptyForm(),
    title: file.name.replace(/\.[^.]+$/, ''),
    category: suggestedCategory(file.type),
  }
  uploadProgress.value = 0
  uploadVisible.value = true
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
    void readMediaDuration(file).then((duration) => {
      if (selectedFile.value === file && duration !== null) form.value.duration = duration
    })
  }
}

function readMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const objectUrl = URL.createObjectURL(file)
    let settled = false
    const finish = (duration: number | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(objectUrl)
      media.removeAttribute('src')
      resolve(duration)
    }
    const timer = window.setTimeout(() => finish(null), 5000)
    media.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer)
      finish(Number.isFinite(media.duration) ? media.duration : null)
    }, { once: true })
    media.addEventListener('error', () => {
      window.clearTimeout(timer)
      finish(null)
    }, { once: true })
    media.preload = 'metadata'
    media.src = objectUrl
  })
}

function suggestedCategory(mimeType: string): CourseResourceCategory {
  if (mimeType.startsWith('audio/')) return '歌曲音乐'
  if (mimeType.startsWith('video/')) return '视频动画'
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) return '教案课件'
  return '图片卡片'
}

async function submitUpload() {
  if (!selectedFile.value || !form.value.title.trim()) {
    ElMessage.warning('请填写资源标题')
    return
  }
  uploading.value = true
  try {
    await resourceStore.uploadResource(selectedFile.value, form.value, (value) => {
      uploadProgress.value = value
    })
    uploadVisible.value = false
    selectedFile.value = null
    ElMessage.success('资源上传成功，等待教师审核确认后使用')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '资源上传失败，请重试。'))
  } finally {
    uploading.value = false
  }
}

function openEdit(resource: CourseResource) {
  if (resource.source !== 'library') return
  editingResource.value = resource
  form.value = {
    title: resource.title,
    aliases: [...resource.aliases],
    description: resource.description ?? '',
    category: resource.category,
    ageGroup: resource.ageGroup,
    tags: [...resource.tags],
  }
  editVisible.value = true
}

async function submitEdit() {
  const resource = editingResource.value
  if (!resource || typeof resource.id !== 'number' || !form.value.title.trim()) return
  saving.value = true
  try {
    const updated = await resourceStore.updateResource(resource.id, form.value)
    playerStore.syncResource(updated)
    editVisible.value = false
    ElMessage.success('资源信息已更新')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '资源修改失败，请重试。'))
  } finally {
    saving.value = false
  }
}

async function deleteResource(resource: CourseResource) {
  try {
    await ElMessageBox.confirm(`确定删除“${resource.title}”吗？删除后不可恢复。`, '删除资源', {
      confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }

  try {
    if (resource.source === 'library' && typeof resource.id === 'number') {
      await resourceStore.deleteResource(resource.id)
    } else {
      resourceStore.deleteLegacyResource(String(resource.id))
    }
    if (playerStore.currentResource?.id === resource.id) playerStore.close()
    ElMessage.success('资源已删除')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '资源删除失败，请重试。'))
  }
}

async function migrateLegacyResources() {
  if (!userStore.isLogin) {
    ElMessage.warning('请先登录教师账号再迁移旧素材')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将逐个上传 ${resourceStore.legacyResources.length} 个旧版本地素材，上传成功后才会删除本地副本。`,
      '迁移旧素材',
      { confirmButtonText: '开始迁移', cancelButtonText: '取消', type: 'info' },
    )
  } catch { return }

  migrating.value = true
  migrationProgress.value = 0
  const resources = [...resourceStore.legacyResources]
  let succeeded = 0
  for (const [index, resource] of resources.entries()) {
    try {
      await resourceStore.migrateLegacyResource(resource)
      succeeded += 1
    } catch (error) {
      console.error(`迁移旧素材 ${resource.title} 失败：`, error)
    }
    migrationProgress.value = Math.round(((index + 1) / resources.length) * 100)
  }
  migrating.value = false
  if (succeeded === resources.length) ElMessage.success(`已迁移 ${succeeded} 个旧素材`)
  else ElMessage.warning(`成功迁移 ${succeeded} 个，失败素材已保留在本地`)
}

function copyResource(resource: CourseResource) {
  emit('copyToChat', resource)
  ElMessage.success('资源引用已放入聊天输入框')
}

async function openResource(resource: CourseResource) {
  if (resourcePlayerRef.value) {
    await resourcePlayerRef.value.openResource(resource)
    return
  }
  playerStore.openResource(resource)
}

async function enterClassroomMode() {
  const resource = playerStore.currentResource ?? filteredResources.value[0]
  if (!resource) {
    ElMessage.warning('请先上传或选择一个课程资源')
    return
  }
  if (!playerStore.currentResource) await openResource(resource)
  await nextTick()
  await resourcePlayerRef.value?.enterClassroomMode()
}

function mediaIcon(resource: CourseResource): string {
  return { image: '🖼️', audio: '🎵', video: '🎬', document: '📄' }[resource.mediaType]
}

function formatDuration(seconds?: number | null): string {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function formatUploadTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN').format(date)
}
</script>

<template>
  <section class="resource-panel" aria-label="课程资源">
    <header class="resource-header">
      <div>
        <p class="eyebrow">幼儿园课程素材库</p>
        <h1>课程资源</h1>
        <p>统一管理图片、音频、视频、PDF 和 PPT 教学素材。</p>
      </div>
      <div class="header-actions">
        <ElButton size="large" :disabled="!filteredResources.length" @click="enterClassroomMode">
          课堂模式
        </ElButton>
        <ElButton type="primary" size="large" @click="openFilePicker">上传资源</ElButton>
        <input
          ref="fileInputRef" class="file-input" type="file"
          accept="image/jpeg,image/png,audio/mpeg,audio/wav,video/mp4,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.jpg,.jpeg,.png,.mp3,.wav,.mp4,.pdf,.ppt,.pptx"
          @change="handleFileChange"
        />
      </div>
    </header>

    <div v-if="resourceStore.hasLegacyResources" class="migration-banner">
      <div><strong>发现旧版本地素材</strong><span>共 {{ resourceStore.legacyResources.length }} 个，迁移失败不会删除本地数据。</span></div>
      <div class="migration-action">
        <ElProgress v-if="migrating" :percentage="migrationProgress" :stroke-width="12" />
        <ElButton :loading="migrating" @click="migrateLegacyResources">手动迁移</ElButton>
      </div>
    </div>

    <div class="resource-toolbar">
      <input v-model="keyword" type="search" placeholder="搜索标题、别名或标签" aria-label="搜索课程资源" />
      <select v-model="selectedType" aria-label="资源类型">
        <option value="">全部类型</option>
        <option v-for="type in RESOURCE_TYPES" :key="type" :value="type">{{ TYPE_LABELS[type] }}</option>
      </select>
      <select v-model="selectedAgeGroup" aria-label="年龄段">
        <option value="">全部年龄段</option>
        <option v-for="age in RESOURCE_AGE_GROUPS" :key="age" :value="age">{{ AGE_LABELS[age] }}</option>
      </select>
      <ElButton :loading="resourceStore.loading" @click="refresh">刷新</ElButton>
    </div>

    <nav class="category-tabs" aria-label="资源分类">
      <button type="button" :class="{ active: !selectedCategory }" @click="selectedCategory = ''">全部</button>
      <button
        v-for="category in COURSE_RESOURCE_CATEGORIES" :key="category" type="button"
        :class="{ active: selectedCategory === category }" @click="selectedCategory = category"
      >{{ category }}</button>
    </nav>

    <div class="resource-content">
      <p v-if="!userStore.isLogin" class="notice">登录教师账号后可查看、上传和管理后端课程资源。</p>
      <p v-if="resourceStore.loadError" class="load-error">{{ resourceStore.loadError }}</p>

      <div v-if="filteredResources.length" class="resource-grid">
        <article
          v-for="resource in filteredResources" :key="resource.id" class="resource-card" tabindex="0"
          @click="openResource(resource)" @keydown.enter.prevent="openResource(resource)"
        >
          <div class="thumbnail-wrap">
            <img
              v-if="resource.mediaType === 'image'" :src="resource.contentUrl || resource.dataUrl"
              :alt="resource.title"
            />
            <video v-else-if="resource.mediaType === 'video' && resource.coverUrl" :poster="resource.coverUrl"></video>
            <div v-else class="media-placeholder" aria-hidden="true">
              <span>{{ mediaIcon(resource) }}</span>
              <small>{{ TYPE_LABELS[resource.mediaType] }}</small>
            </div>
            <span v-if="resource.source === 'browser'" class="legacy-badge">本地旧素材</span>
          </div>
          <div class="card-body">
            <strong :title="resource.fileName">{{ resource.title }}</strong>
            <div class="card-subtitle">
              <span>{{ AGE_LABELS[resource.ageGroup] }}</span>
              <span v-if="resource.duration">{{ formatDuration(resource.duration) }}</span>
              <time v-else :datetime="resource.uploadedAt">{{ formatUploadTime(resource.uploadedAt) }}</time>
            </div>
            <div v-if="resource.tags.length" class="tag-list">
              <span v-for="tag in resource.tags.slice(0, 2)" :key="tag">{{ tag }}</span>
            </div>
            <div class="card-actions">
              <button type="button" @click.stop="copyResource(resource)">引用</button>
              <button v-if="resource.source === 'library'" type="button" @click.stop="openEdit(resource)">编辑</button>
              <button class="danger" type="button" @click.stop="deleteResource(resource)">删除</button>
            </div>
          </div>
        </article>
      </div>
      <div v-else-if="!resourceStore.loading" class="resource-empty">
        <div aria-hidden="true">🗂️</div><h2>暂时没有匹配的资源</h2><p>可调整筛选条件或上传新素材。</p>
      </div>
    </div>

    <ElDialog v-model="uploadVisible" width="min(620px, 92vw)" title="上传课程资源" destroy-on-close>
      <div class="resource-form">
        <p class="selected-file">已选择：{{ selectedFile?.name }}</p>
        <label>标题<input v-model="form.title" maxlength="200" /></label>
        <label>别名<input :value="form.aliases.join('，')" placeholder="用逗号分隔" @input="form.aliases = splitValues(($event.target as HTMLInputElement).value)" /></label>
        <label>分类<select v-model="form.category"><option v-for="item in COURSE_RESOURCE_CATEGORIES" :key="item">{{ item }}</option></select></label>
        <label>年龄段<select v-model="form.ageGroup"><option v-for="age in RESOURCE_AGE_GROUPS" :key="age" :value="age">{{ AGE_LABELS[age] }}</option></select></label>
        <label>标签<input :value="form.tags.join('，')" placeholder="用逗号分隔" @input="form.tags = splitValues(($event.target as HTMLInputElement).value)" /></label>
        <label>说明<textarea v-model="form.description" maxlength="2000" rows="3"></textarea></label>
        <ElProgress v-if="uploading" :percentage="uploadProgress" />
      </div>
      <template #footer><ElButton @click="uploadVisible = false">取消</ElButton><ElButton type="primary" :loading="uploading" @click="submitUpload">确认上传</ElButton></template>
    </ElDialog>

    <ElDialog v-model="editVisible" width="min(620px, 92vw)" title="编辑资源信息">
      <div class="resource-form">
        <label>标题<input v-model="form.title" maxlength="200" /></label>
        <label>别名<input :value="form.aliases.join('，')" @input="form.aliases = splitValues(($event.target as HTMLInputElement).value)" /></label>
        <label>分类<select v-model="form.category"><option v-for="item in COURSE_RESOURCE_CATEGORIES" :key="item">{{ item }}</option></select></label>
        <label>年龄段<select v-model="form.ageGroup"><option v-for="age in RESOURCE_AGE_GROUPS" :key="age" :value="age">{{ AGE_LABELS[age] }}</option></select></label>
        <label>标签<input :value="form.tags.join('，')" @input="form.tags = splitValues(($event.target as HTMLInputElement).value)" /></label>
        <label>说明<textarea v-model="form.description" maxlength="2000" rows="3"></textarea></label>
      </div>
      <template #footer><ElButton @click="editVisible = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="submitEdit">保存修改</ElButton></template>
    </ElDialog>

    <ResourcePlayer ref="resourcePlayerRef" :resources="filteredResources" />
  </section>
</template>

<style scoped>
.resource-panel { position: relative; min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fffdfa; color: #4e4139; }
.resource-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 22px 28px; border-bottom: 1px solid #f2e4d7; background: #fff9ee; }
.resource-header p, .resource-header h1 { margin: 0; }
.resource-header h1 { margin: 4px 0; font-size: 26px; }
.resource-header p { color: #8c7566; }
.resource-header .eyebrow { color: #be8065; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
.file-input { display: none; }
.migration-banner { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 14px 28px 0; padding: 14px 16px; border: 1px solid #efc68b; border-radius: 14px; background: #fff6df; }
.migration-banner div:first-child { display: grid; gap: 4px; }
.migration-banner span { color: #8a7059; font-size: 13px; }
.migration-action { min-width: 200px; display: flex; align-items: center; gap: 12px; }
.migration-action :deep(.el-progress) { flex: 1; }
.resource-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 150px auto; gap: 10px; padding: 16px 28px 8px; }
.resource-toolbar input, .resource-toolbar select, .resource-form input, .resource-form select, .resource-form textarea { width: 100%; box-sizing: border-box; border: 1px solid #e4cfbf; border-radius: 10px; background: #fff; color: inherit; font: inherit; }
.resource-toolbar input, .resource-toolbar select, .resource-form input, .resource-form select { height: 42px; padding: 0 12px; }
.category-tabs { display: flex; gap: 8px; padding: 8px 28px 14px; overflow-x: auto; border-bottom: 1px solid #f3e8dd; }
.category-tabs button { padding: 9px 14px; border: 1px solid #ead9cb; border-radius: 999px; background: #fff; color: #806858; cursor: pointer; font: inherit; font-weight: 700; white-space: nowrap; }
.category-tabs button.active { border-color: #e9aa86; background: #ffe6d6; color: #8f4f3d; }
.resource-content { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 28px 30px; }
.notice, .load-error { margin: 0 0 14px; padding: 11px 14px; border-radius: 10px; font-size: 14px; }
.notice { background: #fff5dc; color: #856841; }
.load-error { background: #fff0f0; color: #b95050; }
.resource-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 18px; }
.resource-card { overflow: hidden; border: 1px solid #f0dfd0; border-radius: 16px; background: #fff; cursor: pointer; box-shadow: 0 5px 16px rgb(113 72 42 / 6%); transition: .18s ease; }
.resource-card:hover, .resource-card:focus-visible { outline: none; transform: translateY(-3px); box-shadow: 0 12px 28px rgb(113 72 42 / 15%); }
.thumbnail-wrap { position: relative; height: 140px; overflow: hidden; background: linear-gradient(145deg, #fff3d8, #ffe6d6); }
.thumbnail-wrap img, .thumbnail-wrap video { width: 100%; height: 100%; display: block; object-fit: cover; }
.media-placeholder { height: 100%; display: grid; place-items: center; align-content: center; gap: 7px; color: #8f6753; }
.media-placeholder span { font-size: 44px; }
.legacy-badge { position: absolute; top: 9px; left: 9px; padding: 4px 7px; border-radius: 7px; background: #705647d9; color: #fff; font-size: 11px; }
.card-body { display: grid; gap: 9px; padding: 14px; }
.card-body > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.card-subtitle, .card-actions, .tag-list { display: flex; align-items: center; gap: 7px; }
.card-subtitle { justify-content: space-between; color: #9a8373; font-size: 12px; }
.tag-list span { padding: 3px 7px; border-radius: 999px; background: #f1edff; color: #736194; font-size: 11px; }
.card-actions { margin-top: 2px; }
.card-actions button { flex: 1; padding: 7px 5px; border: 0; border-radius: 8px; background: #edf6e9; color: #4f794a; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.card-actions button.danger { background: #fff0ee; color: #a6534b; }
.resource-empty { min-height: 300px; display: grid; place-items: center; align-content: center; text-align: center; color: #917b6b; }
.resource-empty div { font-size: 46px; }.resource-empty h2, .resource-empty p { margin: 6px; }
.resource-form { display: grid; gap: 14px; }
.resource-form label { display: grid; gap: 7px; font-weight: 700; }
.resource-form textarea { padding: 10px 12px; resize: vertical; }
.selected-file { margin: 0; padding: 10px 12px; border-radius: 9px; background: #f7f3ee; color: #765f51; }
@media (max-width: 820px) {
  .resource-header, .migration-banner { align-items: flex-start; flex-direction: column; }
  .resource-toolbar { grid-template-columns: 1fr 1fr; }
  .resource-toolbar input { grid-column: 1 / -1; }
  .migration-action { width: 100%; }
  .resource-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
</style>
