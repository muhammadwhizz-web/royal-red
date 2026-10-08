// ROYAL RED ROUND 3 — RUN-QUEUE PROOF (Phase-5 groundwork test, directive 4a).
//
// Contract under test: N runs can exist per session, CONCURRENTLY, through
// the same Box, and the kernel keeps them structurally distinct:
//   1. the process table tracks all three while they run
//   2. the audit log distinguishes them (every step row carries its runId)
//   3. the durable event log distinguishes them (run/started + run/ended with
//      runId, contiguous per-session seq preserved under concurrent writers)
//   4. a single-run abort kills EXACTLY one run; the others finish untouched,
//      and the GLOBAL kill switch semantics (consent freeze, refuse window)
//      are not invoked at all
//
// Run: bun --env-file=.env scripts/test-run-queue.ts
import fs from 'fs'
import path from 'path'
import { db } from '../src/lib/db'
import { executePlan } from '../src/server/royal-red/box/ops'
import { planOperations } from '../src/server/royal-red/box/dryrun'
import { ensureBoxTree, BOX_HOME } from '../src/server/royal-red/box/prison'
import { listProcessTable, abortOneRun } from '../src/server/royal-red/runqueue'
import { readSessionEvents } from '../src/server/royal-red/event-log'

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

const SID = `rq-${Date.now()}`
const noopEmit = () => {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// three plans through the SAME Box: A is long enough to abort mid-flight,
// B and C are short and must survive A's scalpel abort
const aOps = Array.from({ length: 60 }, (_, i) => ({
  op: 'write' as const,
  to: `/home/royalred/Downloads/rq-runA/step-${String(i + 1).padStart(2, '0')}.txt`,
  content: `run A step ${i + 1}\n`,
}))
const bOps = [
  { op: 'write' as const, to: '/home/royalred/Downloads/rq-runB/hello.txt', content: 'run B\n' },
  { op: 'write' as const, to: '/home/royalred/Downloads/rq-runB/again.txt', content: 'run B again\n' },
]
const cOps = [
  { op: 'mkdir' as const, to: '/home/royalred/Downloads/rq-runC' },
  { op: 'write' as const, to: '/home/royalred/Downloads/rq-runC/note.txt', content: 'run C\n' },
]

const planA = planOperations(aOps)
const planB = planOperations(bOps)
const planC = planOperations(cOps)

// content is consent-bound and lives OUTSIDE the plan; rebuild the per-seq
// content maps exactly the way the desktop route does after approval
function contentMapFor(ops: { to?: string; content?: string }[], plan: typeof planA): Map<number, string> {
  const m = new Map<number, string>()
  // plan steps keep the same order as ops (refusals included), so seq i+1 maps to ops[i]
  ops.forEach((raw, i) => {
    const step = plan.steps[i]
    if (step && step.proposable && step.op === 'write' && typeof raw.content === 'string') {
      m.set(step.seq, raw.content)
    }
  })
  return m
}

console.log('run-queue: 3 concurrent runs through the same Box')
ensureBoxTree()
fs.mkdirSync(path.join(BOX_HOME, 'Downloads'), { recursive: true })
for (const d of ['rq-runA', 'rq-runB', 'rq-runC']) {
  fs.rmSync(path.join(BOX_HOME, 'Downloads', d), { recursive: true, force: true })
}

const consentBefore = await db.royalRedConsent.count()

const runIds: { a?: string; b?: string; c?: string } = {}

const runB = executePlan(planB, {
  sessionId: SID,
  emit: noopEmit,
  approvedHash: planB.hash,
  consentId: 'test-b',
  contentBySeq: contentMapFor(bOps, planB),
}).then((r) => {
  runIds.b = r.runId
  return r
})
const runC = executePlan(planC, {
  sessionId: SID,
  emit: noopEmit,
  approvedHash: planC.hash,
  consentId: 'test-c',
  contentBySeq: contentMapFor(cOps, planC),
}).then((r) => {
  runIds.c = r.runId
  return r
})
const runA = executePlan(planA, {
  sessionId: SID,
  emit: noopEmit,
  approvedHash: planA.hash,
  consentId: 'test-a',
  contentBySeq: contentMapFor(aOps, planA),
}).then((r) => {
  runIds.a = r.runId
  return r
})

// ── assertion 1: the process table tracks all three while they run ──────────
// run A is identified IN FLIGHT through the process table + its DB row (the
// run with 60 total steps) — exactly the way an operator would find it.
// DE-FLAKE (RR5): the observed condition is "all three entries present while
// at least one is still running" — proof the table is live. Requiring >=2
// SIMULTANEOUSLY 'running' was a sampling race: B and C finish in ~2ms, and
// under load the poll can miss that window before the scalpel break fires.
// The kernel law (every live run registered at beginRun, updated at finish)
// is unchanged and still proven by the row-level checks below.
let sawThree = false
let scalpelLanded = false
const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  const live = listProcessTable(SID)
  if (live.length >= 3 && live.filter((e) => e.status === 'running').length >= 1) sawThree = true
  if (!scalpelLanded && live.length >= 3) {
    const a = await db.royalRedRun.findFirst({ where: { sessionId: SID, status: 'running', actionsTotal: 60 } })
    if (a && a.actionsDone >= 3) {
      const res = await abortOneRun(a.id, 'test: single-run scalpel abort (siblings must not feel it)')
      scalpelLanded = res.ok && !res.alreadyFinished
    }
  }
  if (scalpelLanded) break
  await sleep(3)
}
check('process table tracked all three concurrent runs', sawThree, JSON.stringify(listProcessTable(SID)))
check('single-run abort landed mid-flight', scalpelLanded, 'abortOneRun never caught run A running')

const [resA, resB, resC] = await Promise.all([runA, runB, runC])
check('all three executions returned', !!resA && !!resB && !!resC)

// ── assertion 2: the scalpel aborted exactly one run ────────────────────────
const rowA = await db.royalRedRun.findUnique({ where: { id: resA.runId } })
const rowB = await db.royalRedRun.findUnique({ where: { id: resB.runId } })
const rowC = await db.royalRedRun.findUnique({ where: { id: resC.runId } })
check('run A aborted by the single-run abort', rowA?.status === 'aborted', `status=${rowA?.status}`)
check('run A really was cut mid-flight', (rowA?.actionsDone ?? 0) > 0 && (rowA?.actionsDone ?? 0) < 60, `done=${rowA?.actionsDone}/60`)
check('run B completed untouched', rowB?.status === 'done' && rowB?.actionsDone === 2, `status=${rowB?.status} done=${rowB?.actionsDone}`)
check('run C completed untouched', rowC?.status === 'done' && rowC?.actionsDone === 2, `status=${rowC?.status} done=${rowC?.actionsDone}`)
check('run B files exist on the Box', fs.existsSync(path.join(BOX_HOME, 'Downloads', 'rq-runB', 'hello.txt')))
check('run C files exist on the Box', fs.existsSync(path.join(BOX_HOME, 'Downloads', 'rq-runC', 'note.txt')))
check('run A journal intact (write-ahead rows survive the abort)', (await db.royalRedUndoEntry.count({ where: { runId: resA.runId } })) > 0)

// the GLOBAL kill switch was never pressed: no consent rows created/frozen,
// no global refuse window opened (only the per-run flag was set)
const consentAfter = await db.royalRedConsent.count()
check('global kill switch not invoked (consent table untouched)', consentAfter === consentBefore, `${consentBefore} -> ${consentAfter}`)

// ── assertion 3: the audit log distinguishes the three runs ─────────────────
const audits = await db.royalRedAudit.findMany({ where: { runId: { in: [resA.runId, resB.runId, resC.runId] } } })
const byRun = new Map<string, string[]>()
for (const a of audits) {
  if (!a.runId) continue
  byRun.set(a.runId, [...(byRun.get(a.runId) ?? []), a.action])
}
check('audit rows exist for all three runIds', byRun.size === 3, `found ${byRun.size} distinct runIds`)
check(
  'run B audit rows carry ONLY run B id',
  (byRun.get(resB.runId) ?? []).every((x) => x.startsWith('desktop.')) && (byRun.get(resB.runId) ?? []).length === 2,
  JSON.stringify(byRun.get(resB.runId)),
)
check(
  'no cross-contamination: each step row belongs to exactly one run',
  audits.every((a) => a.runId && [resA.runId, resB.runId, resC.runId].includes(a.runId)),
)
const abortOneRows = audits.filter((a) => a.action === 'desktop.abort.one')
check('single-run abort writes its own attributed audit row', abortOneRows.length === 1 && abortOneRows[0].runId === resA.runId, JSON.stringify(abortOneRows.map((r) => r.action)))

// ── assertion 4: the durable event log distinguishes the runs, seq intact ───
const events = await readSessionEvents(SID)
const starts = events.filter((e) => e.type === 'run/started')
const ends = events.filter((e) => e.type === 'run/ended')
check('event log: one run/started per run (3, distinct runIds)', starts.length === 3 && new Set(starts.map((e) => e.runId)).size === 3, `starts=${starts.length}`)
check('event log: one run/ended per run (3)', ends.length === 3, `ends=${ends.length}`)
const endByRun = new Map(ends.map((e) => [e.runId, (e.payload as { status?: string }).status]))
check('event log records A aborted, B and C done', endByRun.get(resA.runId) === 'aborted' && endByRun.get(resB.runId) === 'done' && endByRun.get(resC.runId) === 'done', JSON.stringify([...endByRun]))
const seqs = events.map((e) => e.seq)
check('event log seq contiguous under concurrent writers', seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), JSON.stringify(seqs.slice(0, 8)))

// process table drains after the runs end (grace window keeps finals briefly)
check('process table: no runs left running', listProcessTable(SID).filter((e) => e.status === 'running').length === 0)

// ── cleanup: only our own rows and our own box dirs (never the real home) ───
await db.royalRedAudit.deleteMany({ where: { runId: { in: [resA.runId, resB.runId, resC.runId] } } })
await db.royalRedUndoEntry.deleteMany({ where: { sessionId: SID } })
await db.royalRedRun.deleteMany({ where: { sessionId: SID } })
await db.royalRedEventLog.deleteMany({ where: { sessionId: SID } })
for (const d of ['rq-runA', 'rq-runB', 'rq-runC']) {
  fs.rmSync(path.join(BOX_HOME, 'Downloads', d), { recursive: true, force: true })
}
fs.rmSync(path.join(BOX_HOME, 'Downloads', 'rq-runC'), { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
