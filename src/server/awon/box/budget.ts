// AWON Box — budget policy (Phase 5 prep, Task 21-d). ADDITIVE module.
//
// One policy, four knobs, one escalation law:
//   - maxConcurrentRuns    ENFORCED HARD today: beginRun() calls reserveRun()
//                          after the run row is created and FAILS CLOSED
//                          (run marked aborted + refusal thrown) when the cap
//                          is reached. This is what makes the box N-run safe.
//   - maxTokensPerRun      provisioned but ADVISORY until Phase 5 wires
//                          agent.ts: assertTokenBudget() audits and reports,
//                          nothing is refused yet.
//   - maxWallClockMsPerRun provisioned but ADVISORY until Phase 5 wires
//                          agent.ts: assertWallClock() audits and reports.
//   - maxSubAgentsPerRun   0 in Phase 5 prep (no sub-agents exist yet). The
//                          future spawn site must refuse above this per level.
//
// Escalation rules (spec'd in docs/phase5-prep.md, enforced by Phase 5):
//   tokens exceeded    -> warn -> next iteration refused
//   wall-clock exceeded-> run marked aborted, reason 'budget wall-clock'
//   sub-agent overflow -> refused at the spawn site
//   concurrency cap    -> refused at beginRun (shipped here, fail-closed)
//
// Every budget decision writes an AwonAudit row (action 'budget.*') following
// the exact ops.ts pattern, so the DESKTOP panel audit tail shows refusals.
//
// reserveRun semantics: beginRun() has ALREADY inserted the run row (status
// 'running') when it calls reserveRun(runId), so the count EXCLUDES the run
// being reserved. maxConcurrentRuns=4 therefore means exactly 4 runs may be
// in flight; the 5th is refused. Synthetic callers (tests, a future reaper)
// reserve ids that have no row yet - the same exclusion keeps the math true.
import { db } from '@/lib/db'

export interface BudgetPolicy {
  maxConcurrentRuns: number
  maxTokensPerRun: number
  maxWallClockMsPerRun: number
  maxSubAgentsPerRun: number
  escalation: 'fail_closed'
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// shipped defaults (the table in docs/phase5-prep.md). Env overrides are read
// ONCE at module load: AWON_MAX_CONCURRENT_RUNS, AWON_MAX_TOKENS_PER_RUN,
// AWON_MAX_WALLCLOCK_MS_PER_RUN.
export const DEFAULT_POLICY: BudgetPolicy = {
  maxConcurrentRuns: 4,
  maxTokensPerRun: 400_000,
  maxWallClockMsPerRun: 600_000,
  maxSubAgentsPerRun: 0, // Phase 5 raises this once the role table exists
  escalation: 'fail_closed',
}

let policy: BudgetPolicy = {
  maxConcurrentRuns: envInt('AWON_MAX_CONCURRENT_RUNS', DEFAULT_POLICY.maxConcurrentRuns),
  maxTokensPerRun: envInt('AWON_MAX_TOKENS_PER_RUN', DEFAULT_POLICY.maxTokensPerRun),
  maxWallClockMsPerRun: envInt('AWON_MAX_WALLCLOCK_MS_PER_RUN', DEFAULT_POLICY.maxWallClockMsPerRun),
  maxSubAgentsPerRun: DEFAULT_POLICY.maxSubAgentsPerRun,
  escalation: DEFAULT_POLICY.escalation,
}

export function getPolicy(): BudgetPolicy {
  return { ...policy }
}

// runtime configurability (tests, a future settings surface). escalation is
// PINNED to 'fail_closed': failing open is not a configurability option.
export function setPolicy(patch: Partial<Omit<BudgetPolicy, 'escalation'>>): BudgetPolicy {
  policy = {
    ...policy,
    ...patch,
    escalation: 'fail_closed',
  }
  db.awonAudit
    .create({
      data: {
        action: 'budget.policy',
        detail: `setPolicy ${JSON.stringify({ ...patch, escalation: 'fail_closed' })} -> active=${JSON.stringify(policy)}`,
        ok: true,
      },
    })
    .catch(() => null)
  return getPolicy()
}

// HARD GATE (called by ops.ts beginRun). Counts runs with status 'running'
// (excluding the reserved run itself, whose row beginRun just created) and
// refuses when the cap is already reached. Fail-closed: a refused run is
// marked aborted by the CALLER (beginRun owns the run row), and the refusal
// is audited here.
export async function reserveRun(runId: string): Promise<{ ok: boolean; reason?: string; activeRuns?: number; maxConcurrentRuns?: number }> {
  const max = getPolicy().maxConcurrentRuns
  const active = await db.awonRun.count({ where: { status: 'running', id: { not: runId } } })
  if (active >= max) {
    const reason = `concurrency cap: ${active} active runs >= maxConcurrentRuns=${max}`
    await db.awonAudit
      .create({ data: { action: 'budget.reserve', detail: `runId=${runId} REFUSED ${reason}`, ok: false } })
      .catch(() => null)
    return { ok: false, reason, activeRuns: active, maxConcurrentRuns: max }
  }
  await db.awonAudit
    .create({ data: { action: 'budget.reserve', detail: `runId=${runId} admitted active=${active + 1}/${max}`, ok: true } })
    .catch(() => null)
  return { ok: true, activeRuns: active + 1, maxConcurrentRuns: max }
}

// called by ops.ts finishRun AFTER the status update (so the slot is already
// freed by the status change; this row is the budget-ledger receipt). If the
// row is STILL marked running (exceptional path: only finishRun should set
// terminal statuses), releaseRun aborts it with an explicit budget reason -
// a running row must never silently vanish while holding a slot.
export async function releaseRun(runId: string): Promise<{ ok: boolean }> {
  let freed = 0
  try {
    const res = await db.awonRun.updateMany({
      where: { id: runId, status: 'running' },
      data: { status: 'aborted', endedAt: new Date(), abortReason: 'budget.release: slot released while still marked running' },
    })
    freed = res.count
  } catch {}
  await db.awonAudit
    .create({ data: { action: 'budget.release', detail: `runId=${runId} slot released${freed ? ` (row was still running -> aborted, ${freed} row)` : ''}`, ok: true } })
    .catch(() => null)
  return { ok: true }
}

// ADVISORY until Phase 5 wires agent.ts. Audits + reports; does not refuse.
// Phase 5 escalation: warn -> next iteration refused.
export async function assertTokenBudget(runId: string, usedTokens: number): Promise<{ ok: boolean; exceeded: boolean; used: number; max: number; reason?: string }> {
  const max = getPolicy().maxTokensPerRun
  const exceeded = usedTokens > max
  await db.awonAudit
    .create({ data: { action: 'budget.tokens', detail: `runId=${runId} used=${usedTokens} max=${max} ${exceeded ? 'EXCEEDED (advisory: next iteration refused in Phase 5)' : 'ok'}`, ok: !exceeded } })
    .catch(() => null)
  return exceeded
    ? { ok: false, exceeded: true, used: usedTokens, max, reason: `token budget exceeded: ${usedTokens} > ${max}` }
    : { ok: true, exceeded: false, used: usedTokens, max }
}

// ADVISORY until Phase 5 wires agent.ts. Audits + reports; does not abort.
// Phase 5 escalation: run marked aborted with reason 'budget wall-clock'.
export async function assertWallClock(runId: string, startedAtMs: number): Promise<{ ok: boolean; exceeded: boolean; elapsedMs: number; maxMs: number; reason?: string }> {
  const maxMs = getPolicy().maxWallClockMsPerRun
  const elapsedMs = Math.max(0, Date.now() - startedAtMs)
  const exceeded = elapsedMs > maxMs
  await db.awonAudit
    .create({ data: { action: 'budget.wallclock', detail: `runId=${runId} elapsed=${elapsedMs}ms max=${maxMs}ms ${exceeded ? 'EXCEEDED (advisory: Phase 5 aborts with reason budget wall-clock)' : 'ok'}`, ok: !exceeded } })
    .catch(() => null)
  return exceeded
    ? { ok: false, exceeded: true, elapsedMs, maxMs, reason: `wall-clock budget exceeded: ${elapsedMs}ms > ${maxMs}ms` }
    : { ok: true, exceeded: false, elapsedMs, maxMs }
}
