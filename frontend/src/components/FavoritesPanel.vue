<script setup lang="ts">
import { ElButton, ElMessage } from 'element-plus'
import { useFavoriteStore } from '@/stores/favorite'

const favoriteStore = useFavoriteStore()
favoriteStore.initialize()

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function removeFavorite(id: string) {
  if (favoriteStore.removeFavorite(id)) ElMessage.success('已取消收藏')
}
</script>

<template>
  <section class="favorites-panel" aria-label="我的收藏">
    <header class="favorites-header">
      <div class="favorites-icon" aria-hidden="true">⭐</div>
      <div>
        <p>常用内容</p>
        <h1>我的收藏</h1>
        <span>把喜欢的回答和重要消息放在这里。</span>
      </div>
      <strong>{{ favoriteStore.favorites.length }} 条</strong>
    </header>

    <div class="favorites-content">
      <div v-if="favoriteStore.sortedFavorites.length" class="favorite-list">
        <article
          v-for="favorite in favoriteStore.sortedFavorites"
          :key="favorite.id"
          class="favorite-card"
        >
          <div class="favorite-meta">
            <span :class="favorite.role">
              {{ favorite.role === 'assistant' ? '小花老师' : '我' }}
            </span>
            <time :datetime="favorite.messageCreatedAt">
              {{ formatTime(favorite.messageCreatedAt) }}
            </time>
          </div>
          <p>{{ favorite.content }}</p>
          <footer>
            <small>来自：{{ favorite.sessionTitle }}</small>
            <ElButton text type="danger" @click="removeFavorite(favorite.id)">
              取消收藏
            </ElButton>
          </footer>
        </article>
      </div>

      <div v-else class="favorite-empty">
        <div aria-hidden="true">☆</div>
        <h2>还没有收藏消息</h2>
        <p>回到聊天页面，点击消息右下角的收藏按钮吧。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.favorites-panel {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fffdfa;
  color: #473d36;
}

.favorites-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 23px 30px;
  border-bottom: 1px solid #f2e4d7;
  background: #fff9ee;
}

.favorites-icon {
  display: grid;
  width: 56px;
  height: 56px;
  flex: none;
  place-items: center;
  border-radius: 18px;
  background: #ffedb8;
  font-size: 27px;
}

.favorites-header div:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.favorites-header p,
.favorites-header span {
  margin: 0;
  color: #957d6c;
  font-size: 12px;
}

.favorites-header p {
  color: #be8065;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.favorites-header h1 {
  margin: 2px 0 3px;
  font-size: 23px;
}

.favorites-header > strong {
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff0dc;
  color: #9a684c;
  font-size: 12px;
}

.favorites-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 26px 30px;
  scrollbar-color: #e9d7c8 transparent;
  scrollbar-width: thin;
}

.favorite-list {
  display: grid;
  gap: 14px;
}

.favorite-card {
  padding: 17px 18px 13px;
  border: 1px solid #efdfd1;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 20px rgb(112 72 43 / 6%);
}

.favorite-meta,
.favorite-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.favorite-meta span {
  padding: 4px 9px;
  border-radius: 999px;
  background: #f6efe7;
  color: #806858;
  font-size: 11px;
  font-weight: 700;
}

.favorite-meta span.user {
  background: #ffe7d8;
  color: #a65b42;
}

.favorite-meta time,
.favorite-card small {
  color: #a18a7a;
  font-size: 11px;
}

.favorite-card > p {
  margin: 14px 0;
  color: #57463d;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.favorite-card footer {
  padding-top: 10px;
  border-top: 1px solid #f6eee7;
}

.favorite-empty {
  display: grid;
  min-height: 440px;
  place-items: center;
  align-content: center;
  color: #917b6b;
  text-align: center;
}

.favorite-empty div {
  font-size: 52px;
}

.favorite-empty h2 {
  margin: 12px 0 6px;
  font-size: 18px;
}

.favorite-empty p {
  margin: 0;
  font-size: 12px;
}
</style>
