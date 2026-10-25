<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInputNumber } from 'element-plus'
import { lessonEvidenceApi, type EvidencePack, type ReferenceRun } from '@/api/lessonEvidence'
import { apiErrorMessage } from '@/api/http'
const props = defineProps<{planId:number|null;baseVersion:number}>()
const open = defineModel<boolean>('open',{default:false})
const emit = defineEmits<{selected:[pack:EvidencePack]}>()
const items=ref<ReferenceRun[]>([]); const total=ref(0); const page=ref(1)
const historicalVersion=ref<number|undefined>(); const from=ref(''); const to=ref('')
const selected=ref<number[]>([]); const pack=ref<EvidencePack|null>(null)
const loading=ref(false); const building=ref(false); const error=ref('')
let listSequence=0; let packSequence=0
const canAdd=computed(()=>!!pack.value && pack.value.baseVersion===props.baseVersion && pack.value.targetLessonPlanId===props.planId)
function invalidatePack(){packSequence++;pack.value=null;building.value=false}
async function load(reset=false){
  if(!props.planId)return
  if(reset)page.value=1
  const sequence=++listSequence;loading.value=true;error.value='';items.value=[]
  try{
    const {data}=await lessonEvidenceApi.list(props.planId,{page:page.value,pageSize:10,lessonPlanVersion:historicalVersion.value,
      from:from.value ? `${from.value}T00:00:00+08:00`:undefined,to:to.value?`${to.value}T23:59:59+08:00`:undefined})
    if(sequence!==listSequence)return
    items.value=data.items;total.value=data.total
  }catch(e){if(sequence===listSequence)error.value=apiErrorMessage(e,'参考课堂加载失败，请重试')}
  finally{if(sequence===listSequence)loading.value=false}
}
function select(id:number,checked:boolean){
  if(checked && !selected.value.includes(id)){if(selected.value.length>=5)return;selected.value.push(id)}
  else if(!checked)selected.value=selected.value.filter(value=>value!==id)
  invalidatePack()
}
async function build(){
  if(!props.planId || !selected.value.length)return
  const sequence=++packSequence;building.value=true;error.value='';pack.value=null
  try{
    const {data}=await lessonEvidenceApi.build(props.planId,{baseVersion:props.baseVersion,runIds:[...selected.value]})
    if(sequence!==packSequence)return
    pack.value=data
  }catch(e){if(sequence===packSequence)error.value=apiErrorMessage(e,'证据包生成失败，请重新核对权限和版本')}
  finally{if(sequence===packSequence)building.value=false}
}
function add(){if(canAdd.value && pack.value){emit('selected',pack.value);open.value=false}}
watch(()=>[props.planId,props.baseVersion],()=>{listSequence++;selected.value=[];items.value=[];invalidatePack();if(open.value)void load(true)})
watch(open,value=>{if(value)void load(true);else{listSequence++;packSequence++;loading.value=false;building.value=false}})
const labels:Record<string,string>={start:'开始课堂',complete:'结束课堂',pause:'暂停',resume:'继续',change_step:'步骤切换',break_start:'进入课间',break_end:'返回课堂'}
</script>

<template>
  <ElDialog v-model="open" title="参考课堂经验（只读）" width="min(1000px,94vw)">
    <p class="notice">仅显示本人有权限、同教案且正常结束的课堂。最多选择5次；加入参考不会修改教案或调用AI。</p>
    <div class="filters"><label>使用版本<ElInputNumber v-model="historicalVersion" :min="1" placeholder="全部版本"/></label><label>结束日期起<input v-model="from" type="date"/></label><label>结束日期止<input v-model="to" type="date"/></label><ElButton :loading="loading" @click="load(true)">查询</ElButton></div>
    <p v-if="error" role="alert" class="error">{{error}}</p><p v-if="loading">正在加载课堂…</p>
    <div class="run-list"><label v-for="run in items" :key="run.runId" class="run-item"><input type="checkbox" :checked="selected.includes(run.runId)" :disabled="!selected.includes(run.runId)&&selected.length>=5" @change="select(run.runId,($event.target as HTMLInputElement).checked)"/><span><strong>{{run.title}}</strong><small>课堂 #{{run.runId}} · 使用 v{{run.lessonPlanVersion}} · {{new Date(run.endedAt).toLocaleString()}}</small></span><span>{{run.hasFormalSummary?'已有教师确认总结':'仅执行记录'}}</span></label></div>
    <p v-if="!loading&&!items.length&&!error">没有符合条件的历史课堂。</p>
    <div class="actions"><span>已选 {{selected.length}} / 5 · 共 {{total}} 次</span><ElButton :disabled="loading||page<=1" @click="page--;load()">上一页</ElButton><ElButton :disabled="loading||page*10>=total" @click="page++;load()">下一页</ElButton><ElButton :disabled="!selected.length" :loading="building" @click="build">生成只读证据包</ElButton></div>
    <section v-if="pack" class="pack"><h3>证据包预览</h3><p>来源校验标识：{{pack.digest.slice(0,16)}} · {{pack.ruleVersion}}</p><p class="notice">{{pack.usageNotice}}</p>
      <p v-for="warning in pack.warnings" :key="warning" class="warning">{{warning}}</p>
      <article v-for="review in pack.teacherReview" :key="review.runId"><h4>课堂 #{{review.runId}} · {{review.title}}</h4>
        <strong>执行事实（不代表教学效果）</strong><p>记录用时 {{pack.safeFacts.runs.find(r=>r.runId===review.runId)?.recordedElapsedSeconds}} 秒</p>
        <ul><li v-for="fact in pack.safeFacts.runs.find(r=>r.runId===review.runId)?.facts" :key="fact.evidenceId">{{labels[fact.type]||fact.type}} · {{new Date(fact.occurredAt).toLocaleString()}} · {{fact.evidenceId}}</li></ul>
        <details><summary>当时教学步骤</summary><p v-for="step in review.steps" :key="step.historicalStepId">{{step.title}} · 计划 {{step.plannedDurationSeconds}} 秒 · {{step.historyMatched?'已匹配历史版本':'历史对应缺失'}}</p></details>
        <div v-if="review.formalSummary" class="teacher-only"><strong>教师确认意见（仅教师查看，不发送AI）</strong><p>{{review.formalSummary.classroomSummary}}</p><p>{{review.formalSummary.participation}}</p></div><p v-else>暂无教师确认总结。</p>
      </article>
    </section>
    <template #footer><ElButton @click="open=false">取消</ElButton><ElButton type="primary" :disabled="!canAdd||building" @click="add">加入本次备课参考</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.notice,.warning{padding:12px;border-radius:12px;background:#fff3dd;color:#8a653a;line-height:1.6}.filters,.actions{display:flex;align-items:end;flex-wrap:wrap;gap:12px}.filters label{display:grid;gap:6px}.filters input{padding:8px;border:1px solid #eadbcd;border-radius:8px}.run-list{display:grid;gap:8px;margin:16px 0}.run-item{display:flex;align-items:center;gap:14px;border:1px solid #edddce;background:#fffaf5;border-radius:12px;padding:14px}.run-item>span:first-of-type{flex:1;display:grid;gap:6px}.run-item small{color:#85705e}.pack{margin-top:20px}.pack article{padding:16px;border:1px solid #ecdfd4;border-radius:14px;margin-top:12px}.teacher-only{background:#eef7f4;padding:12px;border-radius:10px;margin-top:12px}.teacher-only p{white-space:pre-wrap}.error{color:#b33d38}@media(max-width:650px){.run-item{flex-wrap:wrap}}
</style>
