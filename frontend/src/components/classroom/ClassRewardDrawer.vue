<script setup lang="ts">
import { ElDrawer } from 'element-plus'
import { formatRewardTime, type RewardRecord } from '@/services/classroomCheckpoint'

defineProps<{
  modelValue: boolean
  rewards: RewardRecord[]
  totalStars: number
  loading: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
</script>

<template>
  <ElDrawer
    :model-value="modelValue"
    title="本节课奖励"
    size="420px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="reward-summary">
      🌟 累计 {{ totalStars }} 朵小红花 · 共 {{ rewards.length }} 次奖励
    </p>
    <p v-if="loading" class="reward-empty">加载中…</p>
    <p v-else-if="!rewards.length" class="reward-empty">
      还没有奖励记录。课堂运营页发奖励后，会在这里逐条显示。
    </p>
    <ul v-else class="reward-list">
      <li v-for="record in rewards" :key="record.id" class="reward-item">
        <span class="reward-time">{{ formatRewardTime(record.createdAt) }}</span>
        <div class="reward-body">
          <strong>{{ record.studentName ?? `幼儿 ${record.studentId}` }}</strong>
          <span class="reward-stars">🌟 +{{ record.stars }}</span>
        </div>
        <p class="reward-reason">{{ record.reason || '（未填原因）' }}</p>
        <small v-if="record.teacherName" class="reward-teacher">
          教师：{{ record.teacherName }}
        </small>
      </li>
    </ul>
  </ElDrawer>
</template>

<style scoped>
.reward-summary { margin: 0 0 14px; padding: 12px 14px; border-radius: 12px; background: #FFF8EE; color: #C07A3E; font-weight: 800; }
.reward-empty { padding: 32px 8px; text-align: center; color: #9B8779; line-height: 1.7; }
.reward-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.reward-item {
  display: grid;
  grid-template-columns: 84px 1fr;
  align-items: baseline;
  gap: 4px 12px;
  padding: 14px 16px;
  border: 1px solid #F0E4D5;
  border-radius: 12px;
  background: #FFFDF9;
}
.reward-time { color: #9B8779; font-size: 13px; font-variant-numeric: tabular-nums; }
.reward-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reward-body strong { color: #4F3D31; }
.reward-stars { color: #C07A3E; font-weight: 800; white-space: nowrap; }
.reward-reason { grid-column: 2; margin: 0; color: #6B584C; font-size: 14px; }
.reward-teacher { grid-column: 2; color: #9B8779; font-size: 12px; }
</style>
