<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { Student } from '@/api/platform'
import type { LessonRun } from '@/stores/lessonRun'
import type { RewardRecord } from '@/services/classroomCheckpoint'
import { useClassroomInteraction } from './useClassroomInteraction'

// 课堂互动全屏操作台：只负责布局 / 视觉 / 交互呈现。
// 点名与快速奖励业务全部复用 useClassroomInteraction（与普通面板同源），
// 禁止在本组件复制 randomRoll / postReward / QUICK_REWARD_REASONS。
// 顶部栏（返回/标题/本节奖励/元信息）由 LessonClassroomView 的 overlay 脚手架统一渲染。
const props = defineProps<{
  run: LessonRun | null
  students: Student[]
  selectedStudentId: number | null
  busy: boolean
  disabled: boolean
  rewardTotal: number
}>()

const emit = defineEmits<{
  (e: 'update:selectedStudentId', id: number | null): void
  (e: 'random-roll', student: Student): void
  (e: 'rewarded', record: RewardRecord): void
  (e: 'goto-leaderboard'): void
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

// 窄屏（<1000px）改上下布局，由 resize 维护 class，便于窄屏测试断言。
const isNarrow = ref(window.innerWidth < 1000)
function onResize() {
  isNarrow.value = window.innerWidth < 1000
}
window.addEventListener('resize', onResize)
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <section
    class="ifx"
    data-test="interaction-fullscreen"
    :class="{ 'is-narrow': isNarrow }"
    :data-narrow="isNarrow ? 'true' : 'false'"
  >
    <div class="ifx-main">
      <!-- 左：点名舞台 -->
      <div class="ifx-col ifx-stage-col">
        <article class="ifx-card">
          <header class="ifx-card-head">
            <h2>🎯 课堂点名</h2>
          </header>

          <!-- 点名焦点：当前点到谁 -->
          <div class="selected-stage" data-test="selected-stage">
            <template v-if="selected">
              <div class="ss-ring">
                <span class="ss-star">⭐</span>
              </div>
              <div class="ss-name" data-test="selected-name">{{ nameOf(selected) }}</div>
              <div class="ss-call">今天轮到你啦！</div>
            </template>
            <template v-else>
              <div class="ss-ring ss-ring-soft">
                <span class="ss-star ss-dart">🎯</span>
              </div>
              <div class="ss-empty">
                <p class="ss-empty-line">点击随机点名，</p>
                <p class="ss-empty-line">看看今天轮到谁！</p>
              </div>
            </template>
          </div>

          <button
            type="button"
            class="roll-cta"
            data-test="random-roll"
            :disabled="interactionLocked || !displayStudents.length"
            @click="randomRoll"
          >{{ selected ? '🎯 再随机一次' : '🎯 随机点名' }}</button>

          <!-- 学生选择：幼儿 chip 网格 -->
          <div class="student-picker">
            <div class="picker-label">选择幼儿</div>
            <div class="student-grid">
              <button
                v-for="s in displayStudents"
                :key="s.id"
                type="button"
                class="student-chip"
                :class="{ active: s.id === props.selectedStudentId }"
                data-test="student-chip"
                :disabled="interactionLocked"
                @click="setSelected(s.id)"
              >
                <span class="chip-name">{{ nameOf(s) }}</span>
                <span v-if="s.id === props.selectedStudentId" class="chip-check">✓</span>
              </button>
            </div>
            <p v-if="!displayStudents.length" class="picker-empty">本班暂无可用幼儿</p>
          </div>
        </article>
      </div>

      <!-- 右：奖励操作台 -->
      <div class="ifx-col ifx-reward-col">
        <article class="ifx-card">
          <header class="ifx-card-head">
            <h2>🌟 快速奖励</h2>
          </header>

          <!-- 当前奖励对象 -->
          <div class="reward-target">
            <small class="rt-label">当前奖励对象</small>
            <div
              class="rt-name"
              :class="{ empty: !selected }"
              data-test="reward-target-name"
            >{{ selected ? nameOf(selected) : '请选择一名幼儿' }}</div>
          </div>

          <!-- 奖励原因：chips -->
          <div class="reason-label">奖励原因</div>
          <div class="reason-grid">
            <button
              v-for="r in QUICK_REWARD_REASONS"
              :key="r"
              type="button"
              class="reason-chip"
              :class="{ active: reason === r }"
              data-test="reason-chip"
              :disabled="interactionLocked"
              @click="reason = r"
            >{{ r }}</button>
          </div>

          <button
            type="button"
            class="reward-cta"
            data-test="reward-cta"
            :disabled="!canReward"
            @click="reward"
          >{{ submitting ? '🌟 正在奖励…' : '🌟 奖励 1 朵小红花' }}</button>

          <p v-if="message" class="ifx-ok" data-test="message">{{ message }}</p>
          <p v-if="errorMsg" class="ifx-bad" data-test="error">{{ errorMsg }}</p>

          <!-- 本节奖励状态 + 入口 -->
          <div class="section-summary">
            <div class="ss-summ">
              <span>本节课堂</span>
              <strong class="stars">🌟 已发放 {{ rewardTotal }} 朵</strong>
            </div>
            <button
              type="button"
              class="leaderboard-link"
              data-test="goto-leaderboard"
              @click="emit('goto-leaderboard')"
            >查看本节奖励榜 ›</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ifx {
  width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.ifx-main {
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 32px 48px 48px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(380px, 0.95fr);
  gap: 32px;
  align-items: stretch;
}

/* 视觉卡片：暖白半透明 + 圆角，极轻阴影 */
.ifx-card {
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid #F2E6D5;
  box-shadow: 0 14px 40px rgba(121, 89, 66, 0.06);
  padding: 30px 32px 32px;
  display: flex;
  flex-direction: column;
}
.ifx-card-head h2 {
  margin: 0;
  color: #4F3D31;
  font-size: 22px;
  font-weight: 800;
}

/* ─── 左：点名舞台 ─── */
.selected-stage {
  margin-top: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  border-radius: 60px 60px 24px 24px;
  background:
    radial-gradient(circle at 50% 30%, rgba(255, 224, 189, 0.35), rgba(255, 247, 238, 0.1) 70%);
}
.ss-ring {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, #FFF3E3, #FFE3C4);
  border: 2px solid #F7D4A6;
  box-shadow: 0 12px 28px rgba(214, 151, 92, 0.22);
  font-size: 44px;
}
.ss-ring-soft { opacity: 0.9; }
.ss-dart { font-size: 40px; }
.ss-name {
  margin-top: 22px;
  font-size: clamp(36px, 4.2vw, 48px);
  font-weight: 700;
  color: #4F3D31;
  line-height: 1.1;
  letter-spacing: 2px;
}
.ss-call {
  margin-top: 10px;
  color: #C07A3E;
  font-size: 18px;
  font-weight: 700;
}
.ss-empty {
  margin-top: 20px;
  text-align: center;
}
.ss-empty-line {
  margin: 2px 0;
  color: #A48E7E;
  font-size: 17px;
  line-height: 1.6;
}

.roll-cta {
  margin: 24px auto 0;
  min-width: 180px;
  height: 52px;
  padding: 0 28px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(140deg, #F2A06B, #E99168);
  color: #FFF;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(214, 122, 88, 0.28);
}
.roll-cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.student-picker {
  margin-top: 30px;
  border-top: 1px solid #F3E8D8;
  padding-top: 20px;
}
.picker-label {
  color: #9B8779;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
}
.student-grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
.student-chip {
  position: relative;
  min-height: 46px;
  padding: 6px 12px;
  border: 1.5px solid #EFDCC6;
  border-radius: 14px;
  background: #FFFDF8;
  color: #6B584C;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.student-chip:hover { border-color: #E4C395; }
.student-chip.active {
  border-color: #E99168;
  background: #FFF1E3;
  color: #B3682F;
  box-shadow: 0 6px 16px rgba(214, 122, 88, 0.16);
  transform: translateY(-1px);
}
.student-chip:disabled { opacity: 0.5; cursor: not-allowed; }
.chip-check { margin-left: 6px; color: #E99168; font-weight: 900; }
.picker-empty { margin: 12px 0 0; color: #A48E7E; font-size: 14px; }

/* ─── 右：奖励操作台 ─── */
.reward-target {
  margin-top: 22px;
  padding: 18px 20px;
  border-radius: 16px;
  background: #FFF9F0;
  border: 1px solid #F2E3CD;
}
.rt-label {
  display: block;
  color: #9B8779;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1px;
}
.rt-name {
  margin-top: 6px;
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 700;
  color: #4F3D31;
  line-height: 1.15;
}
.rt-name.empty { color: #B7A292; font-size: 22px; }

.reason-label {
  margin-top: 24px;
  color: #9B8779;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
}
.reason-grid {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.reason-chip {
  height: 44px;
  padding: 0 18px;
  border: 1.5px solid #EFDCC6;
  border-radius: 999px;
  background: #FFFDF8;
  color: #6B584C;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.reason-chip:hover { border-color: #E4C395; }
.reason-chip.active {
  border-color: #E99168;
  background: #FFF1E3;
  color: #B3682F;
  box-shadow: 0 6px 16px rgba(214, 122, 88, 0.16);
}
.reason-chip:disabled { opacity: 0.5; cursor: not-allowed; }

.reward-cta {
  margin-top: 26px;
  width: 100%;
  height: 58px;
  border: 0;
  border-radius: 16px;
  background: linear-gradient(140deg, #F2A06B, #E99168);
  color: #FFF;
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(214, 122, 88, 0.26);
}
.reward-cta:disabled {
  background: #EDE2D3;
  color: #B8A795;
  cursor: not-allowed;
  box-shadow: none;
}

.ifx-ok { margin: 14px 0 0; color: #4D9A69; font-size: 15px; font-weight: 700; }
.ifx-bad { margin: 14px 0 0; color: #C64E4E; font-size: 15px; font-weight: 700; }

.section-summary {
  margin-top: 26px;
  padding-top: 26px;
  border-top: 1px solid #F3E8D8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ss-summ {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ss-summ span { color: #9B8779; font-size: 13px; }
.ss-summ .stars { color: #C07A3E; font-size: 18px; font-weight: 800; }
.leaderboard-link {
  border: 1px solid #EFDCC6;
  background: #FFFDF8;
  color: #876B5D;
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.leaderboard-link:hover { border-color: #E4C395; color: #B3682F; }

/* ─── 窄屏：上下布局 ─── */
@media (max-width: 999px) {
  .ifx-main {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 20px 20px 32px;
  }
  .student-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: 320px; }
}
@media (max-width: 560px) {
  .student-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ifx-card { padding: 20px 18px 22px; }
}
@media (min-width: 1000px) and (max-width: 1180px) {
  .ifx-main { padding: 24px 28px 40px; }
}
</style>