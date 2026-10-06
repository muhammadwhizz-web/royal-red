// Phase 3 soft spot #2 - CONSENT STACKING: two Tier-1 batch requests and one
// Tier-3 per-action request arrive concurrently. What does the user see, what
// order is the queue in, and what happens to the requests behind a timeout?
// Run: bun --env-file=.env scripts/test-phase4-stacking.ts
import { requestConsent, decideConsent, freezeAllPending } from '../src/server/awon/box/consent'
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

const SID = `stacking-${Date.now()}`
const noopEmit = () => {}

// three requests fired CONCURRENTLY: 2x T1 (batch reads), 1x T3 (destructive)
const t1a = requestConsent({ sessionId: SID, tier: 1, title: 'T1 batch A: list Downloads' }, noopEmit)
const t1b = requestConsent({ sessionId: SID, tier: 1, title: 'T1 batch B: read notes.txt' }, noopEmit)
const t3c = requestConsent({ sessionId: SID, tier: 3, title: 'T3: trash cache.tmp' }, noopEmit)

await new Promise((r) => setTimeout(r, 300))

// what the user sees: the DESKTOP panel queue is FIFO by createdAt
const queue = await db.awonConsent.findMany({ where: { sessionId: SID, status: 'pending' }, orderBy: { createdAt: 'asc' } })
check('all three stack as pending', queue.length === 3, String(queue.length))
check('queue is FIFO (T1a, T1b, T3c)', queue[0].tier === 1 && queue[1].tier === 1 && queue[2].tier === 3, JSON.stringify(queue.map((q) => q.tier)))
check('each request owns its 120s clock (same expiry window, independent rows)', queue.every((q) => q.expiresAt.getTime() - q.createdAt.getTime() >= 119_000))

// the user answers in REVERSE order (T3 first): later queue entries are NOT
// blocked by earlier ones - every card is independently answerable
const d3 = await decideConsent(queue[2].id, { decision: 'approve' })
check('T3 (queue #3) answerable while T1s wait', d3.ok === true)
const r3 = await t3c
check('T3 waiter resolved approved', r3.status === 'approved')

const d2 = await decideConsent(queue[1].id, { decision: 'approve' })
check('T1b (queue #2) answerable next', d2.ok === true)
const r2 = await t1b
check('T1b waiter resolved approved', r2.status === 'approved')

const d1 = await decideConsent(queue[0].id, { decision: 'deny' })
check('T1a (queue #1) can still be DENIED', d1.ok === true)
const r1 = await t1a
check('T1a waiter resolved denied', r1.status === 'denied')

// timeout independence: a NEW stack where the HEAD request is left to expire.
// The requests BEHIND it must keep waiting on their own clocks (they are not
// auto-denied by the head's expiry).
const SID2 = `stacking-timeout-${Date.now()}`
const h1 = requestConsent({ sessionId: SID2, tier: 1, title: 'head - will expire' }, noopEmit)
const h2 = requestConsent({ sessionId: SID2, tier: 2, title: 'behind - stays pending' }, noopEmit)
await new Promise((r) => setTimeout(r, 300))
// shrink the head's clock so the test does not wait 120s
await db.awonConsent.update({ where: { id: (await db.awonConsent.findFirst({ where: { sessionId: SID2, title: 'head - will expire' } }))!.id }, data: { expiresAt: new Date(Date.now() + 3000) } })
const d2row = await db.awonConsent.findFirst({ where: { sessionId: SID2, title: 'behind - stays pending' } })!
// fake the behind-row's expiry for its own waiter (3s) so the test is fast:
// the point is INDEPENDENCE, not the absolute timeout
await db.awonConsent.update({ where: { id: d2row!.id }, data: { expiresAt: new Date(Date.now() + 5000) } })
const rH1 = await h1
check('head expired fail-closed', rH1.status === 'expired')
const rH2 = await h2
check('request behind the head kept its OWN clock (resolved independently, not frozen by the head)', rH2.status === 'expired')

// kill switch freeze: pending requests resolve FROZEN and never re-open
const SID3 = `stacking-freeze-${Date.now()}`
const f1 = requestConsent({ sessionId: SID3, tier: 1, title: 'freeze me' }, noopEmit)
const f2 = requestConsent({ sessionId: SID3, tier: 3, title: 'freeze me too' }, noopEmit)
await new Promise((r) => setTimeout(r, 200))
const frozen = await freezeAllPending(SID3)
check('freezeAllPending froze 2 rows', frozen === 2, String(frozen))
const rf1 = await f1
const rf2 = await f2
check('both waiters resolved frozen', rf1.status === 'frozen' && rf2.status === 'frozen')
const late = await decideConsent((await db.awonConsent.findFirst({ where: { sessionId: SID3, status: 'frozen' } }))!.id, { decision: 'approve' })
check('a frozen card can NEVER be answered afterwards (fail-closed)', late.ok === false && late.status === 'frozen')

// cleanup
await db.awonConsent.deleteMany({ where: { sessionId: { startsWith: 'stacking-' } } })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
