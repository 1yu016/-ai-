<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElInputNumber } from 'element-plus'
import { http, apiErrorMessage } from '@/api/http'
import { classroomRequestId } from '@/services/classroomCommandBus'

type Group = {
  id: number
  name: string
  classroomRunId: number
  members: { id: number; name: string; nickname?: string | null }[]
}
const props = defineProps<{ runId: number; active: boolean; allowed: boolean; studentIds?: number[] }>()
const count = ref(2)
const groups = ref<Group[]>([])
const currentGroups = ref<Group[]>([])
let selectionRevision = 0
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const pending = ref<{ runId: number; groupCount: number; requestId: string; studentIds?: number[] } | null>(null)
let generation = 0
const canGenerate = computed(() => props.allowed && !saving.value && !loading.value)

async function load() {
  const revision = ++generation
  const runId = props.runId
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get<{ items: Group[] }>(`/classroom-runs/${runId}/groups`)
    if (revision === generation && props.runId === runId) groups.value = data.items
  } catch (cause) {
    if (revision === generation) error.value = apiErrorMessage(cause, '小组查询失败，请重试。')
  } finally {
    if (revision === generation) loading.value = false
  }
}
async function generate() {
  if (!canGenerate.value) return
  if (props.studentIds && (props.studentIds.length < 2 || count.value > props.studentIds.length)) {
    error.value = '分组数量不能超过所选幼儿人数，请调整。'
    return
  }
  const revision = selectionRevision
  const input = pending.value ?? {
    runId: props.runId,
    groupCount: count.value,
    requestId: classroomRequestId('random-groups'),
    ...(props.studentIds ? { studentIds: [...props.studentIds] } : {}),
  }
  pending.value = input
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const { data } = await http.post<{ items: Group[] }>(
      `/classroom-runs/${input.runId}/groups/random`,
      { groupCount: input.groupCount, requestId: input.requestId, names: Array.from({ length: input.groupCount }, (_, index) => `第${index + 1}组 · ${input.requestId.slice(-24)}`), ...(input.studentIds ? { studentIds: input.studentIds } : {}) },
    )
    if (props.runId !== input.runId || revision !== selectionRevision) return
    currentGroups.value = data.items
    pending.value = null
    message.value = `已完成随机分组，共${data.items.length}组。`
    await load()
  } catch (cause) {
    if (props.runId === input.runId && revision === selectionRevision)
      error.value = apiErrorMessage(cause, '分组结果暂未确认，请重试此次分组。')
  } finally {
    saving.value = false
  }
}
watch(() => JSON.stringify([props.runId, [...(props.studentIds ?? [])].sort((a, b) => a - b)]), () => {
  selectionRevision++
  currentGroups.value = []
  generation++
  groups.value = []
  pending.value = null
  error.value = ''
  message.value = ''
})
watch(() => [props.active, props.runId, JSON.stringify(props.studentIds)] as const, ([active]) => {
  if (active) void load()
}, { immediate: true })
</script>

<template>
  <section class="grouping-panel" aria-label="课堂随机分组">
    <p v-if="studentIds">按当前勾选的 {{ studentIds.length }} 名幼儿随机分配，每组人数尽量均衡。</p>
    <p v-else>按本班全部在读幼儿随机分配，每组人数尽量均衡。请假或缺席幼儿也在此范围内，请教师核对。</p>
    <div class="grouping-controls">
      <label for="group-count">分成几组</label>
      <ElInputNumber id="group-count" v-model="count" :min="2" :max="Math.min(20, studentIds?.length ?? 20)" :precision="0" :disabled="saving || !!pending" aria-label="分组数量" />
      <ElButton type="primary" :disabled="!canGenerate" :loading="saving" @click="generate">{{ pending ? '重试此次分组' : '生成随机小组' }}</ElButton>
      <ElButton :disabled="saving || loading" @click="load">刷新小组</ElButton>
    </div>
    <p v-if="!allowed" role="status">请恢复课堂教学后再生成分组。</p>
    <p v-if="pending && !saving" role="status">保留了上次请求，重试会查询或完成同一次分组。</p>
    <p v-if="error" class="grouping-error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="loading">正在读取本节课堂的小组…</p>
    <p v-else-if="!currentGroups.length">尚未生成本次选择的分组。</p>
    <h3 v-if="currentGroups.length">本次分组 · 共 {{ currentGroups.reduce((total, group) => total + group.members.length, 0) }} 人</h3>
    <article v-for="group in currentGroups" :key="group.id" class="grouping-result">
      <h3>{{ group.name.split(' · ')[0] }} <small>{{ group.members.length }}人 · 小组编号 {{ group.id }}</small></h3>
      <ul><li v-for="member in group.members" :key="member.id">{{ member.name }}</li></ul>
    </article>
    <details v-if="groups.length">
      <summary>历史小组（{{ groups.length }}组，包含此前的分组结果）</summary>
      <article v-for="group in groups" :key="group.id" class="grouping-result">
        <h3>{{ group.name }}</h3>
        <p>{{ group.members.map(member => member.name).join('、') }}</p>
      </article>
    </details>
    <p>分组结果保存到本节课堂。再次生成会新增一批小组，已有小组保留。</p>
  </section>
</template>

<style scoped>
.grouping-panel{display:grid;gap:16px;color:var(--app-text)}
.grouping-panel p{margin:0;line-height:1.7}
.grouping-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.grouping-result{padding:16px;border:1px solid var(--app-border);border-radius:16px;background:var(--app-surface)}
h3{margin:0 0 12px}small{font-weight:400;font-size:13px;color:var(--app-muted)}
ul{display:flex;flex-wrap:wrap;gap:10px;padding:0;list-style:none;margin:0}
li{padding:6px 12px;border-radius:12px;background:var(--app-primary-soft)}
.grouping-error{color:#a53d32}
</style>
