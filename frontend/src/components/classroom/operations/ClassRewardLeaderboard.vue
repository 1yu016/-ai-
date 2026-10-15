<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RewardLeaderboardItem } from '@/api/platform'

interface Props {
  items: RewardLeaderboardItem[]
  loading: boolean
  /** 非空即进入错误态（区别于 empty：空 = 已成功加载但没有记录）。 */
  error: string
  title?: string
  /** 空态文案。 */
  emptyText?: string
  /** 是否允许在窄屏折叠为快捷入口；全屏/总结页传 false 始终展示完整 Top5。 */
  collapsible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '班级成长榜',
  emptyText: '还没有奖励记录',
  collapsible: true,
})

const emit = defineEmits<{ (e: 'retry'): void }>()

// 纯展示组件：不自己请求 API，请求/刷新由 parent（store/视图）控制。
// 只渲染 backend 返回的前 5 名，杜绝前端按页自算总榜。
const displayItems = computed(() => props.items.slice(0, 5))

// 宽屏直接展示 Top5；<1280px 且允许折叠时缩成「🏆 榜单」快捷入口，避免挤压中央教学区。
const collapsed = ref(
  typeof window !== 'undefined' ? window.innerWidth < 1280 && props.collapsible : false,
)
</script>

<template>
  <section class="lb" data-test="reward-leaderboard">
    <!-- 窄屏折叠快捷入口（仅 collapsible 时可用） -->
    <button
      v-if="collapsed"
      type="button"
      class="lb-mini"
      data-test="lb-collapsed"
      @click="collapsed = false"
    >
      🏆 榜单
    </button>

    <div v-else class="lb-open">
      <div class="lb-head">
        <strong>🏆 {{ title }}</strong>
        <button
          v-if="collapsible"
          type="button"
          class="lb-toggle"
          data-test="lb-toggle"
          @click="collapsed = true"
        >
          收起
        </button>
      </div>

      <div class="lb-body">
        <p v-if="loading" class="lb-state" data-test="lb-loading">榜单加载中...</p>
        <div v-else-if="error" class="lb-state bad" data-test="lb-error">
          {{ error }}
          <button type="button" class="lb-retry" data-test="lb-retry" @click="emit('retry')">
            重试
          </button>
        </div>
        <p v-else-if="!displayItems.length" class="lb-state" data-test="lb-empty">
          {{ emptyText }}
        </p>
        <ol v-else class="lb-list" data-test="lb-list">
          <li
            v-for="item in displayItems"
            :key="item.studentId"
            class="lb-item"
            :data-test="`lb-rank-${item.rank}`"
          >
            <span class="lb-rank">{{ item.rank }}</span>
            <span class="lb-name">{{ item.studentName ?? `幼儿 ${item.studentId}` }}</span>
            <span class="lb-stars">🌟 {{ item.totalStars }}</span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lb {
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
  padding: 12px 14px;
}
.lb-mini {
  width: 100%;
  border: 1px dashed #EAD8C6;
  background: #FEFBF4;
  color: #9B8779;
  border-radius: 12px;
  padding: 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}
.lb-open { display: block; }
.lb-head { display: flex; align-items: center; gap: 8px; }
.lb-head strong { color: #4F3D31; font-size: 15px; font-weight: 800; }
.lb-toggle {
  margin-left: auto;
  border: 1px solid #EFD9C8;
  background: #FFFDF9;
  color: #876B5D;
  border-radius: 9px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
}
.lb-body { margin-top: 10px; }
.lb-state { margin: 0; color: #9B8779; font-size: 13px; text-align: center; padding: 8px 0; }
.lb-state.bad { color: #C64E4E; }
.lb-retry {
  margin-left: 10px;
  border: 1px solid #EFD9C8;
  background: #FFF;
  color: #876B5D;
  border-radius: 9px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 12px;
}
.lb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.lb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid #F0DDCE;
  border-radius: 10px;
  background: #FFFDF9;
}
.lb-rank { width: 22px; color: #C07A3E; font-weight: 800; }
.lb-name { flex: 1; color: #4F3D31; font-size: 14px; }
.lb-stars { color: #C07A3E; font-weight: 800; white-space: nowrap; }
</style>