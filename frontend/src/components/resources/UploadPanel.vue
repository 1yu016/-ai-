<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

// 普通上传面板：对齐 UploadResourceDto，走 multipart FormData 单文件上传。
// 大文件（> 200MB）提示改用分片上传。

const emit = defineEmits<{ (e: 'done', resource: ResourceResponse): void }>()

const MAX_ORDINARY_SIZE = 200 * 1024 * 1024 // 200MB

type UploadStatus =
  | 'wait'
  | 'uploading'
  | 'success'
  | 'failed'
  | 'type-error'
  | 'size-limit'

const categories = ref<string[]>([])
const fileName = ref('')
const file = ref<File | null>(null)
const status = ref<UploadStatus>('wait')
const progress = ref(0)
const error = ref('')
const fileInput = ref<HTMLInputElement>()

const form = ref({
  title: '',
  category: '',
  categoryId: undefined as number | undefined,
  ageGroup: 'all' as ResourceAgeGroup,
  resourceType: 'image' as ResourceType,
  aliases: '',
  description: '',
  domain: '',
  tags: '',
  duration: '',
})

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

onMounted(async () => {
  try {
    const { data } = await resourceApi.categories()
    categories.value = data.map((c) => c.name)
  } catch {
    // 分类接口失败不阻塞上传，category 由用户手工填写
  }
})

function resetInput() {
  if (fileInput.value) fileInput.value.value = ''
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  if (!picked) {
    file.value = null
    fileName.value = ''
    status.value = 'wait'
    return
  }
  const guessed = guessResourceType(picked.name)
  file.value = picked
  fileName.value = picked.name
  if (guessed) form.value.resourceType = guessed
  if (guessed === null) {
    status.value = 'type-error'
  } else if (picked.size > MAX_ORDINARY_SIZE) {
    status.value = 'size-limit'
  } else {
    status.value = 'wait'
  }
}

async function submit() {
  error.value = ''
  if (!form.value.title.trim()) {
    ElMessage.warning('请填写资源标题')
    return
  }
  if (!form.value.category.trim()) {
    ElMessage.warning('请填写资源分类')
    return
  }
  if (!file.value) {
    ElMessage.warning('请选择文件')
    return
  }
  if (status.value === 'type-error') {
    error.value = '无法识别该文件的扩展名，请确认文件类型有效。'
    return
  }
  if (status.value === 'size-limit') {
    error.value = `文件超过 ${MAX_ORDINARY_SIZE / 1024 / 1024}MB，请使用下方「大文件分片上传」。`
    return
  }

  const fd = new FormData()
  fd.append('title', form.value.title.trim())
  fd.append('category', form.value.category.trim())
  if (form.value.categoryId != null) {
    fd.append('categoryId', String(form.value.categoryId))
  }
  fd.append('ageGroup', form.value.ageGroup)
  fd.append('resourceType', form.value.resourceType)
  const aliases = toArrayField(form.value.aliases)
  if (aliases.length) fd.append('aliases', aliases.join(','))
  if (form.value.description.trim()) fd.append('description', form.value.description.trim())
  if (form.value.domain.trim()) fd.append('domain', form.value.domain.trim())
  const tags = toArrayField(form.value.tags)
  if (tags.length) fd.append('tags', tags.join(','))
  if (form.value.duration.trim()) fd.append('duration', String(Number(form.value.duration)))
  fd.append('file', file.value)

  status.value = 'uploading'
  progress.value = 0
  try {
    const { data } = await resourceApi.upload('file', fd, (loaded, total) => {
      progress.value = total > 0 ? Math.round((loaded / total) * 100) : 0
    })
    status.value = 'success'
    progress.value = 100
    ElMessage.success('上传成功')
    resetInput()
    emit('done', data)
  } catch (e) {
    status.value = 'failed'
    error.value = apiErrorMessage(e, '上传失败，请重试。')
    ElMessage.error(error.value)
  }
}
</script>

<template>
  <div class="upload-panel">
    <div class="field">
      <label class="req">标题</label>
      <input v-model="form.title" type="text" maxlength="120" placeholder="资源标题" />
    </div>

    <div class="field">
      <label class="req">分类</label>
      <input
        v-model="form.category"
        type="text"
        list="upload-category-options"
        placeholder="输入分类或从下拉选择"
      />
      <datalist id="upload-category-options">
        <option v-for="c in categories" :key="c" :value="c" />
      </datalist>
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

    <div class="field">
      <label>别名</label>
      <input v-model="form.aliases" type="text" placeholder="多个别名用逗号分隔" />
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
      <label>描述</label>
      <textarea v-model="form.description" rows="3" placeholder="资源描述" />
    </div>

    <div class="field">
      <label class="req">文件</label>
      <input ref="fileInput" type="file" @change="onFileChange" />
      <p v-if="fileName" class="file-name">已选择：{{ fileName }}</p>
    </div>

    <div class="progress-wrap">
      <template v-if="status === 'uploading' || status === 'success'">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progress + '%' }" />
        </div>
        <span class="progress-text">{{ progress }}%</span>
      </template>
    </div>

    <div v-if="status === 'type-error' || status === 'size-limit'" class="hint warn">
      {{ status === 'type-error' ? '无法识别该文件的扩展名类型。' : '文件过大，请使用「大文件分片上传」。' }}
    </div>
    <div v-else-if="status === 'failed'" class="hint bad">{{ error }}</div>

    <div class="actions">
      <button class="button primary" :disabled="status === 'uploading'" @click="submit">开始上传</button>
      <span class="muted">单文件最大 {{ MAX_ORDINARY_SIZE / 1024 / 1024 }}MB，超过请用分片上传</span>
    </div>
  </div>
</template>

<style scoped>
.upload-panel {
  display: grid;
  gap: 16px;
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
.button:disabled {
  opacity: 0.6;
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