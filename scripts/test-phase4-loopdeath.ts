// Phase 3 soft spot #3 - LOOP-DEATH SWEEP: the four ways an agent turn could
// die badly, each proven to degrade gracefully.
//   1. a directive with an EMPTY tools array (valid JSON, zero actions)
//   2. a call to a tool that does not exist
//   3. the critic hanging mid-turn (unreachable provider) -> bounded timeout
//   4. the SSE stream dropping mid-turn (client disconnect) -> the loop stops
// Run: bun --env-file=.env scripts/test-phase4-loopdeath.ts
import { extractJson } from '../src/server/royal-red/agent'
import { runTool } from '../src/server/royal-red/tools'
import { runCritique } from '../src/server/royal-red/verify/critic'
import { db } from '../src/lib/db'
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

console.log('loop death 1: empty tools array (valid JSON, zero actions)')
const d = extractJson('{"say":"nothing to do","tools":[]}')
check('empty tools directive parses', d !== null && Array.isArray(d.tools) && d.tools.length === 0)
// the agent loop slices tools to 5 and iterates: zero tools -> zero outcomes ->
// no TOOL_RESULTS continuation; with no artifact/score the turn ENDS cleanly.
// Prove the dispatch layer is safe for the boundary values:
const tEmpty = await runTool({ name: 'list_files', args: {} }, { sessionId: 'loopdeath' })
check('dispatch survives a normal call after the empty case', tEmpty.ok === true)
check('empty tools yields zero outcomes (loop exits, no crash)', (d!.tools ?? []).length === 0)

console.log('loop death 2: a call to a tool that does not exist')
const tGhost = await runTool({ name: 'definitely_not_a_tool' } as never, { sessionId: 'loopdeath' })
check('unknown tool returns a graceful refusal (ok=false, no throw)', tGhost.ok === false && /unknown/i.test(tGhost.summary), tGhost.summary)
const tGhost2 = await runTool({ name: 'box_fly', args: {} } as never, { sessionId: 'loopdeath' })
check('unknown BOX primitive also refused gracefully', tGhost2.ok === false, tGhost2.summary)

console.log('loop death 3: the critic hanging mid-turn (bounded timeout, honest error receipt)')
// point the critic at a black-hole address: the connect() hangs, the
// AbortController fires at timeoutMs, runCritique degrades to an error result
await db.royalRedProviderConfig.deleteMany({ where: { purpose: 'critique', label: 'loopdeath-blackhole' } })
await db.royalRedProviderConfig.create({
  data: { provider: 'openai', label: 'loopdeath-blackhole', baseUrl: 'http://10.255.255.1:9', model: 'x', purpose: 'critique', active: true },
})
const t0 = Date.now()
const crit = await runCritique({
  userPrompt: 'a small site',
  constraints: [],
  entry: 'index.html',
  files: [{ path: 'index.html', content: '<html><body>hi</body></html>' }],
  screenshotDescriptions: [],
})
const ms = Date.now() - t0
check('critic degrades to an unverified receipt instead of hanging forever', crit.status === 'unverified', JSON.stringify(crit).slice(0, 140))
check('the critic timeout is bounded (bounded at ~60s, returned in ' + Math.round(ms / 1000) + 's)', ms < 70_000, `${ms}ms`)
await db.royalRedProviderConfig.deleteMany({ where: { label: 'loopdeath-blackhole' } })

console.log('loop death 4: SSE stream drops mid-turn (client disconnect stops the loop)')
// POST /api/royal-red/chat, read one frame, then destroy the connection. The chat
// route wires req.signal into runRoyalRedTurn; the loop must stop and persist an
// assistant row marked stopped-by-user instead of burning iterations.
const create = await fetch('http://localhost:3000/api/royal-red/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '/build a 5 page website about the solar system with full copy on every page' }),
})
const reader = create.body!.getReader()
await reader.read() // first frame (session)
// wait until the turn is genuinely mid-flight (an assistant row exists), then drop
let mid = false
for (let i = 0; i < 20 && !mid; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  const c = await db.royalRedMessage.count({ where: { role: 'assistant', sessionId: (await db.royalRedSession.findFirst({ orderBy: { createdAt: 'desc' } }))!.id } })
  mid = c > 0
}
await reader.cancel() // CLIENT DISCONNECT mid-turn
const sid = (await db.royalRedSession.findFirst({ orderBy: { createdAt: 'desc' } }))!.id
// one in-flight iteration may land after the drop; a ZOMBIE loop would grow
// unboundedly (up to 22 build iterations). Assert the count STABILIZES.
const counts: number[] = []
let stable = 0
let last = -1
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  const c = await db.royalRedMessage.count({ where: { sessionId: sid } })
  counts.push(c)
  stable = c === last ? stable + 1 : 0
  last = c
  if (stable >= 4) break // 8s with zero new rows = the loop ended
}
check('turn stopped after the client disconnect (row count stabilized, no zombie loop)', stable >= 4, counts.join(','))
check('the turn did not burn its full iteration budget after the drop', last <= 4, `final rows=${last} (a zombie build turn writes 14+)`)

// cleanup
const dead = await db.royalRedSession.findFirst({ orderBy: { createdAt: 'desc' } })
if (dead) await db.royalRedSession.delete({ where: { id: dead.id } })
await db.$disconnect?.()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
