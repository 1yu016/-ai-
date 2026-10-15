import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LessonReferenceSelector from '@/components/LessonReferenceSelector.vue'
import { lessonEvidenceApi, type EvidencePack } from '@/api/lessonEvidence'
vi.mock('@/api/lessonEvidence',()=>({lessonEvidenceApi:{list:vi.fn(),build:vi.fn()}}))
const run=(id:number)=>({runId:id,title:`参考课堂${id}`,lessonPlanVersion:1,startedAt:null,endedAt:'2026-10-14T09:00:00Z',hasFormalSummary:false})
const pack:EvidencePack={schemaVersion:1,ruleVersion:'v1',targetLessonPlanId:3,baseVersion:2,digest:'123456789abcdef',generatedAt:'2026-10-14',warnings:[],usageNotice:'不调用AI',sourceManifest:[],safeFacts:{runs:[]},teacherReview:[]}
const mounted:Array<ReturnType<typeof mount>>=[]
async function setup(){
  const wrapper=mount(LessonReferenceSelector,{props:{planId:3,baseVersion:2,open:false},global:{stubs:{ElDialog:{template:'<div><slot/><slot name="footer"/></div>'}}}})
  mounted.push(wrapper);await wrapper.setProps({open:true});await flushPromises();return wrapper
}
describe('read-only classroom references',()=>{
  beforeEach(()=>{vi.mocked(lessonEvidenceApi.list).mockReset().mockResolvedValue({data:{items:[run(21),run(22)],total:2,page:1,pageSize:10}} as never);vi.mocked(lessonEvidenceApi.build).mockReset().mockResolvedValue({data:pack} as never)})
  afterEach(()=>{mounted.splice(0).forEach(w=>w.unmount())})
  it('only builds the selected IDs and emits a local pack after explicit confirmation',async()=>{
    const w=await setup();await w.find('input[type="checkbox"]').setValue(true)
    await w.findAll('button').find(b=>b.text()==='生成只读证据包')!.trigger('click');await flushPromises()
    expect(lessonEvidenceApi.build).toHaveBeenCalledWith(3,{baseVersion:2,runIds:[21]})
    expect(w.emitted('selected')).toBeUndefined()
    await w.findAll('button').find(b=>b.text()==='加入本次备课参考')!.trigger('click')
    expect(w.emitted('selected')?.[0]?.[0]).toEqual(pack)
  })
  it('limits selection to five without automatically generating anything',async()=>{
    vi.mocked(lessonEvidenceApi.list).mockResolvedValueOnce({data:{items:Array.from({length:6},(_,i)=>run(i+1)),total:6}} as never)
    const w=await setup();for(const checkbox of w.findAll('input[type="checkbox"]').slice(0,5))await checkbox.setValue(true)
    expect(w.findAll('input[type="checkbox"]')[5]!.attributes('disabled')).toBeDefined()
    expect(lessonEvidenceApi.build).not.toHaveBeenCalled()
  })
  it('does not show an old pack after the teacher changes selection',async()=>{
    const w=await setup();await w.findAll('input[type="checkbox"]')[0]!.setValue(true)
    let resolve!:(value:unknown)=>void
    vi.mocked(lessonEvidenceApi.build).mockImplementationOnce(()=>new Promise(r=>{resolve=r}) as never)
    await w.findAll('button').find(b=>b.text()==='生成只读证据包')!.trigger('click')
    await w.findAll('input[type="checkbox"]')[1]!.setValue(true);resolve({data:pack});await flushPromises()
    expect(w.text()).not.toContain('证据包预览')
    expect(w.findAll('button').find(b=>b.text()==='加入本次备课参考')!.attributes('disabled')).toBeDefined()
  })
  it('clears the pack on a base version change and displays permission failures',async()=>{
    const w=await setup();await w.find('input[type="checkbox"]').setValue(true)
    vi.mocked(lessonEvidenceApi.build).mockRejectedValueOnce(new Error('denied'))
    await w.findAll('button').find(b=>b.text()==='生成只读证据包')!.trigger('click');await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    await w.setProps({baseVersion:3});await flushPromises()
    expect(w.find('input[type="checkbox"]').element).toHaveProperty('checked',false)
  })
})
