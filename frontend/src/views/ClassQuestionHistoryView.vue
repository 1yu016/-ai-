<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type Student } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import {
  listClassQuestions,
  type ClassroomQuestion,
} from '@/services/classroomQuestions'

const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)

const loading = ref(true)
const error = ref('')
const backendNotReady = ref(false)
const page = ref(1)
const pageSize = 10
const studentId = ref<number | null>(null)
const keyword = ref('')
const students = ref<Student[]>([])
const total = ref(0)
const items = ref<ClassroomQuestion[]>([])

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load() {
  loading.value = true
  error.value = ''
  backendNotReady.value = false
  try {
    const [listResult, studentResult] = await Promise.all([
      listClassQuestions(classId, {
        page: page.value,
        pageSize,
        studentId: studentId.value ?? undefined,
        keyword: keyword.value.trim() || undefined,
      }),
      platformApi.students(classId),
    ])
    items.value = listResult.items
    total.value = listResult.total
    students.value = studentResult.data.items
  } catch (e) {
    // 后端 questions 接口未部署 → 明确标记 backend-not-ready，不假装为空列表。
    backendNotReady.value = true
    error.value = apiErrorMessage(e, '班级问题记录接口尚未就绪。')
  } finally {
    loading.value = false
  }
}

function applyFilter() {
  page.value = 1
  void load()
}

function onSearch() {
  applyFilter()
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">🗺️ 幼儿问题</p>
          <h1>班级问题记录</h1>
          <p class="muted">班级内全部已记录的问题，按时间倒序展示。</p>
        </div>
        <div class="toolbar">
          <select v-model.number="studentId" @change="applyFilter">
            <option :value="null">全部幼儿</option>
            <option v-for="student in students" :key="student.id" :value="student.id">
              {{ student.nickname || student.name }}
            </option>
          </select>
          <input
            v-model="keyword"
            placeholder="搜索问题…"
            @keyup.enter="onSearch"
          >
          <button class="button" @click="onSearch">筛选</button>
          <button class="button" @click="load">刷新</button>
          <button class="ghost" @click="router.push({ name: 'students', params: { classId } })">
            返回学生列表
          </button>
        </div>
      </header>

      <div class="panel">
        <p v-if="loading">加载中…</p>
        <div v-else-if="backendNotReady" class="blocked">
          <span class="tag">后端未就绪</span>
          <p>{{ error }}</p>
          <p class="muted">
            班级问题历史接口尚未部署（FRONTEND_READY_BACKEND_BLOCKED）。接口就绪后此处自动变为可用。
          </p>
        </div>
        <p v-else-if="error" class="bad">{{ error }}</p>
        <p v-else-if="!items.length" class="muted empty">
          还没有正式问题记录。课堂中记录的问题会出现在这里。
        </p>
        <ul v-else class="question-list">
          <li v-for="question in items" :key="question.id" class="question-item">
            <span class="question-topic">{{ question.topic || '未分类' }}</span>
            <div class="question-body">
              <strong class="question-student">
                🧒 {{ question.studentName ?? (question.studentId != null ? `幼儿 ${question.studentId}` : '非指定幼儿') }}
              </strong>
              <span class="question-date">{{ formatDate(question.createdAt) }}</span>
            </div>
            <p class="question-text">{{ question.questionText }}</p>
            <div class="question-meta">
              <small v-if="question.lessonStepIndex != null">环节 {{ question.lessonStepIndex + 1 }}</small>
              <small v-if="question.teacherName">教师：{{ question.teacherName }}</small>
            </div>
          </li>
        </ul>
        <div v-if="!backendNotReady && total > pageSize" class="pager">
          <button class="ghost" :disabled="page <= 1" @click="page--; applyFilter()">上一页</button>
          <span>第 {{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页 · 共 {{ total }} 条</span>
          <button
            class="ghost"
            :disabled="page * pageSize >= total"
            @click="page++; applyFilter()"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.page { max-width: 1180px; margin: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }
.eyebrow { margin: 0 0 6px; color: #d67b59; font-weight: 800; letter-spacing: 0.08em; }
.page-head h1 { margin: 0 0 8px; color: #60483e; font-size: 36px; }
.muted { color: #9a7e6e; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; }
.toolbar select, .toolbar input {
  height: 42px;
  border: 1px solid #efd9c8;
  border-radius: 12px;
  padding: 0 12px;
  background: #fffdf9;
  color: #60483e;
}
.button, .ghost { border: 0; border-radius: 12px; padding: 0 18px; min-height: 42px; cursor: pointer; }
.button { background: #e99168; color: #fff; }
.button:disabled, .ghost:disabled { opacity: 0.55; cursor: not-allowed; }
.ghost { border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; }
.panel { margin-top: 20px; padding: 20px; border: 1px solid #f0ddce; border-radius: 18px; background: #fffdf9; box-shadow: 0 10px 28px #b9795114; }
.empty { padding: 28px; text-align: center; }
.bad { color: #c64e4e; }
.blocked { padding: 14px 16px; border: 1px dashed #d9a77e; border-radius: 12px; background: #fff6ec; color: #876b5d; }
.tag { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #f5d9bf; color: #a9654c; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.question-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.question-item {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 4px 16px;
  padding: 16px 18px;
  border: 1px solid #f0ddce;
  border-radius: 14px;
  background: #fffdf9;
}
.question-topic {
  color: #a9654c;
  font-size: 13px;
  font-weight: 700;
  padding-top: 3px;
}
.question-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.question-student { color: #60483e; font-size: 16px; }
.question-date { color: #9a7e6e; font-size: 13px; white-space: nowrap; }
.question-text { grid-column: 2; margin: 0; color: #6b584c; }
.question-meta { grid-column: 2; display: flex; gap: 18px; }
.question-meta small { color: #9a7e6e; }
.pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 18px; color: #9a7e6e; font-size: 13px; }
@media (max-width: 700px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .question-item { grid-template-columns: 1fr; }
  .question-text, .question-meta { grid-column: 1; }
}
</style>