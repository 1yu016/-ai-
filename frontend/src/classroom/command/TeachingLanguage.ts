/** Finite, anchored classroom grammar. No fuzzy keyword-to-action conversion. */
export type TeachingRequest =
  | { kind: 'roll'; selection: 'random' | 'uncalled' | 'another' }
  | { kind: 'unknownSpeech' }
  | { kind: 'reward'; name: string; stars: number }
  | { kind: 'lesson'; next: boolean }
  | { kind: 'suggest' | 'accept' | 'ignore' | 'later' | 'disable' | 'enable' | 'stop' }
  | { kind: 'unclear' }

export function teachingText(raw: string): string {
  return raw.trim().replace(/^[\s]*(?:小星|你好小助手|你好，小助手)[，,\s]*/, '').replace(/[，。！、,.!\s]/g, '')
}
export function understandTeaching(raw: string): TeachingRequest | null {
  const t = teachingText(raw)
  if (['停止听我说话', '停止收听', '停止听指令', '取消'].includes(t)) return {kind:'stop'}
  if (['我们现在讲到哪里了', '现在讲到哪了', '现在上到哪里了', '当前是什么环节', '我们现在讲到哪里了？'].includes(t)) return {kind:'lesson',next:false}
  if (/^(?:下一步|下一个环节)(?:要做什么|是什么|讲什么)[？?]?$/.test(t)) return {kind:'lesson',next:true}
  if (/^(?:有什么适合现在的小活动|现在有什么适合孩子们的互动活动|有什么互动建议|给我一个教学建议|还有其他建议|换个建议|孩子们好像累了)[？?]?$/.test(t)) return {kind:'suggest'}
  if (['好就按这个来', '采用建议', '好', '同意这个建议'].includes(t)) return {kind:'accept'}
  if (['忽略建议', '不要这个建议'].includes(t)) return {kind:'ignore'}
  if (['稍后提醒', '稍后提醒我'].includes(t)) return {kind:'later'}
  if (['关闭主动建议', '开启主动建议'].includes(t)) return {kind:t.startsWith('关闭')?'disable':'enable'}
  // Reject alternatives, conditional, reported and compound requests before matching actions.
  if (/[？?]|不要|先别|不用|如果|假如|还是|或者|然后|他说|她说|老师说|能不能|要不要/.test(t)) return {kind:'unclear'}
  if (/^(?:找|选|挑|叫)(?:一个|一位|个)?(?:今天|本节课)?(?:还没被点到|还没有被点到|没有被点名|未被点名|还没被点名)的(?:孩子|小朋友|学生)$/.test(t)) return {kind:'roll',selection:'uncalled'}
  if (/^(?:从)?(?:还没回答过|没有发过言|还没发言)的(?:孩子|小朋友|学生)(?:里)?(?:选|找|挑)(?:一个|一位)$/.test(t)) return {kind:'unknownSpeech'}
  if (['再来一个', '再请一位', '再挑一位小朋友', '再叫一个'].includes(t)) return {kind:'roll',selection:'another'}
  if (/^(?:(?:请|帮我)?(?:随机|随便)?(?:叫|找|选|挑|点|请)(?:一个|一位|个|一|位)?(?:孩子|小朋友|人|学生)(?:来)?(?:回答|试试)?|随便点个人|随机点名)$/.test(t)) return {kind:'roll',selection:'random'}
  const r = t.match(/^(?:也)?给(.+?)([一二两三四五1-5])(?:颗星星|颗星|朵小红花|朵红花)$/)
  if (r) return {kind:'reward',name:r[1]!,stars:Number(r[2]) || ({一:1,二:2,两:2,三:3,四:4,五:5} as Record<string,number>)[r[2]!]!}
  return null
}
