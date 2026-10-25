<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElInput } from 'element-plus'
import { resourceApi, type ResourceResponse } from '@/api/resources'
import { apiErrorMessage } from '@/api/http'
import { usePresentationQueue } from '@/composables/usePresentationQueue'
const results = ref<ResourceResponse[]>([])
const searching = ref(false)
const searchError = ref('')
const { items, saving, error, save, show, move, replace, activeItemId, previousItem, nextItem } = usePresentationQueue()
const replacementId = ref<string | null>(null)
const replacementIndex = computed(() => items.value.findIndex(item => item.id === replacementId.value))
const keyword = ref('')
async function search() {
  if (searching.value) return
  searching.value = true; searchError.value = ''
  try { const response = await resourceApi.list({ keyword: keyword.value, reviewStatus: 'approved', pageSize: 100 }); results.value = response.data.items }
  catch (cause) { searchError.value = apiErrorMessage(cause, '资源搜索失败，请重试。') }
  finally { searching.value = false }
}
</script>

<template>
  <section class="queue-panel" aria-label="当前课堂展示队列">
    <h3>当前环节展示队列</h3>
    <p>这里只调整本次课堂。整理队列不会切换大屏，点击展示或播放后才切换。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="search"><ElButton :disabled="saving || !previousItem" @click="previousItem && show(previousItem)">上一项</ElButton><ElButton :disabled="saving || !nextItem" @click="nextItem && show(nextItem)">下一项</ElButton></div>
    <div v-for="(item, index) in items" :key="item.id" class="queue-row">
      <strong>{{ item.title }}{{ item.enabled ? '' : '（已隐藏）' }}{{ activeItemId === item.id ? ' · 当前队列位置' : '' }}</strong>
      <div>
        <ElButton :disabled="saving || !item.enabled" @click="show(item)">展示</ElButton>
        <ElButton v-if="item.kind === 'resource'" :disabled="saving || !item.enabled" @click="show(item, true)">播放</ElButton>
        <ElButton :disabled="saving || index === 0" @click="move(index, -1)">上移</ElButton>
        <ElButton :disabled="saving || index === items.length - 1" @click="move(index, 1)">下移</ElButton>
        <ElButton :disabled="saving" @click="save(items.map((entry, i) => i === index ? { ...entry, enabled: !entry.enabled } : entry))">{{ item.enabled ? '隐藏' : '恢复' }}</ElButton>
        <ElButton :disabled="saving" @click="save(items.filter((_, i) => i !== index))">移除</ElButton>
        <ElButton :disabled="saving" @click="replacementId = item.id">替换内容</ElButton>
      </div>
    </div>
    <ElButton :disabled="saving" @click="save([...items, { id: `avatar-${Date.now()}`, kind: 'avatar', title: '数字人互动', enabled: true }])">加入数字人</ElButton>
    <h3>更多教学资源</h3>
    <p v-if="replacementIndex >= 0">为队列第 {{ replacementIndex + 1 }} 项选择替换资源；替换不会切换当前大屏。<ElButton @click="replacementId = null">取消替换</ElButton></p>
    <form class="search" @submit.prevent="search"><ElInput v-model="keyword" placeholder="搜索已审核资源" /><ElButton native-type="submit">搜索</ElButton></form>
    <p v-if="searching">正在搜索…</p><p v-if="searchError" role="alert">{{ searchError }}</p>
    <div v-for="resource in results" :key="resource.id" class="queue-row">
      <span>{{ resource.title }}</span>
      <ElButton :disabled="saving || items.length >= 100" @click="save([...items, { id: `resource-${resource.id}-${Date.now()}`, kind: 'resource', resourceId: Number(resource.id), title: resource.title, enabled: true }])">加入本节课堂</ElButton>
      <ElButton v-if="replacementIndex >= 0" :disabled="saving" @click="replace(replacementIndex, { id: '', kind: 'resource', resourceId: resource.id, title: resource.title, enabled: true }); replacementId = null">替换所选项</ElButton>
    </div>
  </section>
</template>

<style scoped>
.queue-panel{color:var(--app-text)}h3{margin:24px 0 12px}p{color:var(--app-muted);line-height:1.6}.queue-row{padding:16px;margin:12px 0;border:1px solid var(--app-border);border-radius:16px;background:var(--app-surface-soft);display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.queue-row>div{display:flex;gap:8px;flex-wrap:wrap}.queue-row .el-button{margin:0}.search{display:flex;gap:12px}
</style>
