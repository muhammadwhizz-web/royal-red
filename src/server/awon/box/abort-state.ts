// AWON Box — shared abort state (Phase 4.6).
// A tiny module so consent.ts and ops.ts can both check the kill switch
// without an import cycle. The check happens at THREE points: before a consent
// row is created, after it is created (closes the race where the abort lands
// between the executor's loop check and the row insert), and at every
// executor step.
let globalAbort = false
const abortedRuns = new Set<string>()

export function isAborted(runId: string): boolean {
  return globalAbort || abortedRuns.has(runId)
}

export function markRunAborted(runId: string): void {
  abortedRuns.add(runId)
}

export function setGlobalAbort(v: boolean): void {
  globalAbort = v
}

// test hook: clear per-process state (unit tests only)
export function resetAbortState(): void {
  globalAbort = false
  abortedRuns.clear()
}
