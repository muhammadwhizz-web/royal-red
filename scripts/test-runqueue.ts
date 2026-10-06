// Phase 5 prep (Task 21-d): run-queue N-capability proof.
// Three DISJOINT fixtures, three different plans (move-only / copy+mkdir /
// write), launched CONCURRENTLY through the SAME box kernel + DB. Proves:
//   - distinct runIds, all runs execute
//   - journal rows are strictly per-run (no cross-contamination of runIds or
//     fixture paths)
//   - plan-hash discipline holds under concurrency (mismatched hash refuses)
//   - concurrent runs never see each other's files on disk
//   - budget wire-in admits all 3 (reserveRun) and releases all 3 (finishRun)
//
// DETERMINISM NOTE (verified against ops.ts executePlan): only steps with
// op === 'trash' fire requestConsent (Tier 3). Write ops are Tier 2 and are
// consented at the PLAN CARD layer (upstream of executePlan), so a plan built
// from move/copy/mkdir/write goes through executePlan with ZERO interactive
// consent gates -> the test needs no consent responder and is deterministic.
// The final check asserts no pending consent rows were created, proving no
// interactive gate fired.
//
// Run: bun scripts/test-runqueue.ts
import fs from 'fs'
import path from 'path'
import { BOX_HOME, ensureBoxTree } from '../src/server/awon/box/prison'
import { planOperations, type DryRunPlan, type RawOp } from '../src/server/awon/box/dryrun'
import { executePlan } from '../src/server/awon/box/ops'
import { getPolicy, setPolicy } from '../src/server/awon/box/budget'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? ` - ${extra}` : ''}`)
  }
}

const noopEmit = () => {}
const V = '/home/awon' // the box-virtual home

// one retry after a 2s pause if SQLite reports a lock (per test constraints)
async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (/database is locked|SQLITE_BUSY/i.test(String((e as Error).message))) {
      console.log('  .. sqlite lock detected, waiting 2s and retrying once')
      await new Promise((r) => setTimeout(r, 2000))
      return fn()
    }
    throw e
  }
}

function walkBasenames(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) walk(p)
      else out.push(d.name)
    }
  }
  walk(root)
  return out
}

const ORIGINAL_POLICY = getPolicy()
const roots = {
  a: path.join(BOX_HOME, 'rq-run-a'),
  b: path.join(BOX_HOME, 'rq-run-b'),
  c: path.join(BOX_HOME, 'rq-run-c'),
}

async function main() {
  const { db } = await import('../src/lib/db')
  ensureBoxTree()

  // ── fixtures: 3 DISJOINT rq-* dirs under the emulated box home ──────────
  for (const dir of [...Object.values(roots), path.join(roots.a, 'rq-dst')]) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  }
  const srcA = path.join(roots.a, 'rq-doc-a.pdf')
  const srcB = path.join(roots.b, 'rq-img-b.jpg')
  fs.writeFileSync(srcA, 'rq-doc-a-content')
  fs.writeFileSync(srcB, 'rq-img-b-content')

  // ── 3 different plans via planOperations() ──────────────────────────────
  const opsA: RawOp[] = [{ op: 'move', from: `${V}/rq-run-a/rq-doc-a.pdf`, to: `${V}/rq-run-a/rq-dst` }]
  const opsB: RawOp[] = [
    { op: 'mkdir', to: `${V}/rq-run-b/rq-copied` },
    { op: 'copy', from: `${V}/rq-run-b/rq-img-b.jpg`, to: `${V}/rq-run-b/rq-copied/rq-img-b.jpg` },
  ]
  const opsC: RawOp[] = [{ op: 'write', to: `${V}/rq-run-c/rq-note-c.txt`, content: 'rq-note-c-content' }]
  const plans: Record<'a' | 'b' | 'c', DryRunPlan> = {
    a: planOperations(opsA),
    b: planOperations(opsB),
    c: planOperations(opsC),
  }
  console.log('plans:')
  for (const k of ['a', 'b', 'c'] as const) {
    const plan = plans[k]
    check(`plan ${k} fully proposable (${plan.summary.proposable} steps, hash ${plan.hash.slice(0, 8)}…)`, plan.summary.refused === 0 && plan.summary.proposable > 0, JSON.stringify(plan.steps))
    check(`plan ${k} contains no trash op (no interactive consent gate)`, !plan.steps.some((s) => s.proposable && s.op === 'trash'))
  }
  check('plan hashes are pairwise distinct', plans.a.hash !== plans.b.hash && plans.b.hash !== plans.c.hash && plans.a.hash !== plans.c.hash)

  // budget headroom: baseline running rows from OTHER suites could occupy
  // slots, so size the cap relative to the baseline (also exercises the new
  // reserveRun wire-in under real concurrency)
  const baseline = await withLockRetry(() => db.awonRun.count({ where: { status: 'running' } }))
  setPolicy({ maxConcurrentRuns: baseline + 3 })

  // ── launch all 3 CONCURRENTLY through the same kernel ───────────────────
  console.log('concurrent execution (Promise.all, one kernel, one DB):')
  const launchedAt = Date.now()
  const results = await withLockRetry(() =>
    Promise.all([
      executePlan(plans.a, { sessionId: 'rq-session-a', emit: noopEmit, approvedHash: plans.a.hash, consentId: 'rq-a' }),
      executePlan(plans.b, { sessionId: 'rq-session-b', emit: noopEmit, approvedHash: plans.b.hash, consentId: 'rq-b' }),
      // write ops are T2: their CONTENT travels post-approval via contentBySeq
      // (the plan card shows bytes, not text) - exactly how the chat route
      // hands the approved write content to the executor
      executePlan(plans.c, { sessionId: 'rq-session-c', emit: noopEmit, approvedHash: plans.c.hash, consentId: 'rq-c', contentBySeq: new Map([[1, 'rq-note-c-content']]) }),
    ]),
  )
  const wallMs = Date.now() - launchedAt
  const [resA, resB, resC] = results
  const runIds = [resA.runId, resB.runId, resC.runId]
  console.log(`  .. wall clock for all 3: ${wallMs}ms`)

  check('all 3 runs got DISTINCT runIds', new Set(runIds).size === 3, runIds.join(','))
  check('run A executed (move-only, 1 step)', resA.executed === 1 && !resA.aborted, JSON.stringify(resA))
  check('run B executed (copy+mkdir, 2 steps)', resB.executed === 2 && !resB.aborted, JSON.stringify(resB))
  check('run C executed (write, 1 step)', resC.executed === 1 && !resC.aborted, JSON.stringify(resC))
  check('no step refused in any run', resA.refused === 0 && resB.refused === 0 && resC.refused === 0)

  // ── run rows: done + released ───────────────────────────────────────────
  const rows = await withLockRetry(() => db.awonRun.findMany({ where: { id: { in: runIds } } }))
  check('all 3 run rows reached status done', rows.length === 3 && rows.every((r) => r.status === 'done'), JSON.stringify(rows.map((r) => ({ id: r.id, status: r.status }))))
  const running = await withLockRetry(() => db.awonRun.count({ where: { id: { in: runIds }, status: 'running' } }))
  check('all concurrency slots released (finishRun -> releaseRun)', running === 0, String(running))
  const budgetRefusals = await withLockRetry(() => db.awonAudit.count({ where: { action: 'budget.reserve', detail: { contains: 'REFUSED' }, AND: runIds.map((id) => ({ detail: { contains: id } })) } }))
  check('budget gate admitted all 3 (zero REFUSED rows for these runs)', budgetRefusals === 0, String(budgetRefusals))
  const admitted = [] as number[]
  for (const runId of runIds) {
    admitted.push(await withLockRetry(() => db.awonAudit.count({ where: { action: 'budget.reserve', ok: true, detail: { contains: `runId=${runId} admitted` } } })))
  }
  check('each run got exactly one budget.reserve admitted row', admitted.every((n) => n === 1), admitted.join(','))

  // ── journal isolation: per-runId counts + no path leakage across fixtures
  console.log('journal isolation (AwonUndoEntry):')
  const expected: Record<string, number> = { [resA.runId]: 1, [resB.runId]: 2, [resC.runId]: 1 }
  // journal rows store BOX-VIRTUAL paths, so the roots here are virtual too
  const rootFor: Record<string, string> = { [resA.runId]: `${V}/rq-run-a`, [resB.runId]: `${V}/rq-run-b`, [resC.runId]: `${V}/rq-run-c` }
  const others: Record<string, string[]> = {
    [resA.runId]: ['rq-img-b.jpg', 'rq-copied', 'rq-note-c.txt', 'rq-run-b', 'rq-run-c'],
    [resB.runId]: ['rq-doc-a.pdf', 'rq-dst', 'rq-note-c.txt', 'rq-run-a', 'rq-run-c'],
    [resC.runId]: ['rq-doc-a.pdf', 'rq-dst', 'rq-img-b.jpg', 'rq-copied', 'rq-run-a', 'rq-run-b'],
  }
  for (const runId of runIds) {
    const entries = await withLockRetry(() => db.awonUndoEntry.findMany({ where: { runId } }))
    check(`journal count for ${runId} === ${expected[runId]}`, entries.length === expected[runId], JSON.stringify(entries.map((e) => ({ op: e.op, from: e.fromPath, to: e.toPath }))))
    check(`journal rows of ${runId} reference ONLY its own rq- fixture`, entries.every((e) =>
      [e.fromPath, e.toPath].every((p) => p === '' || p.startsWith(rootFor[runId])) && [e.fromPath, e.toPath].every((p) => !others[runId].some((needle) => p.includes(needle))),
    ), JSON.stringify(entries.map((e) => `${e.fromPath}->${e.toPath}`)))
  }
  // cross-check from the other direction: THIS test's 3 runs produced exactly
  // 4 journal rows and every rq-run-* path in the ENTIRE journal belongs to
  // one of them (no foreign run ever touched the rq- fixtures)
  const allJournalForRuns = await withLockRetry(() => db.awonUndoEntry.findMany({ where: { runId: { in: runIds } } }))
  check('the 3 runs produced exactly 4 journal rows, each inside its own fixture', allJournalForRuns.length === 4 && allJournalForRuns.every((e) => {
    const root = rootFor[e.runId]
    return root !== undefined && [e.fromPath, e.toPath].every((p) => p === '' || p.startsWith(root))
  }), JSON.stringify(allJournalForRuns.map((e) => ({ run: e.runId, from: e.fromPath, to: e.toPath }))))
  const rqTouchers = await withLockRetry(() => db.awonUndoEntry.findMany({
    where: {
      OR: ['rq-run-a', 'rq-run-b', 'rq-run-c'].flatMap((d) => [{ fromPath: { contains: d } }, { toPath: { contains: d } }]),
    },
  }))
  // the journal is a permanent record (earlier invocations of this test leave
  // honest rows), so the leak invariant is: a row may reference at most ONE
  // rq- fixture - a row spanning two fixtures would be cross-run contamination
  const zoneOf = (p: string) => (p.includes('rq-run-a') ? 'a' : p.includes('rq-run-b') ? 'b' : p.includes('rq-run-c') ? 'c' : null)
  const noCrossFixture = rqTouchers.every((e) => {
    const zones = new Set([zoneOf(e.fromPath), zoneOf(e.toPath)].filter((z): z is string => z !== null))
    return zones.size <= 1
  })
  check(`no journal row ever spans two rq- fixtures (${rqTouchers.length} rows touch the fixtures, all single-zone)`, noCrossFixture, JSON.stringify(rqTouchers.filter((e) => new Set([zoneOf(e.fromPath), zoneOf(e.toPath)].filter((z): z is string => z !== null)).size > 1)))

  // ── hash discipline under concurrency: a mismatched approvedHash refuses ─
  console.log('plan-hash cross-talk:')
  let mismatchThrew = false
  try {
    await executePlan(plans.a, { sessionId: 'rq-session-a', emit: noopEmit, approvedHash: 'f'.repeat(64), consentId: 'rq-x' })
  } catch (e) {
    mismatchThrew = /plan hash mismatch/.test(String((e as Error).message))
  }
  check('deliberate hash mismatch refuses execution', mismatchThrew)
  const mismatchAudit = await withLockRetry(() => db.awonAudit.findFirst({ where: { action: 'desktop.exec.hash_mismatch' }, orderBy: { createdAt: 'desc' } }))
  check('hash refusal audited (desktop.exec.hash_mismatch)', mismatchAudit !== null && mismatchAudit.ok === false)

  // ── disk isolation: concurrent runs do not see each other's files ───────
  console.log('disk isolation:')
  check('A: source gone, moved into rq-dst with exact content', !fs.existsSync(srcA) && fs.readFileSync(path.join(roots.a, 'rq-dst', 'rq-doc-a.pdf'), 'utf8') === 'rq-doc-a-content')
  check('B: copy source still present, copy present with exact content', fs.existsSync(srcB) && fs.readFileSync(path.join(roots.b, 'rq-copied', 'rq-img-b.jpg'), 'utf8') === 'rq-img-b-content')
  check('C: written file exists with exact content', fs.readFileSync(path.join(roots.c, 'rq-note-c.txt'), 'utf8') === 'rq-note-c-content')
  const bnamesA = walkBasenames(roots.a)
  const bnamesB = walkBasenames(roots.b)
  const bnamesC = walkBasenames(roots.c)
  check('A contains no B/C files', !bnamesA.some((n) => ['rq-img-b.jpg', 'rq-note-c.txt'].includes(n)), bnamesA.join(','))
  check('B contains no A/C files', !bnamesB.some((n) => ['rq-doc-a.pdf', 'rq-note-c.txt'].includes(n)), bnamesB.join(','))
  check('C contains no A/B files', !bnamesC.some((n) => ['rq-doc-a.pdf', 'rq-img-b.jpg'].includes(n)), bnamesC.join(','))

  // ── determinism: no interactive consent gate fired for any of the 3 ─────
  const pending = await withLockRetry(() => db.awonConsent.count({ where: { sessionId: { in: ['rq-session-a', 'rq-session-b', 'rq-session-c'] }, status: { in: ['pending', 'frozen'] } } }))
  check('zero pending/frozen consent rows (no interactive gate fired)', pending === 0, String(pending))

  // ── kernel N-capability audit (module-level state sweep) ─────────────────
  // No rewrite done; documenting what shares state across concurrent runs.
  console.log('kernel N-capability audit (documentation, no kernel changes):')
  console.log('  - abort-state.ts: per-run Set + global kill flag -> keyed, safe for N runs')
  console.log('  - consent.ts: waiters/emitters keyed by consent id, creation chain PER SESSION -> safe; FIFO order is per-session by design')
  console.log('  - dryrun.ts pendingRaw cache: keyed by planId -> safe')
  console.log('  - runtime.ts supervised table: global Map of child handles; triggerAbort SIGTERMs the whole tree (session-level kill, by design)')
  console.log('  - FINDING: per-step AwonAudit rows (desktop.<op>) do NOT carry runId - under N runs the audit log cannot attribute a step row to a run. Phase 5 must add runId attribution (schema pass). Documented in docs/phase5-prep.md')
  check('no module-level singleton corrupted the 3 concurrent runs (all checks above green)', fail === 0)
}

try {
  await main()
} finally {
  // clean ALL rq-* fixtures + restore policy (DB rows stay: honest record)
  for (const dir of Object.values(roots)) fs.rmSync(dir, { recursive: true, force: true })
  setPolicy(ORIGINAL_POLICY)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
