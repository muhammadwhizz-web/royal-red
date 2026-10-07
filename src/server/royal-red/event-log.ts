// ROYAL RED session event log — the durable, replayable backbone of the audit
// trail (Royal Red Round 2, DeepSeek-harness port #1).
//
// SOURCE PATTERN (MIT, verified upstream 2026-10-07):
//   deepseek-harness `packages/core/session/src/types.ts:276` — "The
//   merge-extensible, append-only source of truth for an agent interaction";
//   `:496-497` — per-session monotonic sequence numbers; `known-event-
//   types.ts:24` — closed typed event vocabulary with an `ignorable` marker so
//   a log written by a newer kernel is never silently misinterpreted.
//
// PORT DISCIPLINE (direct pattern port, reimplemented natively):
//   - APPEND-ONLY: rows are created, never updated or deleted. There is no
//     API in this module that mutates an existing event.
//   - TYPED: every event carries a `type` from the vocabulary below. Unknown
//     types (written by a future kernel) replay as `ignorable` projections,
//     never as wrong state.
//   - REPLAYABLE: `replaySessionState()` folds the ordered log back into a
//     full session state — the projection is the proof that the log is a
//     complete record, not a side table.

import { db } from '@/lib/db'

// ---------- typed event vocabulary (merge-extensible: add, never rename) ----------

export const ROYAL_RED_EVENT_TYPES = [
  'turn/started',
  'turn/ended',
  'iteration/started',
  'llm/request-header',
  'llm/attempt',
  'llm/rotation',
  'assistant/say',
  'plan/updated',
  'constraints/updated',
  'artifact/written',
  'tool/dispatch',
  'tool/result',
  'consent/asked',
  'consent/decided',
  'policy/decision',
  'verify/receipt',
  'sandbox/mode',
  'error',
] as const

export type RoyalRedEventType = (typeof ROYAL_RED_EVENT_TYPES)[number]

export interface RoyalRedEvent {
  seq: number
  sessionId: string
  runId: string | null
  type: string
  ignorable: boolean
  payload: Record<string, unknown>
  at: string
}

// ---------- append ----------

export interface AppendEventInput {
  sessionId: string
  runId?: string | null
  type: RoyalRedEventType | string // unknown types are allowed but marked ignorable
  payload?: Record<string, unknown>
  ignorable?: boolean
}

/**
 * Append one typed event to the session log. The seq is per-session
 * monotonic (harness types.ts:496 pattern). Fire-and-forget safe: callers may
 * `void appendEvent(...)` on the SSE hot path; a failed log write never breaks
 * the operation it records (same rule as the cost ledger).
 *
 * The seq is allocated ATOMICALLY inside SQLite
 * (`max(seq)+1 for this session` in the same INSERT statement) — concurrent
 * writers (SSE events, policy decisions, LLM attempts firing in parallel)
 * cannot collide on the (sessionId, seq) unique constraint, because SQLite
 * serializes the write. No application-level retry race.
 */
export async function appendEvent(input: AppendEventInput): Promise<void> {
  const known = (ROYAL_RED_EVENT_TYPES as readonly string[]).includes(input.type)
  const ignorable = input.ignorable ?? !known
  try {
    await db.$executeRaw`
      INSERT INTO "AwonEventLog"
        ("id", "sessionId", "runId", "seq", "type", "ignorable", "payload", "createdAt")
      VALUES
        (lower(hex(randomblob(16))), ${input.sessionId}, ${input.runId ?? null},
         (SELECT COALESCE(MAX("seq"), 0) + 1 FROM "AwonEventLog" WHERE "sessionId" = ${input.sessionId}),
         ${input.type}, ${ignorable ? 1 : 0}, ${JSON.stringify(input.payload ?? {}).slice(0, 400_000)}, CURRENT_TIMESTAMP)`
  } catch (e) {
    // a failed log write must never break the operation it records
    console.error('event-log append failed', e)
  }
}

/**
 * Durable emit wrapper: every SSE event the console sees is also appended to
 * the log under the closest typed vocabulary name, so the console transcript
 * and the durable log can never diverge.
 */
export function durableEmitter(
  sessionId: string,
  emit: (e: { type: string } & Record<string, unknown>) => void,
  runId?: string | null,
): (e: { type: string } & Record<string, unknown>) => void {
  const SSE_TO_EVENT: Record<string, RoyalRedEventType> = {
    mode: 'turn/started',
    phase: 'iteration/started',
    say: 'assistant/say',
    plan: 'plan/updated',
    constraints: 'constraints/updated',
    artifact: 'artifact/written',
    tool_start: 'tool/dispatch',
    tool_end: 'tool/result',
    consent_request: 'consent/asked',
    consent_decided: 'consent/decided',
    verify: 'verify/receipt',
    error: 'error',
  }
  return (e) => {
    try {
      emit(e)
    } catch {}
    const mapped = SSE_TO_EVENT[e.type]
    if (!mapped) return // done / mode-only events are turn-scoped, logged explicitly
    const { type: _t, ...payload } = e
    void appendEvent({ sessionId, runId: runId ?? null, type: mapped, payload })
  }
}

// ---------- read + replay ----------

export async function readSessionEvents(sessionId: string, limit = 2000): Promise<RoyalRedEvent[]> {
  const rows = await db.royalRedEventLog.findMany({
    where: { sessionId },
    orderBy: { seq: 'asc' },
    take: limit,
  })
  return rows.map((r) => ({
    seq: r.seq,
    sessionId: r.sessionId,
    runId: r.runId,
    type: r.type,
    ignorable: r.ignorable,
    payload: safeParse(r.payload),
    at: r.createdAt.toISOString(),
  }))
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { raw: String(s).slice(0, 200) }
  }
}

export interface SessionProjection {
  sessionState: 'empty' | 'active' | 'ended'
  turns: number
  iterations: number
  says: number
  toolDispatches: number
  toolErrors: number
  artifactsWritten: number
  llmAttempts: number
  llmFailures: number
  rotations: number
  consentsAsked: number
  consentsDenied: number
  policyDecisions: { allow: number; deny: number; ask: number }
  verifyReceipts: number
  errors: number
  totalCostUsd: number
  modes: string[]
  lastSay: string | null
  lastArtifactId: string | null
  firstAt: string | null
  lastAt: string | null
  unknownEventTypes: string[] // future-kernel events replayed as ignorable
}

/**
 * Replay: fold the ordered event log back into complete session state.
 * This is the harness's projections discipline (session/src/surface.ts) —
 * state is DERIVED from the log, never stored beside it.
 */
export function replaySessionState(events: RoyalRedEvent[]): SessionProjection {
  const p: SessionProjection = {
    sessionState: 'empty',
    turns: 0,
    iterations: 0,
    says: 0,
    toolDispatches: 0,
    toolErrors: 0,
    artifactsWritten: 0,
    llmAttempts: 0,
    llmFailures: 0,
    rotations: 0,
    consentsAsked: 0,
    consentsDenied: 0,
    policyDecisions: { allow: 0, deny: 0, ask: 0 },
    verifyReceipts: 0,
    errors: 0,
    totalCostUsd: 0,
    modes: [],
    lastSay: null,
    lastArtifactId: null,
    firstAt: null,
    lastAt: null,
    unknownEventTypes: [],
  }
  for (const ev of events) {
    if (p.firstAt === null) p.firstAt = ev.at
    p.lastAt = ev.at
    if (!(ROYAL_RED_EVENT_TYPES as readonly string[]).includes(ev.type) && !p.unknownEventTypes.includes(ev.type)) {
      p.unknownEventTypes.push(ev.type)
    }
    const pay = ev.payload
    switch (ev.type) {
      case 'turn/started':
        p.turns++
        p.sessionState = 'active'
        if (typeof pay.value === 'string' && !p.modes.includes(pay.value)) p.modes.push(pay.value)
        break
      case 'turn/ended':
        p.sessionState = 'ended'
        break
      case 'iteration/started':
        p.iterations++
        break
      case 'llm/attempt':
        p.llmAttempts++
        p.totalCostUsd += typeof pay.costUsd === 'number' ? pay.costUsd : 0
        if (pay.outcome === 'error') p.llmFailures++
        break
      case 'llm/rotation':
        p.rotations++
        break
      case 'assistant/say':
        p.says++
        if (typeof pay.text === 'string') p.lastSay = pay.text
        break
      case 'artifact/written':
        p.artifactsWritten++
        if (typeof pay.id === 'string') p.lastArtifactId = pay.id
        break
      case 'tool/dispatch':
        p.toolDispatches++
        break
      case 'tool/result':
        if (pay.ok === false) p.toolErrors++
        break
      case 'consent/asked':
        p.consentsAsked++
        break
      case 'consent/decided':
        if (pay.status === 'denied' || pay.status === 'expired' || pay.status === 'frozen') p.consentsDenied++
        break
      case 'policy/decision':
        if (pay.verdict === 'allow') p.policyDecisions.allow++
        else if (pay.verdict === 'deny') p.policyDecisions.deny++
        else if (pay.verdict === 'ask') p.policyDecisions.ask++
        break
      case 'verify/receipt':
        p.verifyReceipts++
        break
      case 'error':
        p.errors++
        break
      default:
        break // ignorable: counted in unknownEventTypes, never misread
    }
  }
  return p
}

/**
 * Replay integrity check: seqs must be contiguous 1..N per session. A gap
 * means a log row was deleted — which the append-only discipline forbids.
 */
export function verifyLogIntegrity(events: RoyalRedEvent[]): { ok: boolean; expected: number; actual: number } {
  const expected = events.length
  const actual = events.reduce((acc, e, i) => (e.seq === i + 1 ? acc + 1 : acc), 0)
  return { ok: expected === actual, expected, actual }
}
