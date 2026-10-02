<script setup lang="ts">
import type { Student } from '@/api/platform'
import type { Attendance } from '@/services/classroomCheckpoint'

defineProps<{
  students: Student[]
  attendance: Record<number, Attendance>
  selectedStudent: number | null
  rollMessage: string
}>()

defineEmits<{
  (e: 'set-attendance', student: Student, value: Attendance): void
  (e: 'random-roll'): void
  (e: 'award', student: Student): void
}>()
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <div>
        <h2>考勤确认</h2>
        <p class="muted">教师可手动确认，也可以随机点名。</p>
      </div>
      <button class="button" @click="$emit('random-roll')">随机点名</button>
    </div>
    <p v-if="rollMessage" class="celebrate">✨ {{ rollMessage }}</p>
    <div class="student-list">
      <article
        v-for="student in students"
        :key="student.id"
        class="student-row"
        :class="{ selected: selectedStudent === student.id }"
      >
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
            请假
          </button>
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
  grid-template-columns: 40px 1fr auto;
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
@media (max-width: 800px) {
  .student-row {
    grid-template-columns: 36px 1fr;
  }
  .row-actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
