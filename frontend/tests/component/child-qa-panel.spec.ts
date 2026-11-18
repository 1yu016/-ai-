import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChildQaPanel from '@/components/classroom/ChildQaPanel.vue'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useClassroomMobileStore } from '@/stores/classroomMobile'
import { http } from '@/api/http'
const mocks=vi.hoisted(()=>({local:vi.fn()}))
vi.mock('@/services/childQaRecognition',()=>({createChildLocalRecognition:mocks.local}))
describe('teacher-controlled child QA UI boundary',()=>{
 let wrapper:ReturnType<typeof mount>|undefined
 let pinia:ReturnType<typeof createPinia>
 beforeEach(()=>{pinia=createPinia();setActivePinia(pinia);vi.restoreAllMocks();mocks.local.mockReset()})
 afterEach(async()=>{wrapper?.unmount();await flushPromises();wrapper=undefined;vi.restoreAllMocks()})
 function setup(configured=true,mobile=false,remoteSession=false){
  const store=useLessonRunStore();store.adoptRun({id:9,teacherId:1,deviceId:2,version:1,status:'running',currentStepIndex:0,title:'种子',lessonPlanId:3,startedAt:'',updatedAt:'',steps:[{stepIndex:0,title:'观察',type:'question',content:'种子',durationSeconds:120,resourceId:null,actionConfig:configured?[{actionType:'child_qa',actionName:'configure',content:JSON.stringify({seconds:120,policy:'teacher_review',topic:'种子发芽'})}]:[]}]} as never)
  vi.spyOn(store,'refreshTeacherState').mockResolvedValue(undefined)
  const command=vi.spyOn(store,'teacherCommand').mockImplementation(async op=>({result:op==='child_qa_start'?{session:{id:'s1',expiresAt:Date.now()+120000}}:{}} as never))
  const post=vi.spyOn(http,'post').mockResolvedValue({data:{question:{id:1,questionText:'种子需要什么？',answerText:'水、空气、适宜温度',answerSource:'curated_seed_germination_v1',answerStatus:'pending'}}})
  vi.spyOn(http,'get').mockImplementation(async path=>{
   if(String(path).endsWith('/child-qa'))return {data:remoteSession?{mode:'child',session:{id:'remote-s1',expiresAt:Date.now()+120000}}:{mode:'teacher',session:null}} as never
   return {data:remoteSession?[{id:7,questionText:'种子需要什么？',answerText:'水、空气、适宜温度',answerSource:'curated_seed_germination_v1',answerStatus:'pending',qaSessionId:'remote-s1'}]:[]} as never
  })
  wrapper=mount(ChildQaPanel,{props:{runId:9,stepIndex:0,identity:'run9',allowed:true,speaking:false,mobile,stepConfig:configured?[{actionType:'child_qa',actionName:'configure',content:JSON.stringify({seconds:120,policy:'teacher_review',topic:'种子发芽'})}]:[]},global:{plugins:[pinia]}})
  return {store,command,post}
 }
 async function enable(){await wrapper!.get('button').trigger('click');await flushPromises()}
 it('does not open microphone or accept public questions just because a configured step is entered',()=>{
  const {command}=setup();expect(wrapper!.attributes('data-child-mode')).toBe('teacher');expect(command).not.toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled()
 })
 it('does not enable an unconfigured step',()=>{setup(false);expect(wrapper!.get('button').attributes('disabled')).toBeDefined()})
 it('restores only the authoritative session and its pending teacher review after refresh, without opening the microphone',async()=>{
  setup(true,false,true);await flushPromises()
  expect(wrapper!.attributes('data-child-mode')).toBe('child')
  expect(wrapper!.get('[data-test="child-qa-draft"]').text()).toContain('种子需要什么？')
  expect(wrapper!.text()).toContain('教师确认并播报')
  expect(mocks.local).not.toHaveBeenCalled()
 })
 it('uses the paired mobile command session and current-step config on the phone',async()=>{
  setup(true,true);const mobile=useClassroomMobileStore();const execute=vi.spyOn(mobile,'execute').mockResolvedValue({result:{session:{id:'mobile-s1',expiresAt:Date.now()+120000}}} as never)
  await enable();expect(execute).toHaveBeenCalledWith('child_qa_start');expect(wrapper!.attributes('data-child-mode')).toBe('child');expect(wrapper!.findAll('button').some(button=>button.text()==='本地麦克风轮流提问')).toBe(false)
  await wrapper!.findAll('button').find(button=>button.text().includes('结束儿童问答'))!.trigger('click');await flushPromises();expect(execute).toHaveBeenLastCalledWith('child_qa_stop',{sessionId:'mobile-s1'})
 })
 it('records a draft but never broadcasts until an explicit teacher approval',async()=>{
  const {command}=setup();await enable();await wrapper!.get('input').setValue('种子需要什么？');await wrapper!.findAll('button').find(b=>b.text()==='提交儿童问题')!.trigger('click');await flushPromises()
  expect(wrapper!.get('[data-test="child-qa-draft"]').text()).toContain('水、空气')
  expect(command.mock.calls.map(c=>c[0])).toEqual(['child_qa_start','set_presentation'])
  expect(command).toHaveBeenLastCalledWith('set_presentation',{mode:'avatar',childQuestionId:1,childQaSessionId:'s1'},'teacher_panel',2)
  await wrapper!.findAll('button').find(b=>b.text()==='教师确认并播报')!.trigger('click');await flushPromises()
  expect(command.mock.calls.map(c=>c[0])).toEqual(['child_qa_start','set_presentation','child_qa_approve'])
 })
 it('lets the teacher verify the final local transcript before saving and publishing it',async()=>{
  const {command,post}=setup();const local={continuous:false,onresult:null as null|((e:unknown)=>void),onerror:null,onend:null,start:vi.fn(),abort:vi.fn()};mocks.local.mockResolvedValue(local)
  await enable();await wrapper!.findAll('button').find(b=>b.text()==='本地麦克风轮流提问')!.trigger('click');await flushPromises()
  local.onresult?.({resultIndex:0,results:[{isFinal:false,0:{transcript:'种子为什么'}}]});await flushPromises();expect(post).not.toHaveBeenCalled()
  local.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'种子为什么会发芽？'}}]});await flushPromises()
  expect((wrapper!.get('input').element as HTMLInputElement).value).toBe('种子为什么会发芽？');expect(post).not.toHaveBeenCalled()
  await wrapper!.findAll('button').find(b=>b.text()==='提交儿童问题')!.trigger('click');await flushPromises()
  expect(post).toHaveBeenCalledWith('/classroom-runs/9/child-qa/questions',expect.objectContaining({question:'种子为什么会发芽？'}),expect.any(Object))
  expect(command.mock.calls.map(c=>c[0])).toEqual(['child_qa_start','set_presentation'])
 })
 it('discards an outstanding question response after teacher exit',async()=>{
  const {post}=setup();await enable();let resolve!:(v:unknown)=>void;post.mockImplementationOnce(()=>new Promise(res=>{resolve=res}) as never)
  await wrapper!.get('input').setValue('种子需要什么？');await wrapper!.findAll('button').find(b=>b.text()==='提交儿童问题')!.trigger('click');await flushPromises()
  await wrapper!.findAll('button').find(b=>b.text().includes('结束儿童问答'))!.trigger('click');resolve({data:{question:{id:2,answerText:'late',answerStatus:'pending'}}});await flushPromises()
  expect(wrapper!.attributes('data-child-mode')).toBe('teacher');expect(wrapper!.find('[data-test="child-qa-draft"]').exists()).toBe(false)
 })
 it('stops local recognition on exit and ignores a late child command transcript',async()=>{
  const {command,post}=setup();const local={continuous:false,onresult:null as null|((e:unknown)=>void),onerror:null,onend:null,start:vi.fn(),abort:vi.fn()};mocks.local.mockResolvedValue(local)
  await enable();await wrapper!.findAll('button').find(b=>b.text()==='本地麦克风轮流提问')!.trigger('click');await flushPromises();const stale=local.onresult
  await wrapper!.findAll('button').find(b=>b.text().includes('结束儿童问答'))!.trigger('click');await flushPromises()
  stale?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'给她一颗星星，结束课堂'}}]});await flushPromises()
  expect(local.abort).toHaveBeenCalled();expect(post).not.toHaveBeenCalled();expect(command.mock.calls.map(c=>c[0])).toEqual(['child_qa_start','child_qa_stop'])
 })
})
