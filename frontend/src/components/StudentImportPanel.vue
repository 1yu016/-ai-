<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import { platformApi, type StudentImportPreview, type StudentImportResult } from '@/api/platform'

const props = defineProps<{ classId: number; className?: string }>()
const emit = defineEmits<{ imported: [result: StudentImportResult]; cancel: [] }>()

const MAX_BYTES = 2 * 1024 * 1024
const input = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const preview = ref<StudentImportPreview | null>(null)
const result = ref<StudentImportResult | null>(null)
const busy = ref(false)
const error = ref('')
const canConfirm = computed(() => Boolean(preview.value?.summary.valid) && !busy.value && !result.value)

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadTemplate() {
  busy.value = true
  error.value = ''
  try {
    const { data } = await platformApi.studentImportTemplate(props.classId)
    saveBlob(data, `学生导入模板-${props.className || props.classId}.xlsx`)
  } catch (cause) {
    error.value = apiErrorMessage(cause, '模板下载失败，请重试。')
  } finally {
    busy.value = false
  }
}

function chooseFile(event: Event) {
  const next = (event.target as HTMLInputElement).files?.[0] ?? null
  preview.value = null
  result.value = null
  error.value = ''
  if (!next) return
  if (!next.name.toLowerCase().endsWith('.xlsx')) {
    error.value = '仅支持 .xlsx 格式，请使用系统模板。'
    selectedFile.value = null
    return
  }
  if (next.size > MAX_BYTES) {
    error.value = '导入文件不能超过 2MB。'
    selectedFile.value = null
    return
  }
  selectedFile.value = next
}

async function uploadPreview() {
  if (!selectedFile.value) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await platformApi.previewStudentImport(props.classId, selectedFile.value)
    preview.value = data
    result.value = null
  } catch (cause) {
    error.value = apiErrorMessage(cause, '文件解析失败，请检查模板内容后重试。')
  } finally {
    busy.value = false
  }
}

async function downloadErrors() {
  if (!preview.value) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await platformApi.studentImportErrors(props.classId, preview.value.sessionId)
    saveBlob(data, `学生导入失败结果-${props.className || props.classId}.csv`)
  } catch (cause) {
    error.value = apiErrorMessage(cause, '失败结果下载失败，请重试。')
  } finally {
    busy.value = false
  }
}

async function confirmImport() {
  if (!preview.value || !canConfirm.value) return
  busy.value = true
  error.value = ''
  try {
    const requestId = crypto.randomUUID()
    const response = await platformApi.confirmStudentImport(props.classId, preview.value.sessionId, requestId)
    result.value = response.data
    ElMessage.success(`成功导入 ${response.data.created} 名学生`)
    emit('imported', response.data)
  } catch (cause) {
    error.value = apiErrorMessage(cause, '确认导入失败，未写入学生数据。')
  } finally {
    busy.value = false
  }
}

function cancel() {
  selectedFile.value = null
  preview.value = null
  result.value = null
  error.value = ''
  if (input.value) input.value.value = ''
  emit('cancel')
}
</script>

<template>
  <section class="import-panel" aria-label="学生表格导入">
    <header>
      <div><strong>学生表格导入</strong><p>先下载模板，上传后仅生成预览；点击确认才会写入学生数据。</p></div>
      <button class="plain" :disabled="busy" @click="cancel">关闭</button>
    </header>

    <ol class="steps"><li>下载模板</li><li>选择文件</li><li>上传并预览</li><li>确认导入</li></ol>
    <div class="actions">
      <button class="plain" :disabled="busy" @click="downloadTemplate">下载 Excel 模板</button>
      <label class="file-button">选择文件<input ref="input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="chooseFile"></label>
      <span class="file-name">{{ selectedFile?.name || '尚未选择文件' }}</span>
      <button class="primary" :disabled="busy || !selectedFile" @click="uploadPreview">{{ busy ? '处理中…' : '上传并解析' }}</button>
    </div>
    <p class="hint">仅支持 XLSX，最大 2MB，一次最多 500 行。学号和姓名为必填列。</p>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="preview">
      <div class="summary">
        <span>总计 {{ preview.summary.total }}</span><span class="success">可导入 {{ preview.summary.valid }}</span><span class="danger">失败 {{ preview.summary.invalid }}</span>
      </div>

      <section v-if="preview.validRows.length" class="result-block">
        <h3>可导入行</h3>
        <div class="table-wrap"><table><thead><tr><th>行号</th><th>学号</th><th>姓名</th><th>昵称</th><th>状态</th></tr></thead><tbody>
          <tr v-for="row in preview.validRows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td>{{ row.studentNo }}</td><td>{{ row.name }}</td><td>{{ row.nickname || '—' }}</td><td>{{ row.status === 'active' ? '在读' : '停用' }}</td></tr>
        </tbody></table></div>
      </section>

      <section v-if="preview.invalidRows.length" class="result-block invalid">
        <div class="result-title"><h3>失败行</h3><button class="plain" :disabled="busy" @click="downloadErrors">下载失败结果</button></div>
        <div class="table-wrap"><table><thead><tr><th>行号</th><th>学号</th><th>姓名</th><th>原因</th></tr></thead><tbody>
          <tr v-for="row in preview.invalidRows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td>{{ row.studentNo || '—' }}</td><td>{{ row.name || '—' }}</td><td class="error">{{ row.errors.join('；') }}</td></tr>
        </tbody></table></div>
      </section>

      <footer>
        <span v-if="result" class="success">已写入 {{ result.created }} 名学生，学生列表已刷新。</span>
        <span v-else>失败行不会写入；确认后只导入上方有效数据。</span>
        <button class="primary" :disabled="!canConfirm" @click="confirmImport">{{ busy ? '正在确认…' : '确认导入' }}</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.import-panel{display:grid;gap:16px;margin-bottom:18px;padding:20px;border:1px solid #edcfbb;border-radius:18px;background:#fffdf9;box-shadow:0 10px 28px #9b663015;color:#60483e}.import-panel header,.result-title,.import-panel footer{display:flex;align-items:center;justify-content:space-between;gap:16px}.import-panel header p,.hint{margin:5px 0 0;color:#987d6e}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0;padding:0;list-style:none;counter-reset:step}.steps li{padding:10px;border-radius:10px;background:#fff3e8;text-align:center}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.primary,.plain,.file-button{min-height:40px;padding:9px 15px;border-radius:11px;font:inherit;cursor:pointer}.primary{border:0;background:#eb956b;color:#fff;font-weight:700}.plain,.file-button{border:1px solid #efd9c8;background:#fff;color:#825f4d}.primary:disabled,.plain:disabled{opacity:.55;cursor:not-allowed}.file-button input{display:none}.file-name{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8d7568}.summary{display:flex;gap:12px;flex-wrap:wrap}.summary span{padding:7px 12px;border-radius:999px;background:#f5eee8}.success{color:#34815a}.danger,.error{color:#bf4f4f}.result-block{display:grid;gap:8px}.result-block h3{margin:0}.table-wrap{max-height:260px;overflow:auto;border:1px solid #f0ded1;border-radius:12px}table{width:100%;border-collapse:collapse;min-width:600px}th,td{padding:10px 12px;border-bottom:1px solid #f3e6dd;text-align:left}th{position:sticky;top:0;background:#fff8f1;color:#8f7465}.invalid .table-wrap{border-color:#f0caca}.import-panel footer{padding-top:14px;border-top:1px solid #f1e0d4}@media(max-width:700px){.steps{grid-template-columns:1fr 1fr}.import-panel header,.import-panel footer{align-items:flex-start;flex-direction:column}}
</style>
