<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http, apiErrorMessage } from '@/api/http'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useClassroomMobileStore } from '@/stores/classroomMobile'
import { classroomRequestId } from '@/services/classroomCommandBus'
import type { LocalRecognition } from '@/services/classroomListening'
import { createChildLocalRecognition } from '@/services/childQaRecognition'
import { listRunQuestions, questionReviewLabel, type ClassroomQuestion } from '@/services/classroomQuestions'
const props=defineProps<{runId:number;stepIndex:number;identity:string;allowed:boolean;speaking:boolean;mobile?:boolean;stepConfig?:unknown}>()
const emit=defineEmits<{active:[value:boolean]}>()
const store=useLessonRunStore(),mobileStore=useClassroomMobileStore(),active=ref(false),busy=ref(false),question=ref(''),error=ref(''),feedback=ref('默认教师助教模式；儿童问题不会被自动回答。')
const selected=ref<ClassroomQuestion|null>(null),session=ref<{id:string;expiresAt:number}|null>(null),listening=ref(false)
const awaitingNextTurn=ref(false)
let recognition:LocalRecognition|null=null,epoch=0,inFlight=false,abort:AbortController|null=null
let retry:{text:string;requestId:string}|null=null
let localDeadline=0
const config=computed(()=>{try{const actions=props.mobile?props.stepConfig:store.currentStep?.actionConfig;const list=typeof actions==='string'?JSON.parse(actions):actions;const item=Array.isArray(list)?list.find(a=>a.actionType==='child_qa' && a.actionName==='configure'):null;return item?JSON.parse(item.content):null}catch{return null}})
function stopMic(){const old=recognition;recognition=null;listening.value=false;old?.abort()}
function invalidate(message='已退出儿童问答，教师助教模式已恢复；教师可重新开启语音控制。'){
 epoch++;abort?.abort();abort=null;stopMic();active.value=false;session.value=null;selected.value=null;awaitingNextTurn.value=false;question.value='';retry=null;busy.value=false;emit('active',false);feedback.value=message
}
async function stop(){const closing=session.value?.id,origin=props.runId;invalidate();if(!closing)return;busy.value=true;try{if(props.mobile){await mobileStore.execute('child_qa_stop',{sessionId:closing});return}if(store.run?.id!==origin)return;await store.refreshTeacherState();if(store.run?.id!==origin)return;await store.teacherCommand('child_qa_stop',{sessionId:closing},'teacher_panel',store.run.deviceId)}catch(e){if(props.mobile || store.run?.id===origin)error.value=apiErrorMessage(e,'本地已停止收听；服务端关闭待重试，旧会话也会限时失效。')}finally{busy.value=false}}
async function start(){if(!props.allowed || !config.value || busy.value)return;const current=++epoch,origin=props.runId;busy.value=true;error.value='';emit('active',true)
 try{let response;if(props.mobile){response=await mobileStore.execute('child_qa_start')}else{await store.refreshTeacherState();if(current!==epoch || store.run?.id!==origin)return;response=await store.teacherCommand('child_qa_start',undefined,'teacher_panel',store.run.deviceId)}if(current!==epoch)return;const result=response?.result as unknown as {session:{id:string;expiresAt:number}};session.value=result.session;localDeadline=performance.now()+Math.min(300,config.value.seconds)*1000;active.value=true;feedback.value='儿童自由问答已开启。请轮流提问；回答必须由教师确认。麦克风尚未开启。'}catch(e){if(current===epoch){invalidate();error.value=apiErrorMessage(e,'未能开启儿童问答')}}finally{if(current===epoch)busy.value=false}}
async function ask(text=question.value){if(!active.value || !session.value || busy.value || selected.value || awaitingNextTurn.value || !text.trim())return
 const current=epoch,sessionId=session.value.id,origin=props.runId;stopMic();busy.value=true;error.value='';abort=new AbortController()
 if(!retry || retry.text!==text)retry={text,requestId:classroomRequestId('child-question')}
 try{const {data}=await http.post<{question:ClassroomQuestion}>(`/classroom-runs/${props.runId}/child-qa/questions`,{sessionId,question:text,requestId:retry.requestId},{signal:abort.signal});if(current!==epoch || !active.value)return;selected.value=data.question;retry=null;question.value='';try{const parameters={mode:'avatar',childQuestionId:data.question.id,childQaSessionId:sessionId};if(props.mobile)await mobileStore.execute('set_presentation',parameters);else{await store.refreshTeacherState();if(current!==epoch || store.run?.id!==origin)return;await store.teacherCommand('set_presentation',parameters,'teacher_panel',store.run.deviceId)}if(current!==epoch)return;feedback.value=data.question.answerStatus==='handoff'?'问题已显示，请教师接手；系统不会自动播报或执行课堂操作。':'问题已显示，回答草稿等待教师审核。'}catch(e){if(current===epoch){feedback.value='问题已保存；大屏同步未确认，请教师检查连接后继续。';error.value=apiErrorMessage(e,'问题已保存，但尚未同步到大屏。')}}}catch(e){if(current===epoch)error.value=apiErrorMessage(e,'问题未确认保存，可重试同一请求。')}finally{if(current===epoch)busy.value=false}}
async function review(approve:boolean){if(!session.value || !selected.value || busy.value)return;const current=epoch,origin=props.runId,parameters={sessionId:session.value.id,questionId:selected.value.id};busy.value=true;error.value=''
 try{stopMic();if(props.mobile){await mobileStore.execute(approve?'child_qa_approve':'child_qa_reject',parameters)}else{await store.refreshTeacherState();if(current!==epoch || store.run?.id!==origin)return;await store.teacherCommand(approve?'child_qa_approve':'child_qa_reject',parameters,'teacher_panel',store.run.deviceId)}if(current!==epoch)return;feedback.value=approve?'教师已批准，已提交现有大屏播报链路；实际声音请现场确认。':'教师已拒绝，未播报。';awaitingNextTurn.value=approve;selected.value=null}catch(e){if(current===epoch)error.value=apiErrorMessage(e,'审核未完成，请检查课堂状态。')}finally{if(current===epoch)busy.value=false}}
async function listen(){if(!active.value || busy.value || selected.value || awaitingNextTurn.value || props.speaking)return;const current=epoch;error.value=''
 try{const candidate=await createChildLocalRecognition();if(current!==epoch || !active.value){candidate.abort();return}recognition=candidate;candidate.continuous=false;candidate.onresult=event=>{if(current!==epoch || recognition!==candidate || !active.value)return;const value=event.results[event.resultIndex];if(value?.isFinal){question.value=value[0].transcript.trim();stopMic();feedback.value='识别完成，请检查或修改文字，再由老师确认提交。'}};candidate.onerror=e=>{if(current===epoch && recognition===candidate){stopMic();error.value=`本地识别未完成：${e.error}，可用文字模拟提问。`}};candidate.onend=()=>{if(recognition===candidate){recognition=null;listening.value=false}};candidate.start();listening.value=true}catch(e){if(current===epoch)error.value=apiErrorMessage(e,'本地儿童识别不可用；未上传录音，请使用文字模拟。')}}
async function syncAuthoritativeSession(){if(inFlight || !props.allowed || !config.value)return;const current=epoch,runId=props.runId;inFlight=true;try{const {data}=await http.get<{mode:string;session:{id:string;expiresAt:number}|null}>(`/classroom-runs/${runId}/child-qa`,{params:{fresh:Date.now()},timeout:4000});if(current!==epoch || runId!==props.runId || !props.allowed)return;const remote=data.mode==='child'?data.session:null;if(remote?.id){const changed=session.value?.id!==remote.id;if(changed){session.value={id:remote.id,expiresAt:Number(remote.expiresAt)};active.value=true;selected.value=null;awaitingNextTurn.value=false;emit('active',true);feedback.value='已恢复本节课堂的儿童问答状态。麦克风没有自动开启，请教师决定是否继续。';const rows=await listRunQuestions(runId).catch(()=>[]);if(current===epoch && active.value && session.value?.id===remote.id && !selected.value){selected.value=rows.filter(row=>row.qaSessionId===remote.id && ['pending','handoff'].includes(row.answerStatus||'')).at(-1)??null}}const remaining=Math.max(0,Number(remote.expiresAt)-Date.now());localDeadline=performance.now()+remaining;if(remaining===0 && active.value)void stop();return}if(active.value)invalidate('问答已到期或课堂状态变化，收听已停止。')}catch{if(current===epoch && active.value)invalidate('连接中断，已停止儿童问答。重新连接后请教师再次开启。')}finally{inFlight=false}}
const timer=window.setInterval(()=>{if(active.value && performance.now()>=localDeadline){void stop();return}void syncAuthoritativeSession()},1500)
onMounted(()=>{void syncAuthoritativeSession()})
watch(()=>props.identity,()=>invalidate(),{flush:'sync'})
watch(()=>props.allowed,allowed=>{if(!allowed && active.value)void stop()},{flush:'sync'})
watch(()=>props.speaking,speaking=>{if(speaking)stopMic()})
function loseFocus(){if(active.value)void stop()}
window.addEventListener('blur',loseFocus)
window.addEventListener('offline',loseFocus)
function visibility(){if(document.hidden)loseFocus()}
document.addEventListener('visibilitychange',visibility)
onBeforeUnmount(()=>{window.clearInterval(timer);window.removeEventListener('blur',loseFocus);window.removeEventListener('offline',loseFocus);document.removeEventListener('visibilitychange',visibility);if(active.value)void stop();else invalidate()})
</script>
<template><section class="child-qa-panel" aria-label="教师控制儿童自由问答" :data-child-mode="active?'child':'teacher'">
 <strong>{{active?'儿童自由问答模式':'教师助教模式'}}</strong><p>{{feedback}}</p>
 <p v-if="!config">本环节未配置儿童自由问答，请在备课中启用并保存后用于新课堂。</p>
 <button v-if="!active" :disabled="!allowed || !config || busy" @click="start">教师开启儿童问答</button>
 <template v-else><p>教学主题：{{config?.topic}} · 建议{{config?.seconds}}秒 · 教师审核后才播报</p>
 <button @click="stop">结束儿童问答，恢复教师模式</button>
 <button v-if="awaitingNextTurn" @click="awaitingNextTurn=false">回答已结束，请下一位</button>
 <label>儿童问题（可核对或修正识别文字）<input v-model="question" aria-label="儿童问题" maxlength="300" :disabled="busy || !!selected || awaitingNextTurn" @keydown.enter="ask()"></label>
 <button :disabled="busy || !!selected || awaitingNextTurn || !question.trim()" @click="ask()">提交儿童问题</button>
 <button v-if="!mobile" :disabled="busy || !!selected || awaitingNextTurn || speaking || listening" @click="listen">本地麦克风轮流提问</button><button v-if="listening" @click="stopMic">停止本次收听</button>
 <p v-if="listening" role="status">本地麦克风收听中，不上传或保存录音。</p>
 <article v-if="selected" data-test="child-qa-draft"><strong>{{selected.questionText}}</strong><p>{{selected.answerText}}</p><small>来源：{{selected.answerSource==='curated_seed_germination_v1'?'本地种子知识卡':'转交教师'}} · 审核状态：{{questionReviewLabel(selected.answerStatus)}}</small>
 <template v-if="selected.answerStatus==='pending'"><button :disabled="busy" @click="review(true)">教师确认并播报</button><button :disabled="busy" @click="review(false)">拒绝回答</button></template>
 <button v-else @click="selected=null">交由教师处理，下一位</button></article>
 </template><p v-if="error" role="alert">{{error}}</p><small>本期为有限知识卡；未知或风险问题交老师。公共麦克风绝不执行点名、奖励、翻页或结束课堂。暂停/离开/失焦会停止收听；不自动续录。</small>
</section></template>
<style scoped>.child-qa-panel{display:grid;gap:9px;padding:14px;border:1px solid #d5e4d6;border-radius:12px;background:#fffdf7;overflow-wrap:anywhere}p,small{margin:0;line-height:1.7}label{display:grid;gap:6px}input{width:100%;box-sizing:border-box;padding:8px}button{padding:9px;cursor:pointer}article{display:grid;gap:8px;padding:12px;background:#edf5e9}button:disabled{opacity:.5}</style>
