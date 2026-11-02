<script setup lang="ts">
import { computed } from 'vue'
type Action={ actionType:string; actionName:string; content?:string|null; targetStudentId?:number|null }
const props=defineProps<{ actions?:Action[] }>()
const emit=defineEmits<{ update:[actions:Action[]] }>()
const config=computed(()=>{try {const action=props.actions?.find(a=>a.actionType==='child_qa');return action?.content?JSON.parse(action.content):null}catch{return null}})
function change(patch:Record<string,unknown>){const next={seconds:120,policy:'teacher_review',topic:'当前教学主题',...config.value,...patch};emit('update',[...(props.actions??[]).filter(a=>a.actionType!=='child_qa'),{actionType:'child_qa',actionName:'configure',content:JSON.stringify(next)}])}
function toggle(event:Event){if((event.target as HTMLInputElement).checked)change({});else emit('update',(props.actions??[]).filter(a=>a.actionType!=='child_qa'))}
</script>
<template>
 <fieldset class="child-qa-config"><legend>儿童自由问答（教师控制）</legend>
  <label><input type="checkbox" :checked="!!config" aria-label="本环节允许儿童自由问答" @change="toggle">本环节允许儿童自由问答</label>
  <template v-if="config">
   <label>建议时长（30–300秒）<input type="number" :value="config.seconds" min="30" max="300" aria-label="儿童问答建议秒数" @change="change({seconds:Number(($event.target as HTMLInputElement).value)})"></label>
   <label>回答策略<select :value="config.policy" aria-label="儿童问答回答策略" @change="change({policy:($event.target as HTMLSelectElement).value})"><option value="teacher_review">可靠知识卡回答，教师确认后播报</option><option value="teacher_only">全部交由教师回答</option></select></label>
   <label>教学主题范围<input :value="config.topic" maxlength="100" aria-label="儿童问答教学主题" @change="change({topic:($event.target as HTMLInputElement).value})"></label>
  </template>
  <small>保存配置不会开启麦克风；课堂中仍需教师显式开启。未知或风险问题交教师。</small>
 </fieldset>
</template>
<style scoped>.child-qa-config{display:grid;gap:10px;margin-top:12px;border:1px solid #d8e3d5;border-radius:10px;padding:12px}label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}small{color:#74685e}input,select{max-width:100%}</style>
