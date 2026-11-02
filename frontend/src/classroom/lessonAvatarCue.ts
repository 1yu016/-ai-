import type { RunStep } from '@/stores/lessonRun'

/** Read-only text from the authorized, frozen Run step; never execute action config. */
export function lessonAvatarCue(step: Pick<RunStep,'actionConfig'> | null | undefined, avatarName: string): string {
  let actions=step?.actionConfig
  if(typeof actions==='string') {try {actions=JSON.parse(actions)}catch{return ''}}
  if(!Array.isArray(actions))return ''
  const cue=actions.find(action=>action && action.actionType==='voice_instruction' && action.actionName==='speak' && typeof action.content==='string')
  return cue ? cue.content.slice(0,500).replaceAll('{avatarName}',avatarName.trim() || '课堂伙伴') : ''
}
