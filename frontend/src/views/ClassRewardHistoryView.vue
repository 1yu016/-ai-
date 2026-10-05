<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import {
  platformApi,
  type ClassRewardPage,
  type RewardRecord,
  type Student,
} from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)

const loading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = 10
const studentId = ref<number | null>(null)
const students = ref<Student[]>([])
const data = ref<ClassRewardPage | null>(null)

const items = ref<RewardRecord[]>([])
const total = ref(0)
const totalStars = ref(0)
const className = ref(`班级 ${classId}`)

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
    const [rewardResult, studentResult] = await Promise.all([
      platformApi.classRewards(classId, {
        page: page.value,
        pageSize,
        studentId: studentId.value ?? undefined,
      }),
      platformApi.students(classId),
    ])
    data.value = rewardResult.data
    items.value = rewardResult.data.items
    total.value = rewardResult.data.total
    totalStars.value = rewardResult.data.summary?.totalStars ?? 0
    className.value = rewardResult.data.summary?.className ?? className.value
    students.value = studentResult.data.items
  } catch (e) {
    error.value = apiErrorMessage(e, '成长奖励加载失败，请检查班级权限。')
  } finally {
    loading.value = false
  }
}

function applyFilter() {
  page.value = 1
  void load()
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">🌟 成长奖励</p>
          <h1>{{ className }} · 成长奖励</h1>
          <p class="muted">班级全部历史奖励明细，按时间倒序逐条展示。</p>
        </div>
        <div class="toolbar">
          <select v-model.number="studentId" @change="applyFilter">
            <option :value="null">全部幼儿</option>
            <option v-for="student in students" :key="student.id" :value="student.id">
              {{ student.nickname || student.name }}
            </option>
          </select>
          <button class="button" @click="applyFilter">刷新</button>
          <button class="ghost" @click="router.push({ name: 'students', params: { classId } })">
            返回学生列表
          </button>
        </div>
      </header>

      <div class="summary panel">
        <strong>累计奖励</strong>
        <span class="summary-stars">🌟 {{ totalStars }}</span>
      </div>

      <div class="panel">
        <p v-if="loading">加载中…</p>
        <p v-else-if="error" class="bad">{{ error }}</p>
        <p v-else-if="!items.length" class="muted empty">
          还没有正式奖励记录。新奖励将从当前版本开始逐条记录；
          更早课堂的累计小红花未包含逐条明细。
        </p>
        <ul v-else class="reward-list">
          <li v-for="record in items" :key="record.id" class="reward-item">
            <span class="reward-date">{{ formatDate(record.createdAt) }}</span>
            <div class="reward-body">
              <strong class="reward-student">
                🧒 {{ record.studentName ?? `幼儿 ${record.studentId}` }}
              </strong>
              <span class="reward-stars">🌟 +{{ record.stars }}</span>
            </div>
            <p class="reward-reason">{{ record.reason || '（未填原因）' }}</p>
            <div class="reward-meta">
              <small v-if="record.lessonTitle">课程：{{ record.lessonTitle }}</small>
              <small v-if="record.teacherName">教师：{{ record.teacherName }}</small>
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
    </div>
  </ManagementLayout>
</template>

<style scoped>
.page { max-width: 1180px; margin: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }
.eyebrow { margin: 0 0 6px; color: #d67b59; font-weight: 800; letter-spacing: 0.08em; }
.page-head h1 { margin: 0 0 8px; color: #60483e; font-size: 36px; }
.muted { color: #9a7e6e; }
.toolbar { display: flex; gap: 10px; }
.toolbar select { height: 42px; border: 1px solid #efd9c8; border-radius: 12px; padding: 0 12px; background: #fffdf9; color: #60483e; }
.button, .ghost { border: 0; border-radius: 12px; padding: 0 18px; min-height: 42px; cursor: pointer; }
.button { background: #e99168; color: #fff; }
.button:disabled, .ghost:disabled { opacity: 0.55; cursor: not-allowed; }
.ghost { border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; }
.panel { margin-top: 20px; padding: 20px; border: 1px solid #f0ddce; border-radius: 18px; background: #fffdf9; box-shadow: 0 10px 28px #b9795114; }
.summary { display: flex; align-items: center; gap: 14px; }
.summary strong { color: #876b5d; }
.summary-stars { font-size: 24px; font-weight: 800; color: #c07a3e; }
.empty { padding: 28px; text-align: center; }
.bad { color: #c64e4e; }
.reward-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.reward-item {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 4px 16px;
  padding: 16px 18px;
  border: 1px solid #f0ddce;
  border-radius: 14px;
  background: #fffdf9;
}
.reward-date { color: #9a7e6e; font-size: 13px; font-variant-numeric: tabular-nums; }
.reward-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reward-student { color: #60483e; font-size: 16px; }
.reward-stars { color: #c07a3e; font-weight: 800; white-space: nowrap; }
.reward-reason { grid-column: 2; margin: 0; color: #6b584c; }
.reward-meta { grid-column: 2; display: flex; gap: 18px; }
.reward-meta small { color: #9a7e6e; }
.pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 18px; color: #9a7e6e; font-size: 13px; }
@media (max-width: 700px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .toolbar { flex-wrap: wrap; }
  .reward-item { grid-template-columns: 1fr; }
  .reward-reason, .reward-meta { grid-column: 1; }
}
</style>
