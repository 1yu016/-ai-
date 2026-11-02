import type { LessonRun } from '@/stores/lessonRun'
import {understandTeaching} from './TeachingLanguage'

type Reply = {message:string; command?:string}
const identity = (r:LessonRun)=>`${r.id}:${r.classId}:${r.deviceId}:${r.currentStepIndex}:${r.status}:${r.breakStartedAt ?? ''}`
/** Teacher-only, read-only lesson replies and bounded proposals. Never writes classroom state. */
export class TeachingCompanion {
  enabled = true
  proposal: {origin:string; version:number; until:number; message:string} | null = null
  private prompted = new Set<string>()
  private alternative = 0
  private deferredUntil = 0
  clear() {this.proposal=null;this.prompted.clear();this.alternative=0;this.deferredUntil=0}
  invalidate() {this.proposal=null}
  private suggest(run:LessonRun): Reply {
    const step = run.steps.find(s=>s.stepIndex===run.currentStepIndex)
    if (!step || !step.title) return {message:'当前正式环节信息不完整，暂时无法给出建议。'}
    const topic = step.content?.trim().slice(0,100) || step.title
    const tip = step.teacherTip?.trim()
    const first=this.alternative++ % 2 === 0
    const task = /声音|听/.test(topic)
      ? first ? `围绕“${topic}”，先听一小段，再请孩子模仿一种声音。` : `围绕“${topic}”，请孩子用一个词描述听到的声音。`
      : /形状|方形|圆形/.test(topic)
        ? first ? `围绕“${topic}”，请孩子用手指在空中画出形状，再找一件相似形状的物品。` : `围绕“${topic}”，请孩子指一指哪里有这种形状，并轮流描述。`
        : first ? `围绕“${topic}”，请孩子先观察，再说一个发现。` : `围绕“${topic}”，给孩子几秒思考，再请一位说说理由。`
    const age=run.ageGroup
    const ageAdvice=age==='3-4'?'先观察，再用一个词表达，不要求完整理由。':age==='4-5'?'先说一个发现，再简单说说原因。':age==='5-6'?'先预测，再观察并说出一个理由。':'使用简短的观察和表达，请教师判断适龄性。'
    const message = `建议（依据本节课“${step.title}”环节${tip?'的教师提示':''}${age?`，当前班级${age}岁`:''}）：${tip?`${tip} `:''}${task} ${ageAdvice}可以先随机请一位孩子回答。采用只会发起点名，不会自动推进环节。${age?'班级年龄来自当前班级资料。':'当前接口未提供年龄，不推断孩子年龄。'}`
    this.proposal={origin:identity(run),version:run.version,until:Date.now()+120000,message}
    return {message}
  }
  proactive(run:LessonRun, quiet:boolean): string | null {
    const key=identity(run)
    if (!this.enabled || !quiet || run.status!=='running' || run.breakStartedAt || this.prompted.has(key) || Date.now()<this.deferredUntil) return null
    const step=run.steps.find(s=>s.stepIndex===run.currentStepIndex)
    if (!step || !(step.teacherTip || step.type==='question' || step.expectedResponse)) return null
    this.prompted.add(key)
    return this.suggest(run).message
  }
  respond(text:string,run:LessonRun): Reply | null {
    const request=understandTeaching(text)
    if (!request || !['lesson','suggest','accept','ignore','later','disable','enable'].includes(request.kind)) return null
    if (request.kind==='disable') {this.enabled=false;this.proposal=null;return {message:'主动建议已关闭。你仍可主动询问。'}}
    if (request.kind==='enable') {this.enabled=true;return {message:'已开启安静的教学建议提示，每个环节最多一次。'}}
    if (request.kind==='ignore' || request.kind==='later') {this.proposal=null;this.prompted.add(identity(run));if(request.kind==='later'){this.deferredUntil=Date.now()+60000;this.prompted.delete(identity(run))}return {message:request.kind==='later'?'已稍后提醒，至少一分钟后且课堂安静时才提示。':'已忽略，本环节不再主动提示。'}}
    if (!['running','paused'].includes(run.status)) {this.proposal=null;return {message:'当前课堂尚未开始或已经结束，请先进入有效课堂。'}}
    if (request.kind==='lesson') {
      const index=run.currentStepIndex+(request.next?1:0)
      const step=run.steps.find(s=>s.stepIndex===index)
      if (!step) return {message:request.next?'这已经是最后一个环节；没有下一环节。':'当前正式步骤信息缺失，无法确定讲到哪里。'}
      const resource=step.resourceId ? '本环节绑定了教学资源，可从资源面板查看。' : '本环节未绑定资源。'
      return {message:`${request.next?'下一环节':'现在'}是《${run.lessonTitle || '未命名课堂'}》的第${index+1}个环节“${step.title}”。${step.content || '没有已保存的环节说明。'}${step.teacherTip?`教师提示：${step.teacherTip}`:''}${resource}${request.next?'尚未切换环节。':''}`}
    }
    if (request.kind==='suggest') {this.prompted.add(identity(run));return this.suggest(run)}
    if (request.kind==='accept') {
      const p=this.proposal;this.proposal=null
      if (!p || p.origin!==identity(run) || p.version!==run.version || Date.now()>p.until) return {message:'没有仍有效的建议，请重新询问；旧建议没有执行。'}
      if (run.status!=='running' || run.breakStartedAt) return {message:'当前状态不能采用点名建议，请恢复教学后重新询问。'}
      return {message:'已采用点名建议，仍需通过课堂操作校验。',command:'随机点名'}
    }
    return null
  }
}
