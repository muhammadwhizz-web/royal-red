// AWON Box — shared abort state (Phase 4.6).
// A tiny module so consent.ts and ops.ts can both check the kill switch
// without an import cycle. The check happens at THREE points: before a consent
// row is created, after it is created (closes the race where the abort lands
// between the executor's loop check and the row insert), and at every
// executor step.
//
// DURABILITY (acceptance re-run finding, Task 21): the flags below live in a
// module-level Set — and Next.js compiles EACH route as its own module graph,
// so the chat route's executor and the desktop abort route can hold DIFFERENT
// copies of this state (a dev hot-reload splits them further). The DB is the
// source of truth: runIsAbortedInDb / recentAbortForSessionInDb back every
// safety check, so an abort is honored even across route/process boundaries.
import { db } from '@/lib/db'

let globalAbort = false
const abortedRuns = new Set<string>()

export function isAborted(runId: string): boolean {
  return globalAbort || abortedRuns.has(runId)
}

// DB-backed abort check: true when the run row itself is 'aborted'. This
// survives hot-reloads, separate route module graphs, and multi-process
// deployments — the in-memory Set only survives within one copy of one bundle.
export async function runIsAbortedInDb(runId: string | null | undefined): Promise<boolean> {
  if (!runId) return false
  try {
    const run = await db.awonRun.findUnique({ where: { id: runId }, select: { status: true } })
    return run?.status === 'aborted'
  } catch {
    return false
  }
}

// DB-backed refuse window: did ANY run of this session hit the kill switch in
// the last 30s? (The in-memory global flag does the same job within one module
// graph; this one works across graphs.)
export async function recentAbortForSessionInDb(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false
  try {
    const recent = await db.awonRun.findFirst({
      where: { sessionId, status: 'aborted', endedAt: { gte: new Date(Date.now() - 30_000) } },
      select: { id: true },
    })
    return recent !== null
  } catch {
    return false
  }
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
