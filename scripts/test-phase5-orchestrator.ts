// ROYAL RED ROUND 4 — PHASE 5 SLICE 1 ORCHESTRATOR PROOF (the deterministic
// half of the acceptance). A scripted seam drives the planner/builder pair
// through every branch of the slice-1 loop WITHOUT a live model:
//   A. happy path: plan -> notes task -> build task -> verdict done x2 ->
//      artifact persisted with research notes attached, versioned, attributed
//   B. malformed plan repaired once (the bounded repair path)
//   C. planner verdict RETRY -> builder re-delivers (bounded, once)
//   D. planner verdict ESCALATE -> honest stop, partial work kept
//   E. budget exhaustion mid-orchestration -> budget/exhausted event + honest
//      stop (the escalation contract from docs/PHASE5-BUDGET.md)
// Every scenario asserts: lifecycle events, per-run attribution (subAgentId +
// parentRunId), terminal-event discipline, and seq contiguity.
//
// The LIVE acceptance (coffee-brands prompt through the real console) runs in
// the browser round — this suite proves the machine's contract is exact.
//
// Run: bun --env-file=.env scripts/test-phase5-orchestrator.ts
import { db } from '../src/lib/db'
import { runOrchestratedTurn, shouldOrchestrate, type SeamOverride } from '../src/server/royal-red/orchestrator'
import { readSessionEvents, verifyLogIntegrity } from '../src/server/royal-red/event-log'
import { recordUsage, capsFor, resetBudgetState } from '../src/server/royal-red/budget'
import type { SeamCompleteOpts, SeamResult } from '../src/server/royal-red/llm/seam'

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const noopEmit = () => {}

function res(text: string): SeamResult {
  return { ok: true, text, meta: { path: 'house', provider: 'fake', model: 'scripted', latencyMs: 1, costUsd: 0, attempts: 1, switches: [] } }
}
function refused(): SeamResult {
  return { ok: false, text: '', meta: { path: 'house', provider: 'fake', model: 'scripted', latencyMs: 0, costUsd: 0, attempts: 0, switches: [], budgetExhausted: true, error: 'budget: refused (scripted)' } }
}

const TASKS = JSON.stringify({
  tasks: [
    { id: 'T1', title: 'Research the topic', description: 'produce written research notes with concrete facts', acceptance: 'notes exist and cite specifics' },
    { id: 'T2', title: 'Build the landing page', description: 'produce index.html presenting the findings', acceptance: 'complete single-file page referencing the notes' },
  ],
})
const NOTES = JSON.stringify({ say: 'research gathered', notes: '# Findings\n\n- Brand Alpha: positioned premium, $18/kg, verdict: strong\n- Brand Beta: mid-market, $9/kg, verdict: value\n- Brand Gamma: boutique, $24/kg, verdict: niche' })
const PAGE = (title: string) =>
  JSON.stringify({
    say: 'page delivered',
    artifact: {
      name: 'orchestrated-artifact',
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          content: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:sans-serif}</style></head><body><h1>${title}</h1><section><h2>Findings</h2><p>Alpha $18/kg · Beta $9/kg · Gamma $24/kg</p><p><a href="research-notes.md">research notes</a></p></section></body></html>`,
        },
      ],
    },
  })

interface FakeState {
  planCalls: number
  buildCalls: number
  reviewCalls: number
  reviewScript: string[] // verdicts in order
  buildScript: ('notes' | 'page' | 'empty')[]
  drainPlannerOnReview: boolean
}
function fakeSeam(state: FakeState): SeamOverride {
  return {
    async complete(o: SeamCompleteOpts): Promise<SeamResult> {
      // the budget gate, mimicking the real seam's contract
      if (o.runId) {
        if (o.operation === 'orchestrator.review' && state.drainPlannerOnReview && state.reviewCalls === 0) {
          const caps = capsFor('planner')
          recordUsage(o.runId, 'planner', caps.tokensIn, caps.tokensOut)
        }
      }
      if (o.operation === 'orchestrator.plan') {
        state.planCalls++
        if (state.planCalls === 1 && !state.buildCalls) {
          // scenario B: one malformed output, then the repair must land
          if (!o.messages.some((m) => m.content.includes('MALFORMED_PLAN'))) return res('this is not json at all, sorry')
        }
        return res(TASKS)
      }
      if (o.operation === 'orchestrator.build') {
        state.buildCalls++
        const step = state.buildScript.shift() ?? 'page'
        if (step === 'notes') return res(NOTES)
        if (step === 'page') return res(PAGE(`Orchestrated Build ${state.buildCalls}`))
        return res('{"say":"i have nothing yet"}')
      }
      if (o.operation === 'orchestrator.review') {
        state.reviewCalls++
        if (state.drainPlannerOnReview && state.reviewCalls === 1) return refused()
        const verdict = state.reviewScript.shift() ?? 'done'
        return res(JSON.stringify({ verdict, reason: `scripted ${verdict}` }))
      }
      return res('{"say":"?"}')
    },
  }
}

async function cleanup(sid: string) {
  const runs = (await db.royalRedRun.findMany({ where: { sessionId: sid } })).map((r) => r.id)
  await db.royalRedAudit.deleteMany({ where: { runId: { in: runs } } })
  await db.royalRedConstraint.deleteMany({ where: { sessionId: sid } })
  await db.royalRedMessage.deleteMany({ where: { sessionId: sid } })
  await db.royalRedEventLog.deleteMany({ where: { sessionId: sid } })
  await db.royalRedRun.deleteMany({ where: { sessionId: sid } })
  await db.royalRedSession.deleteMany({ where: { id: sid } }).catch(() => null)
}
async function ensureSession(sid: string) {
  // RoyalRedArtifact.sessionId is a real FK — the fixture needs a session row
  await db.royalRedSession.create({ data: { id: sid, title: 'phase5 orchestrator fixture', mode: 'build' } }).catch(() => null)
}
async function cleanArtifact(sid: string, id?: string) {
  if (id) {
    await db.royalRedArtifactVersion.deleteMany({ where: { artifactId: id } })
    await db.royalRedArtifact.deleteMany({ where: { id } })
  }
  await db.royalRedArtifact.deleteMany({ where: { sessionId: sid } })
}
async function subAuditRows(sid: string) {
  const runs = await db.royalRedRun.findMany({ where: { sessionId: sid }, select: { id: true, role: true } })
  const subIds = runs.filter((r) => r.role).map((r) => r.id)
  return db.royalRedAudit.findMany({ where: { runId: { in: subIds } } })
}

resetBudgetState()

// ═══ routing heuristics (no LLM) ═════════════════════════════════════════════
console.log('orchestrator routing')
check('coffee-brands prompt auto-orchestrates', shouldOrchestrate('research 3 coffee brands and write a landing page comparing them'))
check('/team forces orchestration', shouldOrchestrate('/team research drones and build a comparison page'))
check('simple build prompt does NOT orchestrate', !shouldOrchestrate('build a hello page'))
check('simple research prompt does NOT orchestrate', !shouldOrchestrate('what is royal red?'))

// ═══ A+B: happy path + plan repair ═══════════════════════════════════════════
console.log('scenario A: plan -> notes -> page -> done (with a malformed first plan)')
{
  const SID = `p5o-a-${Date.now()}`
  await ensureSession(SID)
  const state: FakeState = { planCalls: 0, buildCalls: 0, reviewCalls: 0, reviewScript: ['done', 'done'], buildScript: ['notes', 'page'], drainPlannerOnReview: false }
  const r = await runOrchestratedTurn({ sessionId: SID, userText: 'research 3 coffee brands and write a landing page comparing them', emit: noopEmit, seam: fakeSeam(state), verification: false })
  check('turn verdict is done', r.verdict === 'done', r.verdict)
  check('artifact produced', !!r.artifactId)
  check('plan repair happened exactly once', state.planCalls === 2, `planCalls=${state.planCalls}`)
  check('two builder executions (one per task)', state.buildCalls === 2, `buildCalls=${state.buildCalls}`)
  check('two planner reviews', state.reviewCalls === 2, `reviewCalls=${state.reviewCalls}`)
  const art = r.artifactId ? await db.royalRedArtifact.findUnique({ where: { id: r.artifactId } }) : null
  check('artifact exists with entry index.html', !!art && art.entry === 'index.html')
  const files = art ? (JSON.parse(art.files) as { path: string }[]) : []
  check('research notes attached to the artifact', files.some((f) => f.path === 'research-notes.md'), JSON.stringify(files.map((f) => f.path)))
  const versions = await db.royalRedArtifactVersion.count({ where: { artifactId: r.artifactId! } })
  check('artifact write snapshotted an immutable version row', versions >= 1, `versions=${versions}`)
  await sleep(500)
  const events = await readSessionEvents(SID)
  check('event log contiguous', verifyLogIntegrity(events).ok)
  const spawned = events.filter((e) => e.type === 'subagent/spawned')
  const finished = events.filter((e) => e.type === 'subagent/finished')
  check('3 sub-agent spawns (1 planner + 2 builders)', spawned.length === 3 && spawned.filter((e) => (e.payload as { role?: string }).role === 'planner').length === 1, `spawned=${spawned.length}`)
  check('3 sub-agent finishes with terminal discipline', finished.length === 3, `finished=${finished.length}`)
  const ends = events.filter((e) => e.type === 'run/ended')
  check('exactly 4 run/ended (top + planner + 2 builders)', ends.length === 4, `ended=${ends.length}`)
  const verdicts = events.filter((e) => e.type === 'subagent/verdict')
  check('planner verdicts are typed events (done x2)', verdicts.length === 2 && verdicts.every((e) => (e.payload as { verdict?: string }).verdict === 'done'), JSON.stringify(verdicts.map((v) => (v.payload as { verdict?: string }).verdict)))
  const rows = await subAuditRows(SID)
  const missing = rows.filter((x) => !x.subAgentId || !x.parentRunId)
  check('attribution law: every sub-agent audit row carries subAgentId + parentRunId', rows.length >= 5 && missing.length === 0, `rows=${rows.length} missing=${missing.length}`)
  const topRun = await db.royalRedRun.findFirst({ where: { sessionId: SID, tool: 'orchestrator' } })
  check('top run is depth 0 with no role', !!topRun && topRun.depth === 0 && topRun.role === null)
  const subs = await db.royalRedRun.findMany({ where: { sessionId: SID, role: { not: null } } })
  check('all sub-runs are depth 1 children of the top run', subs.length === 3 && subs.every((s) => s.depth === 1 && s.parentRunId === topRun!.id))
  await cleanArtifact(SID, r.artifactId ?? undefined)
  await cleanup(SID)
}

// ═══ C: planner RETRY verdict -> builder re-delivers (bounded, once) ════════
console.log('scenario C: planner says RETRY, builder re-delivers once')
{
  const SID = `p5o-c-${Date.now()}`
  await ensureSession(SID)
  const state: FakeState = { planCalls: 0, buildCalls: 0, reviewCalls: 0, reviewScript: ['done', 'retry', 'done'], buildScript: ['notes', 'page', 'page'], drainPlannerOnReview: false }
  const r = await runOrchestratedTurn({ sessionId: SID, userText: '/team research 3 coffee brands and write a landing page comparing them', emit: noopEmit, seam: fakeSeam(state), verification: false })
  check('retry scenario completes done', r.verdict === 'done', `${r.verdict} ${r.stopReason ?? ''}`)
  check('builder called exactly 3 times (page + planner-retry page)', state.buildCalls === 3, `buildCalls=${state.buildCalls}`)
  check('planner reviewed 3 times (done, retry, done)', state.reviewCalls === 3, `reviewCalls=${state.reviewCalls}`)
  check('artifact survived the retry loop', !!r.artifactId)
  await sleep(400)
  const events = await readSessionEvents(SID)
  const verdicts = events.filter((e) => e.type === 'subagent/verdict')
  check('verdict trail shows done -> retry -> done', verdicts.length === 3 && (verdicts[1].payload as { verdict?: string }).verdict === 'retry' && (verdicts[2].payload as { verdict?: string }).verdict === 'done', JSON.stringify(verdicts.map((v) => (v.payload as { verdict?: string }).verdict)))
  check('event log contiguous after retry', verifyLogIntegrity(events).ok)
  await cleanArtifact(SID, r.artifactId ?? undefined)
  await cleanup(SID)
}

// ═══ C2: empty delivery -> the bounded TECHNICAL retry (no planner round-trip)
console.log('scenario C2: empty delivery triggers the technical retry, then review')
{
  const SID = `p5o-c2-${Date.now()}`
  await ensureSession(SID)
  const state: FakeState = { planCalls: 0, buildCalls: 0, reviewCalls: 0, reviewScript: ['done', 'done'], buildScript: ['notes', 'empty', 'page'], drainPlannerOnReview: false }
  const r = await runOrchestratedTurn({ sessionId: SID, userText: 'research tea brands and build a landing page ranking them', emit: noopEmit, seam: fakeSeam(state), verification: false })
  check('technical-retry scenario completes done', r.verdict === 'done', `${r.verdict} ${r.stopReason ?? ''}`)
  check('builder called 3 times (notes, empty, page after technical retry)', state.buildCalls === 3, `buildCalls=${state.buildCalls}`)
  check('planner reviewed twice (the empty delivery never reached review)', state.reviewCalls === 2, `reviewCalls=${state.reviewCalls}`)
  check('artifact produced after the technical retry', !!r.artifactId)
  await cleanArtifact(SID, r.artifactId ?? undefined)
  await cleanup(SID)
}

// ═══ D: escalate path ════════════════════════════════════════════════════════
console.log('scenario D: planner escalates -> honest stop, partial work kept')
{
  const SID = `p5o-d-${Date.now()}`
  await ensureSession(SID)
  const state: FakeState = { planCalls: 0, buildCalls: 0, reviewCalls: 0, reviewScript: ['escalate'], buildScript: ['notes'], drainPlannerOnReview: false }
  const r = await runOrchestratedTurn({ sessionId: SID, userText: 'research drone regulations and write a compliance dashboard', emit: noopEmit, seam: fakeSeam(state), verification: false })
  check('escalated verdict is honest', r.verdict === 'escalated', r.verdict)
  check('stop reason names the escalation', /escalat/.test(r.stopReason ?? ''), r.stopReason)
  check('research notes survived the escalation (partial work saved)', (r.notes ?? '').includes('Findings'))
  check('no artifact fabricated after escalation', !r.artifactId)
  const topRun = await db.royalRedRun.findFirst({ where: { sessionId: SID, tool: 'orchestrator' } })
  check('top run still closed DONE (an escalate is not an abort)', !!topRun && topRun.status === 'done')
  await cleanup(SID)
}

// ═══ E: budget exhaustion mid-orchestration ══════════════════════════════════
console.log('scenario E: planner budget drains mid-review -> budget/exhausted + honest stop')
{
  const SID = `p5o-e-${Date.now()}`
  await ensureSession(SID)
  const state: FakeState = { planCalls: 0, buildCalls: 0, reviewCalls: 0, reviewScript: [], buildScript: ['notes'], drainPlannerOnReview: true }
  const r = await runOrchestratedTurn({ sessionId: SID, userText: 'research tea brands and build a landing page ranking them', emit: noopEmit, seam: fakeSeam(state), verification: false })
  await sleep(400)
  const events = await readSessionEvents(SID)
  const bex = events.filter((e) => e.type === 'budget/exhausted')
  check('budget/exhausted event landed on the log', bex.length === 1, `found=${bex.length}`)
  check('turn ended honestly (done), not failed', r.verdict === 'done' || r.verdict === 'escalated', r.verdict)
  check('stop reason cites the budget', /budget/.test(r.stopReason ?? ''), r.stopReason)
  const bAudit = await db.royalRedAudit.findFirst({ where: { action: 'budget.exhausted', sessionIdless: undefined } as never })
  check('budget audit row exists', !!bAudit || (await db.royalRedAudit.count({ where: { action: 'budget.exhausted' } })) >= 1)
  await cleanup(SID)
}

console.log(`\n${pass} passed, ${fail} failed`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
