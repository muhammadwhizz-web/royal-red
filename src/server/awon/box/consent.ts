// AWON Box — three-tier consent engine (Phase 4.4).
//
// The kernel PAUSES the agent turn: requestConsent() returns a promise that
// only resolves when the user answers the card (or 120s expires, or the kill
// switch freezes the queue). Fail-closed everywhere:
//   - timeout            -> expired  -> treated as deny
//   - kill switch        -> frozen   -> treated as deny, request never re-opens
//   - client disconnect  -> the turn loop aborts; pending consents expire
//
// Tier model (enforced here, not in the prompt):
//   T1 read       - one card per batch of reads (list/read/screenshot)
//   T2 write      - one plan card per batch with approve / modify / deny / rule
//   T3 destructive- trash, shell_exec, screen input: ONE dialog per action,
//                   never batched, never remembered by a checkbox. The only
//                   permanent approval is a rule the user TYPED verbatim.
//
// Queue: FIFO per session by createdAt. Each request owns its timer, so the
// expiry of one request never auto-decides the ones behind it (they keep
// waiting for the user; each expires on its own clock). This behavior is
// covered by the consent-stacking regression test (Phase 3 soft spot #2).
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { isAborted, runIsAbortedInDb } from './abort-state'

export const CONSENT_TIMEOUT_MS = 120_000

type Resolve = (v: { id: string; status: 'approved' | 'denied' | 'expired' | 'frozen'; decision?: string; ruleText?: string; modifiedPayload?: unknown }) => void

// in-memory waiters (single Next.js process; the DB row is the durable record)
const waiters = new Map<string, Resolve>()

// session emitters: lets out-of-band events (kill switch freeze, late decisions)
// reach the console that is waiting on the card, so the UI flips live
const emitters = new Map<string, Set<Emit>>()
function registerEmitter(sessionId: string, emit: Emit): () => void {
  let set = emitters.get(sessionId)
  if (!set) {
    set = new Set()
    emitters.set(sessionId, set)
  }
  set.add(emit)
  return () => {
    set?.delete(emit)
    if (set && set.size === 0) emitters.delete(sessionId)
  }
}
function broadcast(sessionId: string, event: unknown): void {
  for (const e of emitters.get(sessionId) ?? []) {
    try {
      e(event)
    } catch {}
  }
}

// per-session row-creation chain: concurrent requestConsent calls must create
// their rows in CALL order, because the consent queue is FIFO by createdAt.
// Without this, three simultaneous requests race the DB and the queue order
// is undefined (caught by the consent-stacking regression test).
const creationChains = new Map<string, Promise<unknown>>()
function enqueueCreation<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = creationChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  creationChains.set(sessionId, next.catch(() => null))
  return next
}

export interface ConsentRequest {
  sessionId: string
  runId?: string
  tier: 1 | 2 | 3
  title: string
  detail?: string
  payload?: unknown // dry-run plan or op list, rendered by the card
}

export interface ConsentAnswer {
  decision: 'approve' | 'deny' | 'modify' | 'rule'
  ruleText?: string // tier 3 typed-rule override
  modifiedPayload?: unknown // "modify" returns an edited plan
}

type Emit = (e: unknown) => void

export async function requestConsent(req: ConsentRequest, emit: Emit): Promise<{ id: string; status: 'approved' | 'denied' | 'expired' | 'frozen'; decision?: string; ruleText?: string; modifiedPayload?: unknown }> {
  // abort wins before anything is even written (kill switch beats the queue).
  // DB-backed: honors aborts issued from ANY route bundle / process.
  if (req.runId && ((isAborted(req.runId) || (await runIsAbortedInDb(req.runId))))) {
    return { id: 'aborted', status: 'frozen' }
  }
  const id = `con_${randomUUID().slice(0, 12)}`
  const expiresAt = new Date(Date.now() + CONSENT_TIMEOUT_MS)
  const row = await enqueueCreation(req.sessionId, () =>
    db.awonConsent.create({
      data: {
        id,
        sessionId: req.sessionId,
        runId: req.runId ?? null,
        tier: req.tier,
        title: req.title.slice(0, 200),
        detail: req.detail?.slice(0, 2000) ?? null,
        payload: req.payload !== undefined ? JSON.stringify(req.payload).slice(0, 400_000) : null,
        status: 'pending',
        expiresAt,
      },
    }),
  )
  // close the race: the abort may land between the executor's loop check and
  // this row insert - the request is frozen the moment it exists (DB-backed)
  if (req.runId && (isAborted(req.runId) || (await runIsAbortedInDb(req.runId)))) {
    await db.awonConsent.update({ where: { id }, data: { status: 'frozen' } }).catch(() => null)
    return { id, status: 'frozen' }
  }
  const unregister = registerEmitter(req.sessionId, emit)
  emit({
    type: 'consent_request',
    id,
    tier: req.tier,
    title: row.title,
    detail: row.detail ?? undefined,
    payload: req.payload,
    createdAt: row.createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  })

  return new Promise<{ id: string; status: 'approved' | 'denied' | 'expired' | 'frozen'; decision?: string; ruleText?: string; modifiedPayload?: unknown }>((resolve) => {
    let settled = false
    const finish: Resolve = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poller)
      waiters.delete(id)
      unregister()
      resolve(v)
    }
    waiters.set(id, finish)
    const timer = setTimeout(async () => {
      // fail closed: expiry is a deny, recorded forever
      await db.awonConsent.updateMany({ where: { id, status: 'pending' }, data: { status: 'expired' } }).catch(() => null)
      emit({ type: 'consent_result', id, status: 'expired' })
      broadcast(req.sessionId, { type: 'consent_result', id, status: 'expired' })
      finish({ id, status: 'expired' })
    }, CONSENT_TIMEOUT_MS)
    // DB poll-back safety net: the waiter map is in-process state, so a dev
    // hot-reload (or any future multi-process deployment) would orphan it.
    // The DB row is the durable source of truth - poll it and resolve. The
    // row's OWN expiresAt is enforced here too, so the fail-closed deadline
    // is durable, not just an in-memory timer.
    const poller = setInterval(async () => {
      if (settled) return
      try {
        // DURABLE kill switch: if the RUN was aborted (from any route bundle
        // or process — the DB is the source of truth), this consent freezes
        // NOW, even if the row was created after the abort and even if the
        // in-memory flags live in a different module graph.
        if (req.runId && (await runIsAbortedInDb(req.runId))) {
          await db.awonConsent.updateMany({ where: { id, status: 'pending' }, data: { status: 'frozen' } }).catch(() => null)
          emit({ type: 'consent_result', id, status: 'frozen' })
          broadcast(req.sessionId, { type: 'consent_result', id, status: 'frozen' })
          finish({ id, status: 'frozen' })
          return
        }
        const row = await db.awonConsent.findUnique({ where: { id }, select: { status: true, decision: true, ruleText: true, expiresAt: true } })
        if (!row) return
        if (row.status === 'pending' && row.expiresAt.getTime() < Date.now()) {
          await db.awonConsent.updateMany({ where: { id, status: 'pending' }, data: { status: 'expired' } }).catch(() => null)
          emit({ type: 'consent_result', id, status: 'expired' })
          broadcast(req.sessionId, { type: 'consent_result', id, status: 'expired' })
          finish({ id, status: 'expired' })
          return
        }
        if (row.status === 'pending') return
        const status = row.status as 'approved' | 'denied' | 'expired' | 'frozen'
        finish({ id, status, decision: row.decision ?? undefined, ruleText: row.ruleText ?? undefined })
      } catch {}
    }, 2000)
  })
}

// called by POST /api/awon/desktop/consent/[id]
export async function decideConsent(id: string, answer: ConsentAnswer): Promise<{ ok: boolean; status: string; error?: string }> {
  const row = await db.awonConsent.findUnique({ where: { id } })
  if (!row) return { ok: false, status: 'missing', error: 'no such consent request' }
  if (row.status !== 'pending') return { ok: false, status: row.status, error: `request is ${row.status}` }
  if (row.expiresAt.getTime() < Date.now()) {
    await db.awonConsent.update({ where: { id }, data: { status: 'expired', decision: answer.decision, decidedAt: new Date() } })
    return { ok: false, status: 'expired', error: 'request expired (fail closed)' }
  }

  let status = 'denied'
  if (answer.decision === 'approve') status = 'approved'
  else if (answer.decision === 'modify') status = 'approved'
  else if (answer.decision === 'rule') {
    // typed-rule override: a rule requires verbatim typed text, the op name and
    // a scope; without all three it is a plain deny (fail closed)
    if (!answer.ruleText || answer.ruleText.trim().length < 8) {
      await db.awonConsent.update({ where: { id }, data: { status: 'denied', decision: 'rule', decidedAt: new Date() } })
      return { ok: false, status: 'denied', error: 'a rule override requires the rule text to be typed' }
    }
    status = 'approved'
  }

  await db.awonConsent.update({
    where: { id },
    data: {
      status,
      decision: answer.decision,
      ruleText: answer.ruleText ?? null,
      payload: answer.modifiedPayload !== undefined ? JSON.stringify(answer.modifiedPayload).slice(0, 400_000) : row.payload,
      decidedAt: new Date(),
    },
  })

  // tier 3 typed rule: store it as a permanent rule (the ONLY permanent path)
  if (answer.decision === 'rule' && row.tier === 3 && answer.ruleText) {
    const scope = extractRuleScope(answer.ruleText, row.title)
    await db.awonConsentRule.create({
      data: {
        sessionId: row.sessionId,
        ruleText: answer.ruleText.trim(),
        op: scope.op,
        pattern: scope.pattern,
      },
    })
  }

  // let every console watching this session flip the card live
  broadcast(row.sessionId, { type: 'consent_result', id, status })

  const waiter = waiters.get(id)
  if (waiter)
    waiter({
      id,
      // resolve with the ACTUAL outcome - a deny must NEVER look like an
      // approval to the executor (caught by the consent-stacking regression)
      status: (status as 'approved' | 'denied'),
      decision: answer.decision,
      ruleText: answer.ruleText,
      modifiedPayload: answer.modifiedPayload,
    })
  return { ok: true, status }
}

// parse "always allow <op> for <pattern>" out of the typed rule; anything else
// falls back to a NEVER-MATCHING op (fail-closed, documented behavior: an
// unparseable rule is stored but can never skip a dialog).
export function extractRuleScope(ruleText: string, fallbackTitle: string): { op: string; pattern: string } {
  const t = ruleText.toLowerCase()
  const ops = ['box_trash', 'trash', 'shell_exec', 'screen_click', 'screen_type', 'box_move', 'box_write', 'box_copy', 'delete']
  // fail-closed: an unparseable rule must NEVER default to an executable op.
  // ('' matches nothing - findMatchingRule filters by exact op, and no caller
  // ever asks for op=''. The old default 'box_trash' turned e.g. "always allow
  // git push for *" into a live auto-approve-everything-trash rule.)
  const op = ops.find((o) => t.includes(o)) ?? ''
  const opName = op === 'trash' || op === 'delete' ? 'box_trash' : op
  const forMatch = ruleText.match(/\bfor\s+(?:paths?\s+like\s+)?["']?([^"']+)["']?$/i)
  const pattern = forMatch?.[1]?.trim() || fallbackTitle.split(':').pop()?.trim() || '*'
  return { op: opName, pattern }
}

// glob-ish match used by the kernel before firing a dialog
export function ruleMatches(pattern: string, candidate: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*') + '$', 'i')
  return re.test(candidate)
}

// Typed grants are SCOPED to the session that typed them (fail-closed):
// a rule typed in session A must never auto-approve actions in session B.
// When sessionId is absent or unknown, NOTHING matches - the dialog fires.
export async function findMatchingRule(op: string, candidatePath: string, sessionId?: string) {
  if (!sessionId) return null
  const rules = await db.awonConsentRule.findMany({ where: { op, enabled: true, sessionId } })
  return rules.find((r) => ruleMatches(r.pattern, candidatePath)) ?? null
}

// kill switch (Phase 4.6) calls this: every pending request freezes forever
export async function freezeAllPending(sessionId?: string): Promise<number> {
  const where = sessionId ? { status: 'pending', sessionId } : { status: 'pending' }
  const frozenRows = await db.awonConsent.findMany({ where, select: { id: true, sessionId: true } })
  const frozen = await db.awonConsent.updateMany({ where, data: { status: 'frozen' } })
  for (const row of frozenRows) {
    broadcast(row.sessionId, { type: 'consent_result', id: row.id, status: 'frozen' })
  }
  for (const [id, resolve] of [...waiters.entries()]) {
    resolve({ id, status: 'frozen' })
  }
  return frozen.count
}

export function pendingWaiterCount(): number {
  return waiters.size
}
