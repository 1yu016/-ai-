import {describe,it,expect} from 'vitest'
import {understandTeaching} from '@/classroom/command/TeachingLanguage'
describe('restricted natural teaching grammar',()=>{
  it.each(['小星，随机叫一个孩子。','找一位小朋友回答。','随便点个人。','请一个孩子来试试。','找个人来回答。'])('same random intention: %s',text=>expect(understandTeaching(text)).toEqual({kind:'roll',selection:'random'}))
  it.each(['小星，找一个还没被点到的孩子。','找个今天还没被点到的孩子。'])('uncalled is distinct: %s',text=>expect(understandTeaching(text)).toEqual({kind:'roll',selection:'uncalled'}))
  it('does not invent speech records',()=>expect(understandTeaching('从还没回答过的孩子里选一个。')).toEqual({kind:'unknownSpeech'}))
  it.each(['不要随机叫一个孩子','如果找个人来回答','点名还是奖励','老师说随机点名','随机点名然后奖励'])('uncertain must clarify: %s',text=>expect(understandTeaching(text)?.kind).toBe('unclear'))
  it('keeps questions read only',()=>expect(understandTeaching('下一步要做什么？')).toEqual({kind:'lesson',next:true}))
  it('ordinary conversation is not an action',()=>expect(understandTeaching('今天我们认识数字一')).toBeNull())
})
