<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { http, apiErrorMessage } from '@/api/http'
import { classroomRequestId } from '@/services/classroomCommandBus'

type Goal = { id: number; title: string; targetPoints: number; currentPoints: number; status: string }
type Honor = { key: string; title: string; student: { studentId: number; displayName: string } }
type Dashboard = { goal: Goal | null; totals: { points: number; flowers: number; categoryTotals: Record<string, number> }; honors: Honor[]; policy: { negativeRankingEnabled: false; rotation: string } }
const props = defineProps<{ awardTotal: number; runId?: number }>()
const dashboard = ref<Dashboard | null>(null)
const loading = ref(false)
const goalTitle = ref('一起收集成长能量')
const goalTarget = ref(30)
const collectiveReason = ref('全班认真合作')
const progress = computed(() => { const goal = dashboard.value?.goal; return goal ? Math.min(100, Math.round((goal.currentPoints / goal.targetPoints) * 100)) : 0 })
async function load() { if (!props.runId) return; loading.value = true; try { dashboard.value = (await http.get<Dashboard>(`/classroom-runs/${props.runId}/reward-dashboard`)).data } catch (error) { ElMessage.error(apiErrorMessage(error, '成长乐园加载失败')) } finally { loading.value = false } }
async function createGoal() { if (!props.runId || !goalTitle.value.trim()) return; try { await http.post(`/classroom-runs/${props.runId}/growth-goals`, { requestId: classroomRequestId('growth-goal'), title: goalTitle.value.trim(), targetPoints: goalTarget.value }); ElMessage.success('班级共同目标已建立'); await load() } catch (error) { ElMessage.error(apiErrorMessage(error, '共同目标创建失败')) } }
async function rewardClass() { if (!props.runId || !collectiveReason.value.trim()) return; try { await http.post(`/classroom-runs/${props.runId}/collective-rewards`, { requestId: classroomRequestId('collective-reward'), rewardCategory: 'cooperation', points: 3, reason: collectiveReason.value.trim(), goalId: dashboard.value?.goal?.id }); ElMessage.success('已为全班增加 3 点成长能量'); await load() } catch (error) { ElMessage.error(apiErrorMessage(error, '集体奖励发放失败')) } }
watch(() => props.runId, () => void load(), { immediate: true })
</script>

<template>
  <section class="panel growth">
    <div class="panel-title"><div><h2>班级成长乐园</h2><small>只展示正向成长，不设置倒数榜单</small></div><button v-if="runId" class="refresh" :disabled="loading" @click="load">刷新</button></div>
    <div class="tree">🌳</div>
    <strong>{{ dashboard?.totals.flowers ?? awardTotal }} 朵小红花 · {{ dashboard?.totals.points ?? awardTotal }} 点能量</strong>
    <div v-if="dashboard?.goal" class="goal"><div><b>{{ dashboard.goal.title }}</b><span>{{ dashboard.goal.currentPoints }}/{{ dashboard.goal.targetPoints }}</span></div><div class="progress"><i :style="{ width: `${progress}%` }"></i></div></div>
    <div v-else-if="runId" class="goal-create"><input v-model="goalTitle" maxlength="100" aria-label="共同目标名称"><input v-model.number="goalTarget" type="number" min="1" max="100000" aria-label="目标分数"><button @click="createGoal">建立共同目标</button></div>
    <div v-if="dashboard?.honors.length" class="honors"><article v-for="honor in dashboard.honors" :key="honor.key"><span>🏅 {{ honor.title }}</span><b>{{ honor.student.displayName }}</b></article></div>
    <div v-if="runId" class="collective"><input v-model="collectiveReason" maxlength="200" aria-label="集体奖励原因"><button @click="rewardClass">全班 +3 能量</button></div>
    <p class="muted">荣誉按回答、合作、探索、劳动等维度每日轮换。</p>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #f0ddce;
  border-radius: 18px;
  background: #fffdf9;
  padding: 20px;
  box-shadow: 0 10px 28px #b9795114;
}
.panel h2 {
  margin: 0 0 6px;
}
.panel-title,.goal>div,.collective,.goal-create { display:flex;align-items:center;justify-content:space-between;gap:8px; }
.panel-title small,.muted { color:#9a7e6e; }
.refresh,.goal-create button,.collective button { border:0;border-radius:10px;background:#e99168;color:#fff;padding:8px 11px;cursor:pointer; }
.goal { margin:16px 0;padding:13px;border-radius:12px;background:#fff4dd;text-align:left; }.goal span { color:#9a6a34;font-weight:800; }.progress { height:9px;margin-top:9px;overflow:hidden;border-radius:99px;background:#edd9bd; }.progress i { display:block;height:100%;background:linear-gradient(90deg,#76bd79,#f2bd58); }
.goal-create,.collective { margin-top:14px; }.goal-create input,.collective input { min-width:0;height:36px;border:1px solid #efd9c8;border-radius:9px;padding:0 9px;color:#60483e; }.goal-create input[type=number] { width:70px; }
.honors { display:grid;gap:7px;margin:14px 0; }.honors article { display:flex;justify-content:space-between;padding:9px 11px;border-radius:10px;background:#fff7eb;color:#73594b; }.honors b { color:#d27755; }.collective input { flex:1; }
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.growth {
  text-align: center;
}
.tree {
  font-size: 68px;
  padding: 14px;
}
</style>
