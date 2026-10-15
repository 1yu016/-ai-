<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import type { Student } from '@/api/platform'
import {
  createClassroomQuestion,
  listRunQuestions,
  updateClassroomQuestion,
  type ClassroomQuestion,
} from '@/services/classroomQuestions'

const props = defineProps<{
  runId: number
  lessonStepIndex: number | null
  students: Student[]
}>()

type PanelState =
  | 'loading' // 拉取本节问题中
  | 'ready' // 问题列表可用（含 0 条）
  | 'error' // 拉取失败（网络/权限等）

const state = ref<PanelState>('loading')
const errorText = ref('')

const questionDraft = ref('')
const selectedStudentId = ref<number | null>(null)
const topicDraft = ref('生活观察')
const domainDraft = ref('科学')
const correctionDraft = ref('')
const anonymousDraft = ref(false)
const submitting = ref(false)
const subState = ref<'idle' | 'submitting' | 'error'>('idle')
const subError = ref('')
const editingId = ref<number | null>(null)
const editingText = ref('')
const updating = ref(false)

const questions = ref<ClassroomQuestion[]>([])

const TOPICS = ['生活观察', '科学探索', '语言表达', '艺术创作']
const DOMAINS = ['科学', '语言', '艺术', '健康', '社会', '综合']

function studentName(id: number | null): string {
  if (id == null) return ''
  return props.students.find((s) => s.id === id)?.name ?? ''
}

async function load() {
  state.value = 'loading'
  errorText.value = ''
  try {
    questions.value = await listRunQuestions(props.runId)
    state.value = 'ready'
  } catch (e) {
    state.value = 'error'
    errorText.value = apiErrorMessage(e, '本节问题加载失败。')
  }
}

async function record() {
  const text = questionDraft.value.trim()
  if (!text) {
    ElMessage.warning('请输入要记录的问题。')
    return
  }
  if (state.value !== 'ready') {
    ElMessage.warning('当前问题记录不可用，请先确认后端已就绪。')
    return
  }
  subState.value = 'submitting'
  subError.value = ''
  try {
    // 后端成功后才写入正式列表；失败不加入列表、保留输入、可重试。
    const created = await createClassroomQuestion(props.runId, {
      studentId: selectedStudentId.value,
      lessonStepIndex: props.lessonStepIndex,
      asrRawText: text,
      questionText: text,
      teacherCorrectedText: correctionDraft.value.trim() || null,
      topic: topicDraft.value,
      domain: domainDraft.value,
      isAnonymous: anonymousDraft.value,
    })
    questions.value = [...questions.value, created]
    questionDraft.value = ''
    correctionDraft.value = ''
    subState.value = 'idle'
  } catch (e) {
    subState.value = 'error'
    subError.value = apiErrorMessage(e, '问题保存失败，请重试。')
    // 保留 questionDraft 供重试。
  }
}

function beginCorrection(question: ClassroomQuestion) {
  editingId.value = question.id
  editingText.value = question.questionText
}

async function saveCorrection(question: ClassroomQuestion) {
  const text = editingText.value.trim()
  if (!text) return ElMessage.warning('教师修正文本不能为空。')
  updating.value = true
  try {
    const updated = await updateClassroomQuestion(props.runId, question.id, {
      teacherCorrectedText: text,
    })
    questions.value = questions.value.map((item) => item.id === updated.id ? updated : item)
    editingId.value = null
    ElMessage.success('教师修正已保存。')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '教师修正保存失败。'))
  } finally {
    updating.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <div>
        <h2>幼儿问题记录</h2>
        <p class="muted">记录问题并按主题聚合；问题写入正式课堂记录。</p>
      </div>
      <span class="pill">{{ questions.length }} 条问题</span>
    </div>

    <p v-if="state === 'loading'">加载中…</p>
    <p v-else-if="state === 'error'" class="bad">
      {{ errorText }}
      <button class="ghost" @click="load">重试</button>
    </p>

    <template v-else-if="state === 'ready'">
      <div class="question-form">
        <select v-model.number="selectedStudentId">
          <option :value="null">不指定幼儿</option>
          <option v-for="student in students" :key="student.id" :value="student.id">
            {{ student.nickname || student.name }}
          </option>
        </select>
        <input
          v-model="questionDraft"
          placeholder="ASR原始文字或教师记录的问题…"
          :disabled="submitting"
        >
        <input
          v-model="correctionDraft"
          placeholder="教师修正文字（可选）"
          :disabled="submitting"
        >
        <select v-model="topicDraft">
          <option v-for="topic in TOPICS" :key="topic" :value="topic">
            {{ topic }}
          </option>
        </select>
        <select v-model="domainDraft">
          <option v-for="domain in DOMAINS" :key="domain" :value="domain">
            {{ domain }}
          </option>
        </select>
        <label class="anonymous-check">
          <input v-model="anonymousDraft" type="checkbox">
          匿名记录
        </label>
        <button class="button" :disabled="submitting" @click="record">
          {{ submitting ? '保存中…' : '记录问题' }}
        </button>
      </div>
      <p v-if="subState === 'error'" class="bad">{{ subError }}</p>

      <div class="question-list">
        <article v-for="question in questions" :key="question.id">
          <span class="topic">{{ question.topic || '未分类' }} · {{ question.domain || '未分领域' }}</span>
          <div>
            <template v-if="editingId === question.id">
              <input v-model="editingText" class="correction-input" maxlength="1000">
              <div class="edit-actions">
                <button class="mini" :disabled="updating" @click="saveCorrection(question)">保存修正</button>
                <button class="mini ghost" @click="editingId = null">取消</button>
              </div>
            </template>
            <strong v-else>{{ question.questionText }}</strong>
            <small>
              {{
                `${question.isAnonymous ? '匿名幼儿' : studentName(question.studentId) || '非指定幼儿'} · ${new Date(
                  question.createdAt,
                ).toLocaleString('zh-CN')} · ${question.teacherName ?? '教师'}`
              }}
            </small>
            <small v-if="question.teacherCorrectedText">原始识别：{{ question.asrRawText }}</small>
            <button v-if="editingId !== question.id" class="mini" @click="beginCorrection(question)">修正文字</button>
          </div>
        </article>
        <p v-if="!questions.length" class="empty">
          还没有正式问题记录，课堂中遇到好问题就记下来吧。
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #f0ddce;
  border-radius: 18px;
  background: #fffdf9;
  padding: 20px;
  box-shadow: 0 10px 28px #b9795114;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.section-head h2,
.panel h2 {
  margin: 0 0 6px;
  color: #60483e;
}
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.pill {
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff0e4;
  color: #a9654c;
  font-size: 13px;
  white-space: nowrap;
}
.question-form {
  display: grid;
  grid-template-columns: 140px minmax(180px, 1fr) minmax(180px, 1fr) 120px 100px 100px auto;
  gap: 8px;
  margin-bottom: 8px;
}
.question-form input,
.question-form select {
  height: 40px;
  border: 1px solid #efd9c8;
  border-radius: 10px;
  padding: 0 11px;
  background: #fff;
  color: #60483e;
}
.anonymous-check { display: flex; align-items: center; gap: 6px; color: #6b584c; white-space: nowrap; }
.anonymous-check input { width: 16px; height: 16px; }
.button {
  border: 0;
  border-radius: 11px;
  padding: 0 16px;
  cursor: pointer;
  background: #e99168;
  color: #fff;
}
.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ghost {
  border: 1px solid #efd9c8;
  background: #fffdf9;
  color: #876b5d;
  border-radius: 10px;
  padding: 4px 10px;
  margin-left: 8px;
  cursor: pointer;
}
.bad {
  color: #c64e4e;
}
.question-list {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.question-list article {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #f0ddce;
  border-radius: 12px;
}
.question-list .topic {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: #fff0e4;
  color: #a9654c;
  font-size: 12px;
  height: fit-content;
}
.question-list div {
  display: grid;
  gap: 4px;
}
.question-list strong {
  color: #60483e;
}
.question-list small {
  color: #9a7e6e;
}
.correction-input { min-width: 280px; height: 36px; border: 1px solid #efd9c8; border-radius: 9px; padding: 0 10px; }
.edit-actions { display: flex !important; grid-auto-flow: column; justify-content: flex-start; gap: 8px !important; }
.mini { width: fit-content; border: 0; border-radius: 8px; padding: 5px 10px; background: #e99168; color: #fff; cursor: pointer; }
.mini.ghost { border: 1px solid #efd9c8; background: #fff; color: #876b5d; }
.empty {
  color: #9a7e6e;
  padding: 20px;
  text-align: center;
}
@media (max-width: 800px) {
  .question-form {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
