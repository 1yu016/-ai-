<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type Student } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import {
  getQuestionMap,
  listClassQuestions,
  type ClassroomQuestion,
  type QuestionMap,
} from '@/services/classroomQuestions'

const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)

const loading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = 10
const studentId = ref<number | null>(null)
const keyword = ref('')
const topic = ref('')
const domain = ref('')
const students = ref<Student[]>([])
const total = ref(0)
const items = ref<ClassroomQuestion[]>([])
const questionMap = ref<QuestionMap | null>(null)

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [listResult, studentResult, mapResult] = await Promise.all([
      listClassQuestions(classId, {
        page: page.value,
        pageSize,
        studentId: studentId.value ?? undefined,
        keyword: keyword.value.trim() || undefined,
        topic: topic.value || undefined,
        domain: domain.value || undefined,
      }),
      platformApi.students(classId),
      getQuestionMap(classId, {
        studentId: studentId.value ?? undefined,
        topic: topic.value || undefined,
        domain: domain.value || undefined,
      }),
    ])
    items.value = listResult.items
    total.value = listResult.total
    students.value = studentResult.data.items
    questionMap.value = mapResult
  } catch (e) {
    questionMap.value = null
    error.value = apiErrorMessage(e, '班级问题记录加载失败。')
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
          <select v-model="topic" @change="applyFilter">
            <option value="">全部主题</option>
            <option v-for="item in questionMap?.topics ?? []" :key="item.name" :value="item.name">{{ item.name }}</option>
          </select>
          <select v-model="domain" @change="applyFilter">
            <option value="">全部领域</option>
            <option v-for="item in questionMap?.domains ?? []" :key="item.name" :value="item.name">{{ item.name }}</option>
          </select>
          <button class="button" @click="onSearch">筛选</button>
          <button class="button" @click="load">刷新</button>
          <button class="ghost" @click="router.push({ name: 'students', params: { classId } })">
            返回学生列表
          </button>
        </div>
      </header>

      <div class="panel">
        <p v-if="loading">加载中…</p>
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
        <div v-if="total > pageSize" class="pager">
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

      <section v-if="questionMap" class="map-panel">
        <header class="map-head">
          <div>
            <p class="eyebrow">兴趣洞察</p>
            <h2>问题地图</h2>
          </div>
          <p class="safety-note">{{ questionMap.safety.note }}</p>
        </header>
        <div class="summary-grid">
          <article><strong>{{ questionMap.summary.total }}</strong><span>问题总数</span></article>
          <article><strong>{{ questionMap.summary.identifiedStudentCount }}</strong><span>参与幼儿</span></article>
          <article><strong>{{ questionMap.summary.anonymousCount }}</strong><span>匿名记录</span></article>
        </div>
        <div class="map-grid">
          <section class="insight-card">
            <h3>主题热点</h3>
            <div class="cluster-list">
              <span v-for="item in questionMap.topics" :key="item.name">{{ item.name }} · {{ item.count }}</span>
            </div>
          </section>
          <section class="insight-card">
            <h3>领域分布</h3>
            <div class="cluster-list">
              <span v-for="item in questionMap.domains" :key="item.name">{{ item.name }} · {{ item.count }}</span>
            </div>
          </section>
          <section class="insight-card">
            <h3>常见问题</h3>
            <ol><li v-for="item in questionMap.frequentQuestions" :key="item.question">{{ item.question }}（{{ item.count }}）</li></ol>
          </section>
          <section class="insight-card">
            <h3>教学建议</h3>
            <small class="source-label">{{ questionMap.suggestionSource === 'ai' ? 'AI聚合建议' : '安全规则建议' }}</small>
            <ul><li v-for="item in questionMap.teachingSuggestions" :key="item">{{ item }}</li></ul>
          </section>
          <section class="insight-card">
            <h3>后续活动</h3>
            <ul><li v-for="item in questionMap.activitySuggestions" :key="item">{{ item }}</li></ul>
          </section>
          <section class="insight-card">
            <h3>推荐资源</h3>
            <ul v-if="questionMap.recommendedResources.length">
              <li v-for="item in questionMap.recommendedResources" :key="item.id">{{ item.title }} · {{ item.resourceType }}</li>
            </ul>
            <p v-else class="muted">当前没有匹配且有权访问的已审核资源。</p>
          </section>
        </div>
        <section v-if="questionMap.studentClusters.length" class="student-map">
          <h3>班级幼儿兴趣线索</h3>
          <p class="muted">仅供本班负责教师备课参考，不进行排名或能力评价。</p>
          <div class="student-grid">
            <article v-for="item in questionMap.studentClusters" :key="item.studentId">
              <strong>{{ item.studentName }}</strong>
              <span>{{ item.questionCount }} 个问题</span>
              <small>{{ item.topics.map((topicItem) => topicItem.name).join('、') || '尚未分类' }}</small>
            </article>
          </div>
        </section>
      </section>
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
.map-panel { margin-top: 20px; padding: 22px; border: 1px solid #eadbc9; border-radius: 18px; background: linear-gradient(135deg, #fffdf9, #f7fbf2); box-shadow: 0 10px 28px #6e8b5b12; }
.map-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.map-head h2 { margin: 0; color: #60483e; font-size: 28px; }
.safety-note { max-width: 520px; margin: 0; color: #718064; line-height: 1.6; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0; }
.summary-grid article { display: grid; gap: 4px; padding: 16px; border-radius: 14px; background: #fff; border: 1px solid #e4ecd9; text-align: center; }
.summary-grid strong { color: #d67b59; font-size: 30px; }
.summary-grid span { color: #718064; }
.map-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.insight-card { padding: 16px 18px; border: 1px solid #e8ded1; border-radius: 14px; background: #fff; }
.insight-card h3, .student-map h3 { margin: 0 0 10px; color: #60483e; }
.source-label { display: block; margin: -4px 0 8px; color: #9a7e6e; }
.insight-card ul, .insight-card ol { margin: 0; padding-left: 20px; color: #6b584c; line-height: 1.8; }
.cluster-list { display: flex; flex-wrap: wrap; gap: 8px; }
.cluster-list span { padding: 6px 10px; border-radius: 999px; background: #fff0e4; color: #a9654c; }
.student-map { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e8ded1; }
.student-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.student-grid article { display: grid; gap: 4px; padding: 12px; border-radius: 12px; background: #fff; border: 1px solid #e4ecd9; }
.student-grid strong { color: #60483e; }
.student-grid span, .student-grid small { color: #718064; }
@media (max-width: 700px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .question-item { grid-template-columns: 1fr; }
  .question-text, .question-meta { grid-column: 1; }
  .map-grid, .summary-grid, .student-grid { grid-template-columns: 1fr; }
}
</style>
