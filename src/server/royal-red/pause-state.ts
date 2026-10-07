// ROYAL RED session pause (Round 4, Phase 5 slice 1) — kill-switch mode 3.
//
// THE THREE VERBS (the directive's contract):
//   1. abort the whole session  -> triggerAbort (the global hammer, unchanged)
//   2. abort one sub-agent      -> abortOneRun (the scalpel, unchanged)
//   3. pause the session        -> THIS MODULE: freeze the loop but keep state
//
// PAUSE SEMANTICS (deliberately narrow and honest):
//   - a paused session stops BEFORE the next step/phase, not mid-call (an
//     in-flight model call or disk op finishes; nothing is interrupted
//     halfway — pause is a graceful freeze)
//   - state is fully preserved: runs stay `running`, pending consents stay
//     `pending` (they keep their own 120s clocks — pause does not extend or
//     freeze them; the user is present, the model waits), journals stay
//     intact, nothing is marked aborted
//   - resume continues exactly where the freeze landed
//   - the kill switch still wins over a pause: aborting a paused session
//     aborts it normally (abort is checked inside the pause wait loop)
//
// Pause is per-session. It is a user action (DESKTOP panel), audited, and it
// is NOT reachable by any agent prompt — the model cannot pause itself to
// dodge the consent clock.

const pausedSessions = new Set<string>()

export function pauseSession(sessionId: string): boolean {
  if (pausedSessions.has(sessionId)) return false
  pausedSessions.add(sessionId)
  return true
}

export function resumeSession(sessionId: string): boolean {
  return pausedSessions.delete(sessionId)
}

export function isPaused(sessionId: string): boolean {
  return pausedSessions.has(sessionId)
}

export function listPausedSessions(): string[] {
  return [...pausedSessions]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait while the session is paused. Returns:
 *   - 'resumed'  -> pause lifted; caller continues normally
 *   - 'aborted'  -> the run was aborted while paused (kill switch wins);
 *                   caller must stop
 * Poll cadence 250ms — pause takes effect at step boundaries, which is the
 * documented contract (nothing is interrupted mid-operation).
 */
export async function waitWhilePaused(sessionId: string, isAborted: () => boolean): Promise<'resumed' | 'aborted'> {
  while (isPaused(sessionId)) {
    if (isAborted()) return 'aborted'
    await sleep(250)
  }
  return isAborted() ? 'aborted' : 'resumed'
}

// test hook
export function resetPauseState(): void {
  pausedSessions.clear()
}
