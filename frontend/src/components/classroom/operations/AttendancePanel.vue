<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Student } from '@/api/platform'
import type { Attendance } from '@/services/classroomCheckpoint'

export type VoiceAttendanceCandidate = {
  studentId: number
  displayName: string
  status: Attendance | null
  confidence: number
}

const props = defineProps<{
  students: Student[]
  attendance: Record<number, Attendance>
  selectedStudent: number | null
  rollMessage: string
  voiceCandidates: VoiceAttendanceCandidate[]
  voiceTranscript: string
  voiceBusy: boolean
  voiceRecording: boolean
}>()

const emit = defineEmits<{
  (e: 'set-attendance', student: Student, value: Attendance): void
  (e: 'batch-attendance', updates: Array<{ studentId: number; status: Attendance }>): void
  (e: 'random-roll'): void
  (e: 'specified-roll', student: Student): void
  (e: 'group-roll', studentIds: number[]): void
  (e: 'start-voice'): void
  (e: 'stop-voice'): void
  (e: 'confirm-voice', updates: Array<{ studentId: number; status: Attendance }>): void
  (e: 'clear-voice'): void
  (e: 'award', student: Student): void
}>()

const selectedIds = ref<number[]>([])
const batchStatus = ref<Attendance>('present')
const candidateStatus = ref<Record<number, Attendance>>({})
const selectedSet = computed(() => new Set(selectedIds.value))

watch(
  () => props.voiceCandidates,
  (items) => {
    candidateStatus.value = Object.fromEntries(
      items.filter((item) => item.status).map((item) => [item.studentId, item.status]),
    ) as Record<number, Attendance>
  },
  { immediate: true },
)

function toggleStudent(id: number) {
  selectedIds.value = selectedSet.value.has(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id]
}

function applyBatch() {
  if (!selectedIds.value.length) return
  emit('batch-attendance', selectedIds.value.map((studentId) => ({ studentId, status: batchStatus.value })))
}

function confirmVoice() {
  const updates = props.voiceCandidates
    .map((candidate) => ({
      studentId: candidate.studentId,
      status: candidateStatus.value[candidate.studentId] ?? candidate.status,
    }))
    .filter((item): item is { studentId: number; status: Attendance } => item.status != null)
  if (updates.length) emit('confirm-voice', updates)
}
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <div>
        <h2>考勤确认</h2>
        <p class="muted">考勤正式保存，语音识别必须确认后才会写入。</p>
      </div>
      <div class="head-actions">
        <button class="button" @click="$emit('random-roll')">随机点名</button>
        <button class="soft" :disabled="!selectedIds.length" @click="$emit('group-roll', selectedIds)">分组随机</button>
      </div>
    </div>
    <div class="batch-bar">
      <strong>已选 {{ selectedIds.length }} 人</strong>
      <select v-model="batchStatus">
        <option value="present">到课</option><option value="absent">缺勤</option>
        <option value="late">迟到</option><option value="leave">请假</option>
      </select>
      <button class="soft" :disabled="!selectedIds.length" @click="applyBatch">批量保存</button>
      <button
        class="voice-button"
        :class="{ recording: voiceRecording }"
        :disabled="voiceBusy"
        @pointerdown.prevent="$emit('start-voice')"
        @pointerup.prevent="$emit('stop-voice')"
        @pointercancel.prevent="$emit('stop-voice')"
        @pointerleave="voiceRecording && $emit('stop-voice')"
      >{{ voiceBusy ? '识别中…' : voiceRecording ? '松开生成候选' : '🎙 按住说考勤' }}</button>
    </div>
    <section v-if="voiceTranscript || voiceCandidates.length" class="voice-review">
      <div><strong>语音识别候选</strong><small>“{{ voiceTranscript }}”</small></div>
      <p v-if="!voiceCandidates.length">没有匹配到班级幼儿，请重新录音或手动考勤。</p>
      <label v-for="candidate in voiceCandidates" :key="candidate.studentId">
        <span>{{ candidate.displayName }}</span>
        <select v-model="candidateStatus[candidate.studentId]">
          <option disabled value="">请选择状态</option>
          <option value="present">到课</option><option value="absent">缺勤</option>
          <option value="late">迟到</option><option value="leave">请假</option>
        </select>
      </label>
      <footer><button class="soft" @click="$emit('clear-voice')">取消</button><button class="button" :disabled="!voiceCandidates.length" @click="confirmVoice">确认写入正式考勤</button></footer>
    </section>
    <p v-if="rollMessage" class="celebrate">✨ {{ rollMessage }}</p>
    <div class="student-list">
      <article
        v-for="student in students"
        :key="student.id"
        class="student-row"
        :class="{ selected: selectedStudent === student.id }"
      >
        <input type="checkbox" :checked="selectedSet.has(student.id)" aria-label="选择幼儿" @change="toggleStudent(student.id)">
        <span class="avatar">🧒</span>
        <div>
          <strong>{{ student.nickname || student.name }}</strong>
          <small>{{ student.studentNo }}</small>
        </div>
        <div class="row-actions">
          <button
            :class="{ active: attendance[student.id] === 'present' }"
            @click="$emit('set-attendance', student, 'present')"
          >
            到课
          </button>
          <button
            :class="{ active: attendance[student.id] === 'late' }"
            @click="$emit('set-attendance', student, 'late')"
          >
            迟到
          </button>
          <button
            :class="{ active: attendance[student.id] === 'absent' }"
            @click="$emit('set-attendance', student, 'absent')"
          >
            缺勤
          </button>
          <button
            :class="{ active: attendance[student.id] === 'leave' }"
            @click="$emit('set-attendance', student, 'leave')"
          >
            请假
          </button>
          <button class="roll" @click="$emit('specified-roll', student)">点名</button>
          <button class="star" @click="$emit('award', student)">🌟</button>
        </div>
      </article>
    </div>
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
}
.section-head h2,
.panel h2 {
  margin: 0 0 6px;
}
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.button {
  border: 0;
  border-radius: 11px;
  padding: 10px 16px;
  cursor: pointer;
  background: #e99168;
  color: #fff;
}
.button:hover {
  background: #d67b59;
}
.head-actions,.batch-bar,.voice-review footer { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.soft,.voice-button { border:1px solid #efd9c8; border-radius:10px; padding:9px 12px; background:#fff; color:#876b5d; cursor:pointer; }
.soft:disabled,.voice-button:disabled { opacity:.45; cursor:not-allowed; }
.batch-bar { margin:14px 0; padding:12px; border-radius:12px; background:#fff8f0; }
.batch-bar select,.voice-review select { min-height:36px; border:1px solid #efd9c8; border-radius:8px; background:#fff; color:#60483e; padding:0 8px; }
.voice-button { margin-left:auto; background:#fff0e4; touch-action:none; }
.voice-button.recording { background:#fee2e2; border-color:#ef8888; color:#b84545; }
.voice-review { display:grid; gap:10px; margin:12px 0; padding:14px; border:1px solid #ebc59f; border-radius:12px; background:#fffdf4; }
.voice-review small { display:block; margin-top:4px; color:#9a7e6e; }
.voice-review label { display:flex; justify-content:space-between; align-items:center; gap:10px; }
.voice-review footer { justify-content:flex-end; }
.celebrate {
  padding: 12px;
  border-radius: 12px;
  background: #fff3c4;
  color: #926d22;
}
.student-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.student-row {
  display: grid;
  grid-template-columns: 20px 40px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px solid #f4e6dc;
  border-radius: 12px;
}
.student-row.selected {
  border-color: #e99168;
  background: #fff7f0;
}
.avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #fff0e4;
}
.student-row small {
  display: block;
  color: #a38270;
  margin-top: 3px;
}
.row-actions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.row-actions button {
  border: 1px solid #efd9c8;
  background: #fff;
  color: #a38270;
  border-radius: 8px;
  padding: 6px 9px;
  cursor: pointer;
}
.row-actions button.active {
  background: #e8f7ed;
  border-color: #b9e1c4;
  color: #4d9a69;
}
.row-actions .star {
  border: 0;
  background: #fff3c4;
  font-size: 16px;
}
.row-actions .roll { background:#eef6ff; border-color:#c5daf0; color:#527da7; }
@media (max-width: 800px) {
  .student-row {
    grid-template-columns: 20px 36px 1fr;
  }
  .row-actions {
    grid-column: 2 / -1;
    justify-content: flex-start;
  }
}
</style>
