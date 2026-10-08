<script setup lang="ts">
// 课堂开场舞台（视觉专用）：整屏舞台，左侧信息 + 右侧 3D 数字人，隐藏所有开发 UI。
// 不触发 TTS / 状态机 / ClassroomRun 变更；入场/出场动画均为视觉层。
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'

withDefaults(
  defineProps<{
    lessonTitle: string
    subtitle?: string
    className?: string
    teacherName?: string
  }>(),
  { subtitle: '', className: '', teacherName: '' },
)

const emit = defineEmits<{ (e: 'enter'): void }>()
</script>

<template>
  <div class="opening" data-test="opening-overlay">
    <div class="opening-glow" aria-hidden="true"></div>

    <!-- 顶部轻量信息条：不像管理后台，像课堂舞台 -->
    <header class="opening-top">
      <span class="top-badge">AI 智慧课堂</span>
      <span v-if="className || teacherName" class="top-meta">
        {{ className }}<template v-if="teacherName"> · {{ teacherName }}</template>
      </span>
    </header>

    <div class="opening-content">
      <!-- 左栏：信息 + CTA -->
      <section class="opening-info">
        <span class="info-tag">{{ className ? `${className} · 今日课堂` : '今日课堂' }}</span>
        <h1 class="info-title">👋 欢迎来到课堂</h1>
        <h2 class="info-lesson">{{ lessonTitle }}</h2>
        <p class="info-copy">{{ subtitle }}</p>
        <div class="opening-cta">
          <button class="enter" type="button" data-test="opening-enter" @click="emit('enter')">
            准备好了，开始上课
          </button>
          <button class="skip" type="button" data-test="opening-skip" @click="emit('enter')">
            跳过开场
          </button>
        </div>
      </section>

      <!-- 右栏：数字人舞台（无厚重白卡） -->
      <section class="opening-stage" aria-label="数字人舞台">
        <div class="avatar-stage">
          <div class="avatar-glow" aria-hidden="true"></div>
          <DigitalHumanStage opening />
        </div>
        <!-- 独立字幕区：不与数字人身体重叠 -->
        <div class="stage-caption" data-test="opening-caption">🤖 准备好一起学习啦！</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.opening {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 500;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 78% 18%, rgba(255, 246, 226, 0.75), transparent 60%),
    linear-gradient(160deg, #fffaf3 0%, #fff7ec 100%);
  color: #4f3d31;
  animation: opening-fade-in 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.opening-glow {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(52% 46% at 50% 100%, rgba(224, 170, 108, 0.14), transparent 70%);
}
.opening-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 26px 56px; font-size: 13px;
  animation: opening-info-in 300ms 80ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.top-badge { font-weight: 800; color: #c07a3e; letter-spacing: 0.12em; }
.top-meta { color: #9b8779; font-weight: 600; }

.opening-content {
  position: relative;
  max-width: 1440px;
  height: 100%;
  margin: 0 auto;
  padding: 72px 56px 48px;
  display: grid;
  grid-template-columns: minmax(360px, 0.85fr) minmax(520px, 1.15fr);
  gap: 56px;
  align-items: center;
}

/* 左栏信息层级 */
.opening-info { display: flex; flex-direction: column; gap: 18px; align-items: flex-start; }
.info-tag {
  display: inline-flex; padding: 6px 14px; border-radius: 999px;
  background: #fff; border: 1px solid #f0ddce; color: #a9896b;
  font-size: 14px; font-weight: 700; letter-spacing: 0.05em;
  animation: opening-info-in 350ms 80ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.info-title {
  margin: 0; font-size: clamp(40px, 4vw, 52px); font-weight: 700; line-height: 1.15; color: #43352c;
  animation: opening-info-in 350ms 120ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.info-lesson {
  margin: 0; font-size: clamp(28px, 2.6vw, 36px); font-weight: 700; color: #d9833f;
  animation: opening-info-in 350ms 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.info-copy {
  margin: 0; max-width: 30ch; font-size: clamp(17px, 1.4vw, 21px); line-height: 1.7; color: #8a7263;
  animation: opening-info-in 350ms 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.opening-cta { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; margin-top: 8px; }
.enter {
  height: 58px; padding: 0 38px; border: 0; border-radius: 18px;
  background: linear-gradient(135deg, #f0a06a, #e07e4e);
  color: #fff; font-size: 18px; font-weight: 700; cursor: pointer;
  box-shadow: 0 14px 30px rgba(224, 126, 78, 0.26);
  transition: transform .18s ease, box-shadow .18s ease;
  animation: opening-info-in 380ms 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.enter:hover { transform: translateY(-2px); box-shadow: 0 18px 36px rgba(224, 126, 78, 0.32); }
.enter:active { transform: translateY(0); }
.skip {
  border: 0; padding: 4px 2px; background: none; color: #9b8779;
  font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 4px;
  animation: opening-info-in 380ms 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.skip:hover { color: #c07a3e; }

/* 右栏数字人舞台 */
.opening-stage { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.avatar-stage {
  position: relative;
  width: 100%; height: min(72vh, 720px); min-height: 520px;
  display: grid; place-items: center;
  animation: opening-avatar-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.avatar-glow {
  position: absolute; left: 50%; bottom: 6%; width: 86%; height: 66%;
  transform: translateX(-50%);
  background: radial-gradient(ellipse, rgba(236, 189, 140, 0.32), transparent 68%);
  filter: blur(2px); pointer-events: none;
}
/* 3D 数字人撑满舞台：松开 210px 上限，完整居中 */
.avatar-stage :deep(.digital-human.opening) { width: 100%; height: 100%; }

/* 独立字幕区 */
.stage-caption {
  max-width: 460px; padding: 12px 22px; border-radius: 999px;
  background: rgba(255, 253, 249, 0.92); border: 1px solid #f0ddce; color: #7d6250;
  font-size: 17px; font-weight: 600; text-align: center; line-height: 1.5;
  box-shadow: 0 8px 22px rgba(79, 61, 49, 0.06);
  animation: caption-in 220ms 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes opening-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes opening-info-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes opening-avatar-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
@keyframes caption-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

/* 小屏：上下结构 */
@media (max-width: 900px) {
  .opening-top { padding: 18px 22px; }
  .opening-content {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    padding: 64px 22px 30px;
    gap: 10px;
    align-items: stretch;
    text-align: center;
  }
  .opening-info { align-items: center; gap: 12px; }
  .info-copy { max-width: none; }
  .opening-cta { align-items: center; }
  .avatar-stage { height: 44vh; min-height: 320px; }
  .opening-stage { gap: 8px; }
}
</style>