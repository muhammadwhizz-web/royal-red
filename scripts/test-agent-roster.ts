// ROYAL RED ROUND 6 - AGENT ROSTER TEST (Section 3 laws, kernel level).
//
// Contract under test:
//   1. exactly 66 roles, unique names (the roster ceiling is deliberate)
//   2. the 12 categories from the spec are all populated with the spec counts
//   3. every provider binding is a known provider id (or the house builtin)
//   4. budgets are non-negative; capabilities are non-empty
//   5. dispatchForCapability resolves specific tasks to the right role
//      deterministically (website task -> Website Builder, critique -> Crown
//      Critic, remember -> Memory Keeper)
//   6. unavailabilityReport names the role and the provider honestly
//   7. kernel integration: spawnSubRun stamps the roster role on the run row
//      and every spawn/finish audit row (attribution law, Round 6 upgrade)
//
// Run: bun --env-file=.env scripts/test-agent-roster.ts
import { readFileSync } from 'fs'
import { db } from '../src/lib/db'
import { AGENT_ROSTER, ROSTER_CEILING, dispatchForCapability, unavailabilityReport, rosterStats } from '../src/server/royal-red/roster'
import { spawnSubRun, finishSubRun } from '../src/server/royal-red/subagents'
import { beginRun, finishRun } from '../src/server/royal-red/box/ops'
import { PROVIDERS } from '../src/server/royal-red/providers/registry'

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

async function main() {
  console.log('ROYAL RED agent roster test')

  // 1. ceiling + uniqueness
  check(`exactly ${ROSTER_CEILING} roles`, AGENT_ROSTER.length === ROSTER_CEILING, `got ${AGENT_ROSTER.length}`)
  const names = new Set(AGENT_ROSTER.map((r) => r.name))
  check('names are unique', names.size === AGENT_ROSTER.length)

  // 2. spec category counts
  const stats = rosterStats()
  const want: Record<string, number> = {
    planning: 5,
    building: 10,
    critique: 8,
    research: 8,
    writing: 8,
    data: 6,
    operations: 6,
    browser: 5,
    desktop: 4,
    memory: 3,
    communication: 2,
    specialist: 1,
  }
  let catOk = true
  for (const [cat, n] of Object.entries(want)) {
    if ((stats.byCategory[cat] ?? 0) !== n) {
      catOk = false
      console.log(`      category ${cat}: want ${n}, got ${stats.byCategory[cat] ?? 0}`)
    }
  }
  check('all 12 categories match the spec counts', catOk)

  // 3. provider bindings resolve
  const providerIds = new Set(PROVIDERS.map((p) => p.id))
  providerIds.add('royalred-builtin')
  const badBindings = AGENT_ROSTER.filter((r) => !providerIds.has(r.provider))
  check('every provider binding is a real provider id', badBindings.length === 0, badBindings.map((r) => `${r.name}:${r.provider}`).join(', '))

  // 4. budgets + capabilities
  check('budgets are non-negative', AGENT_ROSTER.every((r) => r.budgetUsd >= 0))
  check('every role owns at least one capability', AGENT_ROSTER.every((r) => r.capabilities.length >= 1))

  // 5. dispatch determinism
  const website = dispatchForCapability('build a landing page for the coffee brand website')
  check('website task -> Website Builder', website?.name === 'Website Builder', website?.name)
  const critique = dispatchForCapability('critique the quality of this build')
  check('critique task -> Crown Critic', critique?.name === 'Crown Critic', critique?.name)
  const memory = dispatchForCapability('remember this preference for later')
  check('memory task -> Memory Keeper', memory?.name === 'Memory Keeper', memory?.name)
  const wp = dispatchForCapability('generate a wordpress theme for the portfolio')
  check('wordpress task -> WordPress Builder', wp?.name === 'WordPress Builder', wp?.name)
  const again = dispatchForCapability('build a landing page for the coffee brand website')
  check('dispatch is deterministic (same input, same role)', again?.name === website?.name)
  check('no-match tasks return null, never a guess', dispatchForCapability('zzz qqq xyzzy') === null)

  // 6. honest unavailability
  const wb = AGENT_ROSTER.find((r) => r.name === 'Website Builder')!
  const report = unavailabilityReport({ ...wb, provider: 'deepseek' })
  check('unavailability report names role + provider', report.includes('Website Builder') && report.includes('deepseek'))
  check('builtin roles need no availability report', unavailabilityReport({ ...wb, provider: 'royalred-builtin' }) === '')

  // 7. kernel integration: the roster name rides on runs + audit rows
  const session = await db.royalRedSession.create({ data: { title: 'roster test', mode: 'build' } })
  const parentRunId = await beginRun(session.id, 'roster-test-parent', { hash: 'test', summary: { total: 0, consents: 0, proposable: 0 } } as never)

  const spawned = await spawnSubRun({ sessionId: session.id, parentRunId, role: 'planner', task: 'plan the landing page build' })
  if ('denied' in spawned) throw new Error('spawn unexpectedly denied')
  const plannerRun = await db.royalRedRun.findUnique({ where: { id: spawned.runId } })
  check('planner run stamps agentRole Supreme Planner', plannerRun?.agentRole === 'Supreme Planner', plannerRun?.agentRole ?? 'null')

  const spawnedB = await spawnSubRun({ sessionId: session.id, parentRunId, role: 'builder', task: 'build a landing page for the coffee brand website' })
  if ('denied' in spawnedB) throw new Error('builder spawn unexpectedly denied')
  const builderRun = await db.royalRedRun.findUnique({ where: { id: spawnedB.runId } })
  check('builder run resolves the roster by capability', builderRun?.agentRole === 'Website Builder', builderRun?.agentRole ?? 'null')

  const spawnAudit = await db.royalRedAudit.findFirst({ where: { action: 'subagent.spawned', runId: spawned.runId } })
  check('spawn audit row carries agentRole', spawnAudit?.agentRole === 'Supreme Planner', spawnAudit?.agentRole ?? 'null')

  await finishSubRun(spawned, 'done', 'roster test complete')
  const finishAudit = await db.royalRedAudit.findFirst({ where: { action: 'subagent.finished', runId: spawned.runId } })
  check('finish audit row carries agentRole', finishAudit?.agentRole === 'Supreme Planner', finishAudit?.agentRole ?? 'null')

  await finishSubRun(spawnedB, 'done', 'roster test complete')
  await finishRun(parentRunId, 'done')

  // cleanup
  await db.royalRedRun.deleteMany({ where: { sessionId: session.id } })
  await db.royalRedAudit.deleteMany({ where: { runId: { in: [spawned.runId, spawnedB.runId, parentRunId] } } })
  await db.royalRedSession.delete({ where: { id: session.id } }).catch(() => null)

  // 8. the memory file agrees with the code (ROYAL-RED.md names the roster)
  const memFile = readFileSync(new URL('../ROYAL-RED.md', import.meta.url), 'utf8')
  const missing = AGENT_ROSTER.filter((r) => !memFile.includes(r.name))
  check('ROYAL-RED.md documents every role name', missing.length === 0, missing.map((r) => r.name).join(', '))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
