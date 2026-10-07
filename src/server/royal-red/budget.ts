// ROYAL RED budget ceilings (Round 4, Phase 5 slice 1) — the executable half
// of docs/PHASE5-BUDGET.md. The spec's numbers are the law here; every budget
// decision is a ledger/audit fact, never a silent side effect.
//
// WHAT THIS ENFORCES (slice 1 scope):
//   - per-run token ceilings (role-differentiated: planner is the tightest)
//   - per-run wall-clock ceiling (15 min from the run row's startedAt)
//   - the escalation contract: an exhausted run is NOT killed mid-call — the
//     in-flight call finishes, the NEXT call is refused with a typed
//     `budget/exhausted` event, and the caller degrades gracefully with an
//     honest "stopped by budget" line (same shape as the kill-switch report).
//
// TOKEN ACCOUNTING HONESTY: the house provider does not report usage, so in/
// out tokens are ESTIMATED (chars/4, the standard approximation) and the
// receipt/ledger row says `estimate` — the ceiling is enforced on the same
// estimate, so the accounting is self-consistent even when individual numbers
// are approximations. Routed (BYOK) providers report real usage when the
// adapter returns it; the estimate is the fallback, never a fabrication of
// precision.

import { db } from '@/lib/db'
import { appendEvent } from './event-log'

export const BUDGET_CAPS = {
  // per-role token ceilings (in + out, cumulative across the run's calls)
  top: { tokensIn: 200_000, tokensOut: 100_000 },
  planner: { tokensIn: 50_000, tokensOut: 20_000 },
  builder: { tokensIn: 200_000, tokensOut: 100_000 },
  // wall clock per run (PHASE5-BUDGET.md default: 15 min)
  wallClockMs: 900_000,
  // spawn caps (kernel-level, unwritable by prompts or grants — ISOLATION Q3)
  maxDepth: 2, // run -> sub -> sub-sub; depth >= 2 may not spawn
  maxWidth: 4, // live children per parent
  maxSessionRuns: 6, // live runs per session (run-queue admission)
} as const

export type BudgetRole = keyof typeof BUDGET_CAPS extends never ? never : 'top' | 'planner' | 'builder'

export interface BudgetUsage {
  runId: string
  role: BudgetRole
  tokensIn: number
  tokensOut: number
  calls: number
  startedAt: number
}

// in-memory usage table (single Next.js process; the durable record is the
// cost ledger's runId rows + the budget/exhausted events — a restart loses the
// counter but never the receipt)
const usage = new Map<string, BudgetUsage>()

export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4)
}

export function beginBudget(runId: string, role: BudgetRole): void {
  if (!usage.has(runId)) {
    usage.set(runId, { runId, role, tokensIn: 0, tokensOut: 0, calls: 0, startedAt: Date.now() })
  }
}

export function recordUsage(runId: string, role: BudgetRole, tokensIn: number, tokensOut: number): void {
  beginBudget(runId, role)
  const u = usage.get(runId)!
  u.tokensIn += Math.max(0, Math.round(tokensIn))
  u.tokensOut += Math.max(0, Math.round(tokensOut))
  u.calls += 1
}

export function getUsage(runId: string): BudgetUsage | null {
  return usage.get(runId) ?? null
}

export function capsFor(role: BudgetRole): { tokensIn: number; tokensOut: number } {
  return BUDGET_CAPS[role]
}

export interface BudgetVerdict {
  ok: boolean
  reason?: 'tokens-in' | 'tokens-out' | 'wall-clock'
  used?: { tokensIn: number; tokensOut: number; elapsedMs: number }
  caps?: { tokensIn: number; tokensOut: number; wallClockMs: number }
}

/**
 * Check whether a run may make its NEXT model call. Called by the seam before
 * every attributed call. The in-flight call that crosses the ceiling is always
 * allowed to finish (escalation rule 1); this gates the next one.
 */
export function checkBudget(runId: string, role: BudgetRole): BudgetVerdict {
  beginBudget(runId, role)
  const u = usage.get(runId)!
  const caps = capsFor(role)
  if (u.tokensIn >= caps.tokensIn) {
    return { ok: false, reason: 'tokens-in', used: snapshotUsed(u), caps: { ...caps, wallClockMs: BUDGET_CAPS.wallClockMs } }
  }
  if (u.tokensOut >= caps.tokensOut) {
    return { ok: false, reason: 'tokens-out', used: snapshotUsed(u), caps: { ...caps, wallClockMs: BUDGET_CAPS.wallClockMs } }
  }
  // wall clock: read the DB row's startedAt lazily through the usage entry
  const elapsedMs = Date.now() - u.startedAt
  if (elapsedMs >= BUDGET_CAPS.wallClockMs) {
    return { ok: false, reason: 'wall-clock', used: snapshotUsed(u), caps: { ...caps, wallClockMs: BUDGET_CAPS.wallClockMs } }
  }
  return { ok: true, used: snapshotUsed(u), caps: { ...caps, wallClockMs: BUDGET_CAPS.wallClockMs } }
}

function snapshotUsed(u: BudgetUsage) {
  return { tokensIn: u.tokensIn, tokensOut: u.tokensOut, elapsedMs: Date.now() - u.startedAt }
}

/**
 * The typed refusal: budget/exhausted event + audit row, both attributed.
 * `stoppedBy` is the honest receipt line the caller must surface.
 */
export async function emitBudgetExhausted(params: {
  sessionId: string
  runId: string
  subAgentId?: string | null
  parentRunId?: string | null
  role: BudgetRole
  reason: NonNullable<BudgetVerdict['reason']>
  used: BudgetVerdict['used']
  caps: BudgetVerdict['caps']
}): Promise<string> {
  const line = `stopped by budget (${params.reason}): ${params.used?.tokensIn ?? 0} in / ${params.used?.tokensOut ?? 0} out tokens of ${params.caps?.tokensIn ?? '?'}/${params.caps?.tokensOut ?? '?'} caps — partial work saved`
  await appendEvent({
    sessionId: params.sessionId,
    runId: params.runId,
    type: 'budget/exhausted',
    payload: { role: params.role, reason: params.reason, used: params.used, caps: params.caps },
  })
  await db.royalRedAudit.create({
    data: {
      action: 'budget.exhausted',
      runId: params.runId,
      subAgentId: params.subAgentId ?? null,
      parentRunId: params.parentRunId ?? null,
      detail: line,
      ok: false,
    },
  })
  return line
}

/** warning tripwire (PHASE5-BUDGET escalation rule 5): fires once per run+kind */
const warned = new Set<string>()
export async function maybeWarn(sessionId: string, runId: string, role: BudgetRole, kind: 'wall-clock-half'): Promise<void> {
  const key = `${runId}:${kind}`
  if (warned.has(key)) return
  const u = usage.get(runId)
  if (!u) return
  const trigger = kind === 'wall-clock-half' ? BUDGET_CAPS.wallClockMs / 2 : 0
  if (Date.now() - u.startedAt < trigger) return
  warned.add(key)
  await appendEvent({
    sessionId,
    runId,
    type: 'budget/warning',
    payload: { role, kind, elapsedMs: Date.now() - u.startedAt, capMs: BUDGET_CAPS.wallClockMs },
  })
}

// test hook: clear per-process state (unit tests only)
export function resetBudgetState(): void {
  usage.clear()
  warned.clear()
}
