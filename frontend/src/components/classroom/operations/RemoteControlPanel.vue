<script setup lang="ts">
import { ref } from 'vue'
import type { ActiveRun } from '@/services/classroomCheckpoint'

defineProps<{
  run: ActiveRun | null
  currentStep: string
  online: boolean
  pendingCommandCount: number
  remoteFeedback: string
}>()

const emit = defineEmits<{
  (e: 'remote', action: 'pause' | 'resume' | 'next'): void
  (e: 'send-command', text: string): void
}>()

const remoteCommand = ref('')

function submit() {
  const text = remoteCommand.value.trim()
  if (!text) return
  emit('send-command', text)
  remoteCommand.value = ''
}
</script>

<template>
  <section class="panel remote-hero">
    <div>
      <p class="eyebrow">教师手机 / 平板控制</p>
      <h2>{{ run ? `正在控制：${currentStep}` : '尚未连接课堂' }}</h2>
      <p class="muted">
        {{
          run
            ? '操作会通过课堂运行接口同步到大屏。'
            : '请先从教案点击“进入课堂”，这里会自动显示控制状态。'
        }}
      </p>
    </div>
    <span class="device-icon">📱</span>
  </section>
  <div class="remote-grid">
    <section class="panel">
      <h2>快捷控制</h2>
      <div class="control-grid">
        <button @click="emit('remote', 'pause')">⏸ 暂停</button>
        <button @click="emit('remote', 'resume')">▶ 恢复</button>
        <button @click="emit('remote', 'next')">下一环节 →</button>
      </div>
      <p class="muted">
        「随机点名」「课间模式」请在考勤与奖励页使用其专属入口；
        播放/搜索资源请输入或说出课堂指令。
      </p>
      <p v-if="remoteFeedback" class="feedback">{{ remoteFeedback }}</p>
      <div class="command-input">
        <input
          v-model="remoteCommand"
          placeholder="输入或说出课堂指令…"
          @keyup.enter="submit"
        >
        <button class="button" @click="submit">发送</button>
      </div>
    </section>
    <section class="panel">
      <div class="section-head">
        <h2>连接状态</h2>
        <span class="connection" :class="{ offline: !online }">
          {{ online ? '网络正常' : '离线' }}
        </span>
      </div>
      <dl class="status-list">
        <div>
          <dt>大屏课堂</dt>
          <dd>{{ run ? '已连接' : '未开始' }}</dd>
        </div>
        <div>
          <dt>当前环节</dt>
          <dd>{{ run ? currentStep : '—' }}</dd>
        </div>
        <div>
          <dt>待重试指令</dt>
          <dd>{{ pendingCommandCount }}</dd>
        </div>
      </dl>
      <p class="muted">断网时基础指令会保存在本机，网络恢复后可重新发送。</p>
    </section>
  </div>
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
.eyebrow {
  margin: 0 0 6px;
  color: #d67b59;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.remote-hero {
  max-width: 1180px;
  margin: 0 auto 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(120deg, #fffdf9, #fff0e4);
}
.remote-hero h2 {
  margin: 0;
  font-size: 28px;
}
.device-icon {
  font-size: 58px;
}
.remote-grid {
  max-width: 1180px;
  margin: auto;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr);
  gap: 18px;
}
.control-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 16px 0;
}
.control-grid button {
  min-height: 48px;
  border: 1px solid #efd9c8;
  border-radius: 11px;
  background: #fff8f0;
  color: #876b5d;
  cursor: pointer;
}
.control-grid button:hover {
  background: #ffe6d6;
  color: #b9684d;
}
.command-input {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
.command-input input {
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
  padding: 10px 16px;
  cursor: pointer;
  background: #e99168;
  color: #fff;
}
.button:hover {
  background: #d67b59;
}
.feedback {
  padding: 11px 13px;
  border-radius: 10px;
  background: #fff3dc;
  color: #926d22;
}
.connection {
  color: #4d9a69;
  font-size: 13px;
  font-weight: 700;
}
.connection.offline {
  color: #b77d20;
}
.pill {
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff0e4;
  color: #a9654c;
  font-size: 13px;
}
.status-list {
  display: grid;
  gap: 0;
}
.status-list div {
  display: flex;
  justify-content: space-between;
  padding: 13px 0;
  border-bottom: 1px solid #f4e6dc;
}
.status-list dt {
  color: #9a7e6e;
}
.status-list dd {
  margin: 0;
  font-weight: 700;
}
@media (max-width: 800px) {
  .remote-grid {
    grid-template-columns: 1fr;
  }
  .control-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
