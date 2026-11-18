import {describe,it,expect,vi,afterEach} from 'vitest'
import {TeachingCompanion} from '@/classroom/command/TeachingCompanion'
import type {LessonRun} from '@/stores/lessonRun'
const run=()=>({id:3,classId:1,deviceId:2,version:7,status:'running',currentStepIndex:0,lessonTitle:'种子的旅行',ageGroup:'3-4',steps:[{stepIndex:0,title:'观察发芽',content:'观察种子发芽需要的条件',type:'question',teacherTip:'让孩子猜一猜',resourceId:null},{stepIndex:1,title:'比较叶子',content:'观察叶子不同',type:'activity',resourceId:8}]} as unknown as LessonRun)
describe('lesson-aware bounded teaching advice',()=>{
  afterEach(()=>vi.useRealTimers())
  it('reads actual frozen step and next question never advances',()=>{
    const c=new TeachingCompanion(),r=run()
    expect(c.respond('我们现在讲到哪里了？',r)?.message).toContain('观察发芽')
    expect(c.respond('下一步要做什么？',r)).toMatchObject({message:expect.stringContaining('比较叶子')})
    expect(r.currentStepIndex).toBe(0)
  })
  it('age-specific advice is a proposal, only explicit adoption returns a legal command',()=>{
    const c=new TeachingCompanion(),r=run()
    const suggestion=c.respond('有什么适合现在的小活动？',r)
    expect(suggestion?.message).toContain('一个词');expect(suggestion?.command).toBeUndefined()
    expect(c.respond('好，就按这个来。',r)?.command).toBe('随机点名')
    expect(c.respond('好，就按这个来。',r)?.command).toBeUndefined()
  })
  it.each(['version','id','deviceId','currentStepIndex'] as const)('changed %s invalidates adoption',key=>{
    const c=new TeachingCompanion(),r=run();c.respond('有什么互动建议',r)
    r[key]++
    expect(c.respond('采用建议',r)?.command).toBeUndefined()
  })
  it('expired, paused or ignored proposal cannot execute',()=>{
    vi.useFakeTimers();const c=new TeachingCompanion(),r=run();c.respond('有什么互动建议',r)
    vi.advanceTimersByTime(120001);expect(c.respond('采用建议',r)?.command).toBeUndefined()
    c.respond('有什么互动建议',r);c.respond('忽略建议',r);expect(c.respond('采用建议',r)?.command).toBeUndefined()
    c.respond('有什么互动建议',r);r.status='paused';expect(c.respond('采用建议',r)?.command).toBeUndefined()
  })
  it('one quiet prompt per step; off and busy remain silent',()=>{
    const c=new TeachingCompanion(),r=run()
    expect(c.proactive(r,false)).toBeNull();expect(c.proactive(r,true)).toBeTruthy();expect(c.proactive(r,true)).toBeNull()
    c.respond('关闭主动建议',r);r.currentStepIndex=1;expect(c.proactive(r,true)).toBeNull()
  })
})
