/** Ephemeral, text/audio/token-free diagnostics; no network upload or stored child data. */
export function dialoguePerformance(stage: string, details: Record<string, number | string> = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('classroom-dialogue-performance', {
    detail: { stage, atMs: performance.now(), ...details },
  }))
}
