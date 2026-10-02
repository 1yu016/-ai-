<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import type { Student } from '@/api/platform'
import {
  createClassroomQuestion,
  listRunQuestions,
  type ClassroomQuestion,
} from '@/services/classroomQuestions'

const props = defineProps<{
  runId: number
  lessonStepIndex: number | null
  students: Student[]
  /** 后端接口是否已可用；由父级决定（默认自动探测）。 */
  backendReady?: boolean
}>()

type PanelState =
  | 'loading' // 拉取本节问题中
  | 'ready' // 问题列表可用（含 0 条）
  | 'backend_not_ready' // 后端接口未就绪，明确展示阻塞
  | 'error' // 拉取失败（网络/权限等）

const state = ref<PanelState>('loading')
const errorText = ref('')

const questionDraft = ref('')
const selectedStudentId = ref<number | null>(null)
const topicDraft = ref('生活观察')
const submitting = ref(false)
const subState = ref<'idle' | 'submitting' | 'error'>('idle')
const subError = ref('')

const questions = ref<ClassroomQuestion[]>([])

const TOPICS = ['生活观察', '科学探索', '语言表达', '艺术创作']

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
    // 后端接口（student_question_record / POST+GET questions）尚未实现时，
    // 明确进入 backend_not_ready 阻塞态，绝不回落 localStorage 冒充正式数据。
    if (props.backendReady === false) {
      state.value = 'backend_not_ready'
      errorText.value = '问题记录后端接口尚未就绪，暂时无法保存本节问题。'
      return
    }
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
      questionText: text,
      topic: topicDraft.value,
    })
    questions.value = [created, ...questions.value]
    questionDraft.value = ''
    subState.value = 'idle'
  } catch (e) {
    subState.value = 'error'
    subError.value = apiErrorMessage(e, '问题保存失败，请重试。')
    // 保留 questionDraft 供重试。
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

    <!-- 后端未就绪：明确阻塞，不冒充 -->
    <div v-if="state === 'backend_not_ready'" class="blocked">
      <span class="tag">后端未就绪</span>
      <p>{{ errorText }}</p>
      <p class="muted">
        这是正式接口尚未部署（FRONTEND_READY_BACKEND_BLOCKED）。接口就绪后此处自动变为可用。
      </p>
    </div>

    <p v-else-if="state === 'loading'">加载中…</p>
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
          placeholder="记录幼儿刚才的问题…"
          :disabled="submitting"
        >
        <select v-model="topicDraft">
          <option v-for="topic in TOPICS" :key="topic" :value="topic">
            {{ topic }}
          </option>
        </select>
        <button class="button" :disabled="submitting" @click="record">
          {{ submitting ? '保存中…' : '记录问题' }}
        </button>
      </div>
      <p v-if="subState === 'error'" class="bad">{{ subError }}</p>

      <div class="question-list">
        <article v-for="question in questions" :key="question.id">
          <span class="topic">{{ question.topic || '未分类' }}</span>
          <div>
            <strong>{{ question.questionText }}</strong>
            <small>
              {{
                `${studentName(question.studentId) || '非指定幼儿'} · ${new Date(
                  question.createdAt,
                ).toLocaleString('zh-CN')} · ${question.teacherName ?? '教师'}`
              }}
            </small>
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
  grid-template-columns: 140px 1fr 120px auto;
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
.blocked {
  padding: 14px 16px;
  border: 1px dashed #d9a77e;
  border-radius: 12px;
  background: #fff6ec;
  color: #876b5d;
}
.tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f5d9bf;
  color: #a9654c;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
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