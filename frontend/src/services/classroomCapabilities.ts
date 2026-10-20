import type { ClassroomCommandOperation } from './classroomCommandBus'

/** Exact server identifiers; not button labels or a client phase policy. */
export function commandCapability(operation: ClassroomCommandOperation): string | null {
  if (['previous_step', 'next_step', 'switch_step'].includes(operation)) return 'change_step'
  if (['stop_media', 'pause_media', 'mute'].includes(operation)) return 'safe_stop'
  if (['previous_page', 'next_page', 'zoom_in', 'zoom_out', 'set_volume'].includes(operation)) return 'media_control'
  if (['random_roll_call', 'specified_roll_call', 'group_roll_call'].includes(operation)) return 'roll_call'
  const map: Partial<Record<ClassroomCommandOperation, string>> = {
    pause_class: 'pause', resume_class: 'resume', complete_class: 'complete', cancel_class: 'cancel',
    start_break: 'start_break', end_break: 'end_break', reward_student: 'reward', revoke_reward: 'reward_revoke',
    speak_text: 'tts', update_presentation_queue: 'queue_edit', open_resource: 'resource_start',
    play_resource: 'resource_start', resume_media: 'resource_start', set_presentation: 'resource_start',
    unmute: 'resource_start', display_artwork: 'resource_start',
  }
  return map[operation] ?? null
}
