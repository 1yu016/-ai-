<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RewardRecord } from '@/services/classroomCheckpoint'
import type { RewardLeaderboardItem } from '@/api/platform'
import { buildRunRewardLeaderboard } from '@/services/rewardLeaderboard'
import ClassRewardLeaderboard from '@/components/classroom/operations/ClassRewardLeaderboard.vue'

// 榜单全屏：以「本节课奖励榜」为主，班级累计榜为可切换 Tab。
// 本节榜 = buildRunRewardLeaderboard 基于本节完整 RewardRecord 聚合（共享算法）。
// 班级累计榜 = 后端 leaderboard 接口（未就绪时显示不可用）。
const props = defineProps<{
  rewards: RewardRecord[]
  classLeaderboard: RewardLeaderboardItem[]
  classLoading: boolean
  classError: string
}>()

const tab = ref<'run' | 'class'>('run')
const runItems = computed(() => buildRunRewardLeaderboard(props.rewards))
</script>

<template>
  <div class="lb-fullscreen" data-test="fs-leaderboard">
    <div class="lb-tabs">
      <button
        type="button"
        :class="{ active: tab === 'run' }"
        class="tab"
        data-test="lb-tab-run"
        @click="tab = 'run'"
      >本节课奖励榜</button>
      <button
        type="button"
        :class="{ active: tab === 'class' }"
        class="tab"
        data-test="lb-tab-class"
        @click="tab = 'class'"
      >班级累计成长榜</button>
    </div>

    <!-- 本节课奖励榜：复用共享 Top5 组件（同总结页同一套 UI/算法） -->
    <div v-if="tab === 'run'" class="lb-body">
      <ClassRewardLeaderboard
        :items="runItems"
        :loading="false"
        :error="''"
        title="本节课奖励榜"
        empty-text="本节课暂无奖励记录"
        :collapsible="false"
      />
    </div>

    <!-- 班级累计成长榜 -->
    <div v-else class="lb-body">
      <p v-if="classLoading" class="state" data-test="lb-loading">榜单加载中...</p>
      <p v-else-if="classError" class="state bad" data-test="lb-class-unavailable">
        班级累计成长榜暂不可用
      </p>
      <p v-else-if="!classLeaderboard.length" class="empty" data-test="lb-class-empty">
        班级还没有奖励记录
      </p>
      <ol v-else class="lb-list" data-test="lb-class-list">
        <li
          v-for="line in classLeaderboard"
          :key="line.studentId"
          class="lb-item"
          data-test="lb-item"
        >
          <span class="lb-rank">{{ line.rank }}</span>
          <span class="lb-name">{{ line.studentName || `幼儿 ${line.studentId}` }}</span>
          <span class="lb-stars">🌟 {{ line.totalStars }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.lb-fullscreen {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 560px;
  margin: auto;
}
.lb-tabs { display: flex; gap: 8px; justify-content: center; }
.tab {
  border: 1px solid #E8DED1;
  border-radius: 999px;
  padding: 8px 18px;
  background: #FFFDF9;
  color: #9B8779;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.tab.active { background: #E99168; border-color: #E99168; color: #fff; }
.lb-body { display: flex; flex-direction: column; gap: 8px; }
.lb-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.lb-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid #F0DDCE;
  border-radius: 14px;
  background: #FFFDF9;
  font-size: 17px;
}
.lb-rank { width: 28px; color: #C07A3E; font-weight: 800; }
.lb-name { flex: 1; color: #4F3D31; }
.lb-stars { color: #C07A3E; font-weight: 800; white-space: nowrap; }
.empty, .state, .more { margin: 0; text-align: center; color: #9B8779; font-size: 14px; padding: 16px 0; }
.state.bad { color: #C64E4E; }
</style>