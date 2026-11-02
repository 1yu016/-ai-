import {describe,it,expect} from 'vitest'
import {lessonAvatarCue} from '@/classroom/lessonAvatarCue'
import {understandTeaching} from '@/classroom/command/TeachingLanguage'
describe('frozen lesson avatar cue',()=>{
  it('reads only saved voice instruction and resolves current identity without changing source',()=>{
    const step={actionConfig:[{actionType:'avatar_action',actionName:'wave'},{actionType:'voice_instruction',actionName:'speak',content:'我是{avatarName}，今天观察种子。'}]}
    const before=JSON.stringify(step)
    expect(lessonAvatarCue(step,'课堂小助手')).toBe('我是课堂小助手，今天观察种子。')
    expect(JSON.stringify(step)).toBe(before)
  })
  it('supports snapshot JSON but does not invent missing script',()=>{
    expect(lessonAvatarCue({actionConfig:'bad json'},'小熊')).toBe('')
    expect(lessonAvatarCue({actionConfig:[]},'小熊')).toBe('')
    expect(lessonAvatarCue({actionConfig:JSON.stringify([{actionType:'voice_instruction',actionName:'speak',content:'观察发芽'}])},'小熊')).toBe('观察发芽')
  })
  it('supports the requested full natural expressions without loosening compound guards',()=>{
    expect(understandTeaching('找一个还没有被点到的小朋友。')).toEqual({kind:'roll',selection:'uncalled'})
    expect(understandTeaching('现在有什么适合孩子们的互动活动？')).toEqual({kind:'suggest'})
    expect(understandTeaching('找一个还没有被点到的小朋友然后奖励')).toEqual({kind:'unclear'})
  })
})
