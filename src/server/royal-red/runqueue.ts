// ROYAL RED run queue — the process table for N concurrent runs per session
// (Round 3 Phase-5 groundwork; the directive's "run-queue abstraction").
//
// WHAT THIS IS
//   A registry + control plane that lets MORE THAN ONE run exist per session
//   without any run being able to interfere with another:
//     - the process table tracks every live run (id, session, status, age)
//     - abortOneRun() stops exactly one run (per-run abort path) while its
//       siblings keep executing — the executor's per-step isAborted() check
//       makes this safe with zero coordination
//     - the GLOBAL kill switch (triggerAbort in box/ops.ts) remains the
//       sledgehammer: it aborts everything, freezes every pending consent and
//       opens the 30s refuse window. abortOneRun is a scalpel and shares no
//       state with the consent freeze.
//
// WHAT THIS IS NOT (per the Round 2 freeze, still in force)
//   This is NOT Phase 5. No sub-agents, no planner, no critic team. This
//   module only makes the RUN a first-class, countable, individually-stoppable
//   unit so that Phase 5 is safe when (and only when) it opens.
//
// WHY THE AUDIT/EVENT LOGS MATTER HERE
//   With N runs per session, a log line that does not name its run is noise.
//   Every run registered here stamps its RoyalRedAudit rows (runId column,
//   additive schema change with a DB backup taken first) and its session
//   event-log rows (runId was already part of the event-log schema) so the
//   logs distinguish concurrent runs structurally, not by convention.

import { db } from '@/lib/db'
import { markRunAborted } from './box/abort-state'

export interface RunProcEntry {
  runId: string
  sessionId: string
  label: string
  status: 'running' | 'done' | 'aborted'
  startedAt: string
  endedAt: string | null
}

// the process table. Deliberately boring: a Map, guarded by the fact that
// Node is single-threaded. Every mutation is synchronous; persistence is the
// RoyalRedRun table's job (the table survives restarts, this does not, and
// the state route already reads the DB as the durable view).
const processTable = new Map<string, RunProcEntry>()

export function registerRun(entry: Omit<RunProcEntry, 'status' | 'endedAt'>): void {
  processTable.set(entry.runId, { ...entry, status: 'running', endedAt: null })
}

export function releaseRun(runId: string, status: 'done' | 'aborted'): void {
  const e = processTable.get(runId)
  if (e) {
    e.status = status
    e.endedAt = new Date().toISOString()
    // finished runs stay visible for a short grace window so concurrent-run
    // observers (tests, future panel) can see the final state, then leave
    setTimeout(() => {
      if (processTable.get(runId)?.status !== 'running') processTable.delete(runId)
    }, 15_000)
  }
}

// point-in-time snapshot of the process table (optionally per session)
export function listProcessTable(sessionId?: string): RunProcEntry[] {
  const all = [...processTable.values()]
  return sessionId ? all.filter((e) => e.sessionId === sessionId) : all
}

export function runCount(sessionId?: string): number {
  return listProcessTable(sessionId).filter((e) => e.status === 'running').length
}

// ─── the scalpel: abort exactly one run ──────────────────────────────────────

// Per-run abort. Sets the per-run abort flag the executor already checks
// before EVERY step (box/abort-state.ts), marks the DB row, writes an audit
// row attributed to this runId, and updates the process table. Sibling runs
// are untouched: they check their OWN runId.
//
// TERMINAL-EVENT DISCIPLINE: abortOneRun does NOT append the run/ended event.
// finishRun (box/ops.ts) is the single choke point for run/ended, so every
// run gets EXACTLY ONE terminal event, carrying the abort reason from the DB
// row. (A duplicate terminal event would poison the append-only log's
// replay; found by the run-queue proof test and fixed here.)
export async function abortOneRun(
  runId: string,
  reason: string,
): Promise<{ ok: boolean; existed: boolean; alreadyFinished?: boolean }> {
  const row = await db.royalRedRun.findUnique({ where: { id: runId } })
  if (!row) return { ok: false, existed: false }
  if (row.status !== 'running') return { ok: true, existed: true, alreadyFinished: true }
  markRunAborted(runId)
  await db.royalRedRun.update({
    where: { id: runId },
    data: { status: 'aborted', endedAt: new Date(), abortReason: reason.slice(0, 300) },
  }).catch(() => null)
  await db.royalRedAudit.create({
    data: {
      action: 'desktop.abort.one',
      runId,
      detail: `single-run abort: ${runId} (${row.tool}) — ${reason.slice(0, 200)}; siblings untouched`,
      ok: true,
    },
  })
  releaseRun(runId, 'aborted')
  return { ok: true, existed: true }
}
