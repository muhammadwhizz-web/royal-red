// Phase 5 prep (Task 21-d): budget policy unit tests.
// Run: bun scripts/test-budget.ts  (mirrors scripts/test-phase4.ts style:
// check() counting pass/fail, exit code 1 on failure, no dev server needed)
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { planOperations } from '../src/server/awon/box/dryrun'
import { beginRun, finishRun } from '../src/server/awon/box/ops'
import { getPolicy, setPolicy, reserveRun, releaseRun, assertTokenBudget, assertWallClock, DEFAULT_POLICY, type BudgetPolicy } from '../src/server/awon/box/budget'

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

// SQLite can be contended (dev server / cron / parallel suites): one 2s retry
async function retryDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (/database is locked|SQLITE_BUSY/i.test(String((e as Error).message))) {
      await new Promise((r) => setTimeout(r, 2000))
      return fn()
    }
    throw e
  }
}

const { db } = await import('../src/lib/db')
const SID = 'bgt-session'
const SCRIPTS_DIR = process.cwd()
const PROBE = path.join(SCRIPTS_DIR, 'scripts', 'bgt-env-probe.tmp.ts')

const ORIGINAL_POLICY = getPolicy() // restored in finally

async function main() {
  // normalize the in-process policy to the shipped defaults first
  setPolicy({ ...DEFAULT_POLICY, maxTokensPerRun: DEFAULT_POLICY.maxTokensPerRun, maxWallClockMsPerRun: DEFAULT_POLICY.maxWallClockMsPerRun })
  console.log('budget policy defaults + config surface:')
  const p = getPolicy()
  check('defaults shipped', p.maxConcurrentRuns === 4 && p.maxTokensPerRun === 400000 && p.maxWallClockMsPerRun === 600000 && p.maxSubAgentsPerRun === 0, JSON.stringify(p))
  check('escalation pinned fail_closed', p.escalation === 'fail_closed')
  const patched = setPolicy({ maxTokensPerRun: 1000, maxWallClockMsPerRun: 50 })
  check('setPolicy applies partial patch', patched.maxTokensPerRun === 1000 && patched.maxWallClockMsPerRun === 50 && patched.maxConcurrentRuns === p.maxConcurrentRuns)
  check('setPolicy cannot un-pin escalation', setPolicy({ escalation: 'fail_open' } as unknown as Partial<BudgetPolicy>).escalation === 'fail_closed')

  // baseline: other runs may be 'running' from other suites - size the cap
  // RELATIVE to the baseline so this test is deterministic in a shared DB
  const baseline = await retryDb(() => db.awonRun.count({ where: { status: 'running' } }))
  const max = baseline + 4
  setPolicy({ maxConcurrentRuns: max })

  console.log('concurrency cap (hard, fail-closed):')
  for (let i = 1; i <= 4; i++) {
    await retryDb(() => db.awonRun.create({ data: { id: `bgt-run-${i}`, sessionId: SID, tool: 'budget-test' } }))
  }
  const r5 = await retryDb(() => reserveRun('bgt-run-5'))
  check('5th concurrent run REFUSED', r5.ok === false && (r5.reason ?? '').includes('concurrency cap'), JSON.stringify(r5))
  check('refusal reports the numbers', r5.activeRuns === max && r5.maxConcurrentRuns === max, JSON.stringify(r5))

  const rel = await retryDb(() => releaseRun('bgt-run-1'))
  const bgt1 = await retryDb(() => db.awonRun.findUnique({ where: { id: 'bgt-run-1' } }))
  check('releaseRun frees the slot', rel.ok === true && bgt1?.status === 'aborted' && (bgt1.abortReason ?? '').includes('budget.release'), JSON.stringify({ rel, status: bgt1?.status }))
  const r5b = await retryDb(() => reserveRun('bgt-run-5'))
  check('slot reusable after release', r5b.ok === true, JSON.stringify(r5b))

  const refusedAudit = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.reserve', detail: { contains: 'runId=bgt-run-5 REFUSED' } }, orderBy: { createdAt: 'desc' } }))
  check('refusal audited (budget.reserve ok=false)', refusedAudit !== null && refusedAudit.ok === false)
  const releaseAudit = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.release', detail: { contains: 'runId=bgt-run-1' } }, orderBy: { createdAt: 'desc' } }))
  check('release audited (budget.release)', releaseAudit !== null && releaseAudit.ok === true)

  console.log('ops.ts wire-in:')
  // finishRun -> releaseRun receipt (the production path)
  await finishRun('bgt-run-3', 'done')
  const bgt3 = await retryDb(() => db.awonRun.findUnique({ where: { id: 'bgt-run-3' } }))
  const relAudit = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.release', detail: { contains: 'runId=bgt-run-3' } }, orderBy: { createdAt: 'desc' } }))
  check('finishRun marks done + budget.release receipt', bgt3?.status === 'done' && relAudit !== null, JSON.stringify({ status: bgt3?.status }))
  // beginRun refuses end-to-end: 2 bgt rows still running, cap them exactly
  setPolicy({ maxConcurrentRuns: baseline + 2 })
  const probePlan = planOperations([{ op: 'write', to: '~/bgt-probe.txt', content: 'budget probe' }])
  let refused = false
  try {
    await beginRun(SID, 'budget-test', probePlan)
  } catch (e) {
    refused = /budget policy/.test(String((e as Error).message))
  }
  check('beginRun throws on cap (fail-closed)', refused)
  const refusedRun = await retryDb(() => db.awonRun.findFirst({ where: { sessionId: SID, tool: 'budget-test' }, orderBy: { startedAt: 'desc' } }))
  check('refused run row marked aborted with budget reason', refusedRun?.status === 'aborted' && (refusedRun.abortReason ?? '').startsWith('budget:'), JSON.stringify({ status: refusedRun?.status, why: refusedRun?.abortReason }))

  console.log('token + wall-clock (advisory until Phase 5 wires agent.ts):')
  setPolicy({ maxTokensPerRun: 1000 })
  const tokOk = await assertTokenBudget('bgt-run-2', 500)
  const tokBad = await assertTokenBudget('bgt-run-2', 1500)
  check('assertTokenBudget under cap ok', tokOk.ok === true && tokOk.exceeded === false && tokOk.used === 500 && tokOk.max === 1000, JSON.stringify(tokOk))
  check('assertTokenBudget over cap exceeded', tokBad.ok === false && tokBad.exceeded === true && tokBad.used === 1500, JSON.stringify(tokBad))
  const tokAuditOk = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.tokens', detail: { contains: 'runId=bgt-run-2 used=500' } }, orderBy: { createdAt: 'desc' } }))
  const tokAuditBad = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.tokens', detail: { contains: 'runId=bgt-run-2 used=1500' } }, orderBy: { createdAt: 'desc' } }))
  check('token decisions audited ok=true and ok=false', tokAuditOk?.ok === true && tokAuditBad?.ok === false)

  const wcOk = await assertWallClock('bgt-run-2', Date.now() - 10)
  await new Promise((r) => setTimeout(r, 60))
  const wcBad = await assertWallClock('bgt-run-2', Date.now() - 80)
  check('assertWallClock under cap ok', wcOk.ok === true && wcOk.exceeded === false, JSON.stringify(wcOk))
  check('assertWallClock over cap exceeded', wcBad.ok === false && wcBad.exceeded === true && wcBad.elapsedMs >= 80, JSON.stringify(wcBad))
  const wcAuditBad = await retryDb(() => db.awonAudit.findFirst({ where: { action: 'budget.wallclock', detail: { contains: 'runId=bgt-run-2' } }, orderBy: { createdAt: 'desc' } }))
  check('wall-clock decisions audited', wcAuditBad !== null)

  console.log('env-var config (read once at module load):')
  // env overrides are read at import time, so prove them in a fresh process
  await fs.promises.writeFile(
    PROBE,
    `import { getPolicy } from '../src/server/awon/box/budget'\nconsole.log('POLICY_JSON=' + JSON.stringify(getPolicy()))\n`,
    'utf8',
  )
  const proc = spawnSync('bun', ['scripts/bgt-env-probe.tmp.ts'], {
    cwd: SCRIPTS_DIR,
    env: { ...process.env, AWON_MAX_CONCURRENT_RUNS: '7', AWON_MAX_TOKENS_PER_RUN: '123', AWON_MAX_WALLCLOCK_MS_PER_RUN: '456' },
    encoding: 'utf8',
  })
  const out = proc.stdout ?? ''
  const line = out.split('\n').find((l) => l.startsWith('POLICY_JSON='))
  let envPolicy: Record<string, unknown> | null = null
  try {
    envPolicy = JSON.parse(line!.slice('POLICY_JSON='.length))
  } catch {}
  check('AWON_MAX_CONCURRENT_RUNS=7 parsed', envPolicy?.maxConcurrentRuns === 7, out.slice(0, 200))
  check('AWON_MAX_TOKENS_PER_RUN=123 parsed', envPolicy?.maxTokensPerRun === 123, JSON.stringify(envPolicy))
  check('AWON_MAX_WALLCLOCK_MS_PER_RUN=456 parsed', envPolicy?.maxWallClockMsPerRun === 456, JSON.stringify(envPolicy))
  check('maxSubAgentsPerRun has NO env override (stays 0)', envPolicy?.maxSubAgentsPerRun === 0, JSON.stringify(envPolicy))
  check('escalation still fail_closed under env config', envPolicy?.escalation === 'fail_closed', JSON.stringify(envPolicy))
}

try {
  await main()
} finally {
  // restore the policy for the rest of this process + clean ALL bgt-* rows
  setPolicy(ORIGINAL_POLICY)
  await db.awonRun.deleteMany({ where: { OR: [{ sessionId: SID }, { id: { startsWith: 'bgt-run-' } }, { tool: 'budget-test' }] } }).catch(() => null)
  await fs.promises.rm(PROBE, { force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
