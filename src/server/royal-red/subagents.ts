// ROYAL RED sub-agent spawn & lifecycle (Round 4, Phase 5 slice 1).
//
// THE ISOLATION SPEC'S CORE CLAIM, NOW CODE: a sub-agent is NOT a new process
// concept — it is a RUN with a parent (docs/PHASE5-ISOLATION.md Context).
// Everything the run-queue already proves about runs (process table, per-run
// audit/event attribution, scalpel abort) holds for sub-agents for free; what
// this module adds is:
//   - the persisted tree (parentRunId, role, depth on the RoyalRedRun row)
//   - the KERNEL spawn caps: depth, width, session-run admission — enforced
//     here, before anything is created, and denied at the global layer of the
//     policy waterfall's semantics (a kernel cap is unwritable by any prompt,
//     session grant, or turn rule — monotonicity proven in test-waterfall.ts)
//   - the subagent/* lifecycle events on the ONE session log (partitioned at
//     read-side by runId; the parent log shows the lifecycle)
//   - abortSubtree: the DB walk that kills a whole subtree via the scalpel
//
// NO UNATTRIBUTED ACTION: every spawn/deny/finish here writes an audit row
// carrying runId + subAgentId + parentRunId.

import { db } from '@/lib/db'
import { appendEvent } from './event-log'
import { beginRun, finishRun } from './box/ops'
import { planOperations, type DryRunPlan } from './box/dryrun'
import { abortOneRun } from './runqueue'
import { beginBudget, type BudgetRole } from './budget'
import { BUDGET_CAPS } from './budget'

// an orchestrator run carries no box steps; the empty plan is its (honest)
// "no box operations in this run" declaration
export function emptyPlan(): DryRunPlan {
  return planOperations([])
}

export interface SpawnDecision {
  ok: boolean
  denied?: 'depth' | 'width' | 'session-runs' | 'parent-missing'
  detail?: string
}

/**
 * The kernel spawn-cap check. Runs BEFORE any row is created; a deny is a
 * final, audited, kernel-level decision (nothing downstream can force-allow).
 */
export async function checkSpawnCaps(parentRunId: string): Promise<SpawnDecision> {
  const parent = await db.royalRedRun.findUnique({ where: { id: parentRunId } })
  if (!parent) return { ok: false, denied: 'parent-missing', detail: `no run ${parentRunId}` }
  const depth = parent.depth + 1
  if (depth > BUDGET_CAPS.maxDepth) {
    return {
      ok: false,
      denied: 'depth',
      detail: `kernel spawn cap: depth ${depth} exceeds max ${BUDGET_CAPS.maxDepth} (run -> sub -> sub-sub)`,
    }
  }
  const liveChildren = await db.royalRedRun.count({ where: { parentRunId, status: 'running' } })
  if (liveChildren >= BUDGET_CAPS.maxWidth) {
    return {
      ok: false,
      denied: 'width',
      detail: `kernel spawn cap: ${liveChildren} live children already at width max ${BUDGET_CAPS.maxWidth}`,
    }
  }
  const liveSession = await db.royalRedRun.count({ where: { sessionId: parent.sessionId, status: 'running' } })
  if (liveSession >= BUDGET_CAPS.maxSessionRuns) {
    return {
      ok: false,
      denied: 'session-runs',
      detail: `run-queue admission: ${liveSession} live runs already at session max ${BUDGET_CAPS.maxSessionRuns}`,
    }
  }
  return { ok: true, detail: `depth ${depth}, ${liveChildren} live siblings, ${liveSession} live session runs` }
}

export interface SpawnedSubRun {
  runId: string
  role: 'planner' | 'builder'
  depth: number
  parentRunId: string
  subAgentId: string // `<role>:<runId>` — the audit attribution identity
}

/**
 * Spawn a sub-agent run under a parent. Caps are checked first (deny = audited
 * kernel decision, nothing created). On success: the run row (with
 * parentRunId/role/depth), process-table registration, the run/started event,
 * the subagent/spawned event on the parent's session log, and the budget
 * ledger opening for this role.
 */
export async function spawnSubRun(params: {
  sessionId: string
  parentRunId: string
  role: 'planner' | 'builder'
  task: string
}): Promise<SpawnedSubRun | { denied: SpawnDecision }> {
  const caps = await checkSpawnCaps(params.parentRunId)
  const parent = await db.royalRedRun.findUnique({ where: { id: params.parentRunId }, select: { depth: true } })
  const depth = (parent?.depth ?? 0) + 1
  if (!caps.ok) {
    await db.royalRedAudit.create({
      data: {
        action: 'subagent.spawn.denied',
        runId: params.parentRunId,
        detail: `${caps.denied}: ${caps.detail} — requested role=${params.role}`,
        ok: false,
      },
    })
    return { denied: caps }
  }

  const runId = await beginRun(params.sessionId, `subagent:${params.role}`, emptyPlan(), {
    parentRunId: params.parentRunId,
    role: params.role,
    depth,
  })
  const subAgentId = `${params.role}:${runId}`
  beginBudget(runId, params.role as BudgetRole)
  await appendEvent({
    sessionId: params.sessionId,
    runId,
    type: 'subagent/spawned',
    payload: { role: params.role, subAgentId, parentRunId: params.parentRunId, depth, task: params.task.slice(0, 400) },
  })
  await db.royalRedAudit.create({
    data: {
      action: 'subagent.spawned',
      runId,
      subAgentId,
      parentRunId: params.parentRunId,
      detail: `role=${params.role} depth=${depth} task="${params.task.slice(0, 160)}" — ${caps.detail}`,
      ok: true,
    },
  })
  return { runId, role: params.role, depth, parentRunId: params.parentRunId, subAgentId }
}

/**
 * Sub-agent lifecycle close: the subagent/finished event, then finishRun (the
 * SINGLE run/ended choke point — exactly one terminal event per run, ever).
 */
export async function finishSubRun(sub: SpawnedSubRun, status: 'done' | 'aborted', note: string): Promise<void> {
  await appendEvent({
    sessionId: (await db.royalRedRun.findUnique({ where: { id: sub.runId }, select: { sessionId: true } }))?.sessionId ?? '',
    runId: sub.runId,
    type: status === 'aborted' ? 'subagent/aborted' : 'subagent/finished',
    payload: { role: sub.role, subAgentId: sub.subAgentId, parentRunId: sub.parentRunId, note: note.slice(0, 300) },
  })
  await db.royalRedAudit.create({
    data: {
      action: status === 'aborted' ? 'subagent.aborted' : 'subagent.finished',
      runId: sub.runId,
      subAgentId: sub.subAgentId,
      parentRunId: sub.parentRunId,
      detail: `${sub.role} ${status}: ${note.slice(0, 200)}`,
      ok: status === 'done',
    },
  })
  await finishRun(sub.runId, status)
}

/**
 * Subtree abort (ISOLATION spec Q4): walk the PERSISTED parentRunId chain
 * depth-first and scalpel every descendant, then the root. The tree relation
 * is a DB query, never an in-memory guess a restart could lose. Each abort
 * writes its own attributed audit row (abortOneRun's discipline).
 */
export async function abortSubtree(rootRunId: string, reason: string): Promise<{ aborted: string[]; alreadyFinished: string[] }> {
  const aborted: string[] = []
  const alreadyFinished: string[] = []
  const walk = async (runId: string): Promise<void> => {
    const children = await db.royalRedRun.findMany({ where: { parentRunId: runId }, select: { id: true } })
    for (const c of children) await walk(c.id)
    const r = await abortOneRun(runId, reason)
    if (r.existed && !r.alreadyFinished) aborted.push(runId)
    else alreadyFinished.push(runId)
  }
  await walk(rootRunId)
  return { aborted, alreadyFinished }
}
