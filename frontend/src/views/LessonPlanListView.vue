<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElButton, ElCard, ElMessage, ElMessageBox, ElOption, ElSelect, ElInput, ElTag } from 'element-plus'
import { useLessonPlanStore } from '@/stores/lessonPlan'

const router = useRouter(); const store = useLessonPlanStore()
const { items, keyword, ageGroup, status, loading, error } = storeToRefs(store)
const statusText = { draft: '草稿', ready: '可上课', archived: '已归档' }
async function remove(id: number) { try { await ElMessageBox.confirm('删除教案后课堂步骤也会删除，课程资源不受影响。确定删除吗？', '删除教案', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }) } catch { return } try { await store.remove(id); ElMessage.success('教案已删除') } catch (e) { ElMessage.error(e instanceof Error ? e.message : '删除失败') } }
async function start(id: number) { await router.push(`/classroom/preflight/${id}`) }
async function copy(id: number) { try { await store.copy(id); ElMessage.success('已复制教案') } catch { ElMessage.error('复制失败') } }
onMounted(store.fetchList)
</script>

<template>
  <main class="page"><header><div><small>AI 备课中心</small><h1>把灵感编排成一堂好课</h1><p>创建教案、绑定资源，然后一键进入投屏课堂。</p></div><div><ElButton @click="router.push('/chat')">返回助教</ElButton><ElButton type="primary" @click="router.push('/lesson-plans/new')">新建教案</ElButton></div></header>
    <section class="filters"><ElInput v-model="keyword" clearable placeholder="搜索标题或主题" @keyup.enter="store.fetchList" /><ElSelect v-model="ageGroup" clearable placeholder="年龄段"><ElOption label="3-4岁" value="3-4"/><ElOption label="4-5岁" value="4-5"/><ElOption label="5-6岁" value="5-6"/></ElSelect><ElSelect v-model="status" clearable placeholder="状态"><ElOption label="草稿" value="draft"/><ElOption label="可上课" value="ready"/><ElOption label="已归档" value="archived"/></ElSelect><ElButton :loading="loading" @click="store.fetchList">查询</ElButton></section>
    <div v-if="error" class="state error">{{ error }} <ElButton @click="store.fetchList">重试</ElButton></div>
    <div v-else-if="!loading && !items.length" class="state"><span>🪴</span><h2>还没有教案</h2><p>从一个熟悉的主题开始，AI 也可以先帮你生成草稿。</p><ElButton type="primary" @click="router.push('/lesson-plans/new')">创建第一份教案</ElButton></div>
    <section v-else class="grid"><ElCard v-for="plan in items" :key="plan.id" shadow="hover"><template #header><div class="card-head"><h2>{{ plan.title }}</h2><ElTag v-if="plan.stepCount === 0" type="warning">缺少步骤</ElTag><ElTag v-else :type="plan.status === 'ready' ? 'success' : plan.status === 'archived' ? 'info' : 'warning'">{{ statusText[plan.status] }}</ElTag></div></template><p class="theme">{{ plan.theme }}</p><p v-if="plan.stepCount === 0" class="plan-warning">还没有课堂步骤，请先编辑教案。</p><dl><div><dt>年龄段</dt><dd>{{ plan.ageGroup }}岁</dd></div><div><dt>预计时长</dt><dd>{{ plan.estimatedMinutes }}分钟</dd></div><div><dt>更新时间</dt><dd>{{ new Date(plan.updatedAt).toLocaleString() }}</dd></div></dl><div class="actions"><ElButton @click="router.push(`/lesson-plans/${plan.id}/edit`)">编辑</ElButton><ElButton @click="copy(plan.id)">复制</ElButton><ElButton type="danger" plain @click="remove(plan.id)">删除</ElButton><ElButton type="primary" :disabled="plan.status === 'archived' || plan.stepCount === 0" @click="start(plan.id)">开始上课</ElButton></div></ElCard></section>
  </main>
</template>

<style scoped>
.page{min-height:100vh;padding:34px max(20px,5vw);box-sizing:border-box;background:#fffaf2;color:#493d36}header{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:1280px;margin:auto}header small{color:#c27b59;font-weight:800;letter-spacing:.1em}h1{margin:5px 0;font-size:32px}header p{margin:0;color:#8e7768}.filters{max-width:1280px;margin:28px auto;display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;padding:16px;border-radius:18px;background:white;box-shadow:0 8px 28px #84542612}.grid{max-width:1280px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}.card-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.card-head h2{margin:0;font-size:19px}.theme{color:#b2694f;font-weight:700}.plan-warning{padding:9px 11px;border-radius:10px;background:#fff3df;color:#a86122}dl{display:grid;gap:8px}dl div{display:flex;justify-content:space-between}dt{color:#967f70}dd{margin:0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.state{max-width:700px;margin:12vh auto;text-align:center;padding:40px;border-radius:20px;background:#fff}.state>span{font-size:48px}.state.error{color:#bb4848}@media(max-width:720px){header{align-items:flex-start;flex-direction:column}.filters{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
</style>
