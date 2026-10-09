<script setup lang="ts">
import { ref } from 'vue'
import type { Student } from '@/api/platform'
import type { LessonRun } from '@/stores/lessonRun'
import type { RewardRecord } from '@/services/classroomCheckpoint'
import { useClassroomInteraction } from './useClassroomInteraction'

// 课堂互动普通面板：折叠态/展开态为面板自身 UI（collapsed 不入业务），
// 点名与快速奖励业务全部交由共享 useClassroomInteraction 处理，与全屏操作台同源。
const props = defineProps<{
  run: LessonRun | null
  /** 当前班学生（parent 按 run.classId 加载），面板只从本列表点名/奖励，不得跨班。 */
  students: Student[]
  selectedStudentId: number | null
  busy: boolean
  /** 课堂不可互动时传 true（paused / break / completed / cancelled / failed）。 */
  disabled: boolean
  /** 本节已发放小红花累计（parent 维护单一来源，成功后接收 rewarded 事件递增）。 */
  rewardTotal: number
}>()

const emit = defineEmits<{
  (e: 'update:selectedStudentId', id: number | null): void
  (e: 'random-roll', student: Student): void
  (e: 'rewarded', record: RewardRecord): void
}>()

const {
  QUICK_REWARD_REASONS,
  displayStudents,
  selected,
  reason,
  submitting,
  message,
  errorMsg,
  nameOf,
  interactionLocked,
  canReward,
  setSelected,
  randomRoll,
  reward,
} = useClassroomInteraction(props, emit)

const collapsed = ref(window.innerWidth < 1280)

function onSelectChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  setSelected(value === '' ? null : Number(value))
  message.value = ''
  errorMsg.value = ''
}
</script>

<template>
  <section
    class="interaction"
    :class="{ collapsed, locked: interactionLocked }"
    data-test="classroom-interaction"
  >
    <div class="i-head">
      <strong>课堂互动</strong>
      <span class="i-count">🌟 本节 {{ rewardTotal }}</span>
      <button
        class="i-toggle"
        type="button"
        @click="collapsed = !collapsed"
      >{{ collapsed ? '展开' : '收起' }}</button>
    </div>

    <!-- 折叠态：仅保留两个高频快捷按钮，减少对数字人/主内容的空间占用 -->
    <div v-if="collapsed" class="i-quick">
      <button
        type="button"
        :disabled="interactionLocked || !displayStudents.length"
        @click="randomRoll"
      >🎯 点名</button>
      <button
        type="button"
        :disabled="!canReward"
        @click="reward"
      >🌟 奖励</button>
      <span class="i-current-mini">{{ selected ? nameOf(selected) : '未选' }}</span>
    </div>

    <div v-else class="i-body">
      <div class="i-label">🎯 随机点名</div>
      <div class="row-line">
        <strong class="i-current">{{ selected ? nameOf(selected) : '未点名' }}</strong>
        <button
          type="button"
          class="mini"
          :disabled="interactionLocked || !displayStudents.length"
          @click="randomRoll"
        >重新随机</button>
      </div>
      <select
        class="i-select"
        :value="selectedStudentId ?? ''"
        :disabled="interactionLocked"
        aria-label="选择幼儿"
        @change="onSelectChange"
      >
        <option value="">— 选择幼儿 —</option>
        <option v-for="s in displayStudents" :key="s.id" :value="s.id">
          {{ nameOf(s) }}
        </option>
      </select>

      <div class="i-label">🌟 快速奖励</div>
      <div class="reasons">
        <button
          v-for="r in QUICK_REWARD_REASONS"
          :key="r"
          type="button"
          class="chip"
          :class="{ active: reason === r }"
          :disabled="interactionLocked"
          @click="reason = r"
        >{{ r }}</button>
      </div>
      <button
        type="button"
        class="i-add"
        :disabled="!canReward"
        @click="reward"
      >{{ submitting ? '发放中…' : '+1 小红花' }}</button>

      <p v-if="message" class="i-ok" data-test="message">{{ message }}</p>
      <p v-if="errorMsg" class="i-bad" data-test="error">{{ errorMsg }}</p>

      <p v-if="selectedStudentId == null && !interactionLocked" class="i-hint">
        * 先选择或随机点名一位幼儿，即可 +1 小红花
      </p>
    </div>
  </section>
</template>

<style scoped>
.interaction {
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
  padding: 12px 14px;
}
.interaction.locked { opacity: 0.6; }
.i-head { display: flex; align-items: center; gap: 8px; }
.i-head strong { color: #4F3D31; font-size: 15px; font-weight: 800; }
.i-count { margin-left: auto; color: #C07A3E; font-weight: 800; font-size: 13px; white-space: nowrap; }
.i-toggle { border: 0; background: transparent; color: #9B8779; cursor: pointer; font-size: 12px; }
.i-body { display: grid; gap: 8px; margin-top: 10px; }
.i-label { color: #9B8779; font-size: 12px; font-weight: 800; letter-spacing: 1px; }
.row-line { display: flex; align-items: center; gap: 8px; }
.i-current { color: #4F3D31; font-size: 15px; }
.mini, .i-toggle { border: 1px solid #EFD9C8; background: #FFFDF9; color: #876B5D; border-radius: 9px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.mini:disabled, .i-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.i-select { width: 100%; height: 34px; border: 1px solid #EFD9C8; border-radius: 9px; padding: 0 10px; background: #FFF; color: #4F3D31; }
.reasons { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.chip { border: 1px solid #EFD9C8; background: #FFF; color: #876B5D; border-radius: 9px; padding: 6px 4px; cursor: pointer; font-size: 12px; }
.chip.active { background: #FBEFE3; border-color: #EACFB4; color: #C07A3E; font-weight: 700; }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
.i-add { border: 0; border-radius: 11px; padding: 10px 14px; cursor: pointer; background: #E99168; color: #FFF; font-size: 14px; font-weight: 800; }
.i-add:disabled { opacity: 0.5; cursor: not-allowed; }
.i-ok { margin: 0; color: #4D9A69; font-size: 13px; }
.i-bad { margin: 0; color: #C64E4E; font-size: 13px; }
.i-hint { margin: 0; color: #BFAB9C; font-size: 12px; }
.i-quick { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: nowrap; }
.i-quick button { border: 1px solid #EFD9C8; background: #FFFDF9; color: #876B5D; border-radius: 9px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.i-quick button:disabled { opacity: 0.5; cursor: not-allowed; }
.i-current-mini { margin-left: auto; color: #9B8779; font-size: 12px; white-space: nowrap; }
</style>