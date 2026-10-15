/** Visual projection only: never starts playback or changes classroom state. */
export type ScreenDisplayMode = 'speaker' | 'resource' | 'interaction'

export function resolveScreenDisplayMode(input: {
  resourceVisible: boolean
  interactionVisible: boolean
  override?: ScreenDisplayMode
}): ScreenDisplayMode {
  // An open resource must remain unobstructed even during an interaction.
  if (input.resourceVisible) return 'resource'
  if (input.override) return input.override
  return input.interactionVisible ? 'interaction' : 'speaker'
}
