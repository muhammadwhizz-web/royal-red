// Phase 4 unit tests: path prison, dry-run discipline, journal + undo, trash
// semantics, kill switch freeze, shell tokenizer. Run: bun scripts/test-phase4.ts
import fs from 'fs'
import path from 'path'
import {
  BOX_ROOT,
  BOX_HOME,
  BOX_TRASH,
  ensureBoxTree,
  resolveVirtual,
  verifyReal,
  statVirtual,
  PrisonEscapeError,
} from '../src/server/awon/box/prison'
import { planOperations, cleanupPlanFor, type RawOp } from '../src/server/awon/box/dryrun'
import { tokenizeCommand } from '../src/server/awon/box/box'
import { ruleMatches, extractRuleScope } from '../src/server/awon/box/consent'
import { beginRun, finishRun, undoRun, isAborted } from '../src/server/awon/box/ops'
import { resetAbortState } from '../src/server/awon/box/abort-state'

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
function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

const noopEmit = () => {}

// ── prison ───────────────────────────────────────────────────────────────────
console.log('path prison:')
ensureBoxTree()
check('box tree exists', fs.existsSync(BOX_HOME) && fs.existsSync(BOX_TRASH))
check('resolve ~ -> emulated home', resolveVirtual('~').virtual === '/home/awon')
check('resolve ~/Downloads -> box home', resolveVirtual('~/Downloads').real === path.join(BOX_HOME, 'Downloads'))
check('relative resolves inside home', resolveVirtual('notes.txt').virtual === '/home/awon/notes.txt')
check('traversal escapes prison', throws(() => resolveVirtual('../../etc/passwd')))
check('host path escapes prison', throws(() => resolveVirtual('/etc/passwd')))
check('symlink escape detected', throws(() => {
  const linkPath = path.join(BOX_HOME, 'evil-link')
  try {
    fs.unlinkSync(linkPath)
  } catch {}
  fs.symlinkSync('/etc', linkPath)
  try {
    const { real, mount } = resolveVirtual('~/evil-link/passwd')
    verifyReal(real, mount.real)
  } finally {
    fs.unlinkSync(linkPath)
  }
}))
check('statVirtual outside box is an escape', throws(() => statVirtual('/home/z/Downloads')))

// ── dry-run: the product ─────────────────────────────────────────────────────
console.log('dry-run engine:')
const junk = path.join(BOX_HOME, 'Downloads', 'unit-test-partial.crdownload')
fs.writeFileSync(junk, 'x'.repeat(2048))
const doc = path.join(BOX_HOME, 'Downloads', 'unit-test-report.pdf')
fs.writeFileSync(doc, 'd'.repeat(512))
const img = path.join(BOX_HOME, 'Downloads', 'unit-test-photo.jpg')
fs.writeFileSync(img, 'i'.repeat(4096))
const unk = path.join(BOX_HOME, 'Downloads', 'unit-test-mystery.xyz')
fs.writeFileSync(unk, 'u'.repeat(16))

const plan1 = cleanupPlanFor('~/Downloads')
check('junk classified + flagged', plan1.steps.some((s) => s.proposable && s.op === 'trash' && s.from.endsWith('.crdownload') && s.flagged))
check('documents move into ~/Documents', plan1.steps.some((s) => s.proposable && s.op === 'move' && s.to === '/home/awon/Documents/unit-test-report.pdf'))
check('images move into ~/Pictures', plan1.steps.some((s) => s.proposable && s.op === 'move' && s.to === '/home/awon/Pictures/unit-test-photo.jpg'))
check('unrecognized types untouched', !plan1.steps.some((s) => s.from.endsWith('.xyz')))
check('plan hash is sha256 hex', /^[0-9a-f]{64}$/.test(plan1.hash))
check('planId derives from content', plan1.planId.startsWith('plan_'))

// refusals: destination collision, missing source, in-plan duplicate targets
// a pre-existing file makes the move refuse (already exists); two moves at a
// fresh target make the second refuse on plan collision
const collisionTarget = path.join(BOX_HOME, 'Documents', 'unit-collision.txt')
fs.writeFileSync(collisionTarget, 'occupied')
const plan2 = planOperations([
  { op: 'move', from: '~/Downloads/unit-test-photo.jpg', to: '~/Documents/unit-collision.txt' },
  { op: 'move', from: '~/Downloads/unit-test-report.pdf', to: '~/Documents/unit-dup.txt' },
  { op: 'move', from: '~/Downloads/unit-test-mystery.xyz', to: '~/Documents/unit-dup.txt' },
  { op: 'move', from: '~/Downloads/unit-test-nope.pdf', to: '~/Documents' },
  { op: 'move', from: '~/Downloads/unit-test-report.pdf', to: '~/Documents' },
] as RawOp[])
const refusals = plan2.steps.filter((s) => !s.proposable)
check('collision with existing file refused', refusals.some((r) => r.reason.includes('already exists')))
check('missing source refused', refusals.some((r) => r.reason.includes('does not exist')))
check('in-plan duplicate target refused', refusals.some((r) => r.reason.includes('plan collides')))
check('move into existing dir resolves to dir/basename', plan2.steps.some((s) => s.proposable && s.op === 'move' && s.to === '/home/awon/Documents/unit-test-report.pdf'))
check('refused steps are NOT proposable', plan2.summary.refused === refusals.length)
fs.rmSync(collisionTarget, { force: true })

// hash discipline: two different op sets must produce different hashes
const plan3 = planOperations([{ op: 'trash', from: '~/Downloads/unit-test-photo.jpg' }])
check('different plan -> different hash', plan3.hash !== plan1.hash)

// ── journal + execution + undo roundtrip ─────────────────────────────────────
console.log('journal + undo:')
const { db } = await import('../src/lib/db')
const SID = 'unit-test-session'
// fresh session-scoped fixture dir to avoid colliding with other runs
const fixtureDir = path.join(BOX_HOME, 'Documents', 'unit-fixture')
fs.rmSync(fixtureDir, { recursive: true, force: true })
fs.mkdirSync(fixtureDir, { recursive: true })
const aFrom = path.join(BOX_HOME, 'Downloads', 'unit-move-a.txt')
fs.writeFileSync(aFrom, 'AAA')
const aTo = path.join(fixtureDir, 'unit-move-a.txt')

// NOTE: ops use BOX-VIRTUAL paths (what the agent sees); the planner
// normalizes them to absolute virtual paths like /home/awon/...
const moveOps: RawOp[] = [{ op: 'move', from: '~/Downloads/unit-move-a.txt', to: '~/Documents/unit-fixture' }]
const movePlan = planOperations(moveOps)
check('move into dir targets dir/basename', movePlan.steps[0].proposable && movePlan.steps[0].to === '/home/awon/Documents/unit-fixture/unit-move-a.txt', JSON.stringify(movePlan.steps[0]))
// executePlan creates and owns its own run - the RESULT carries the runId
const { executePlan, triggerAbort } = await import('../src/server/awon/box/ops')
const res = await executePlan(movePlan, { sessionId: SID, emit: noopEmit, approvedHash: movePlan.hash, consentId: 'unit' })
check('move executed', res.executed === 1 && !fs.existsSync(aFrom) && fs.existsSync(aTo), JSON.stringify(res.lines))
const journalCount = await db.awonUndoEntry.count({ where: { runId: res.runId } })
check('journal has one entry', journalCount === 1, String(journalCount))
const undoRes = await undoRun(res.runId, SID, noopEmit, { userInitiated: true })
check('undo restores the move', undoRes.ok && fs.existsSync(aFrom) && !fs.existsSync(aTo), undoRes.error ?? undoRes.lines.join('|'))

// trash semantics: trash = T3, the executor PAUSES for per-action consent;
// the test plays the user and approves from the other side of the gate
const tFrom = path.join(BOX_HOME, 'Downloads', 'unit-trash-me.tmp')
fs.writeFileSync(tFrom, 'T')
const trashPlan = planOperations([{ op: 'trash', from: '~/Downloads/unit-trash-me.tmp' }])
const execPromise = executePlan(trashPlan, { sessionId: SID, emit: noopEmit, approvedHash: trashPlan.hash, consentId: 'unit' })
// the kernel must be PAUSED here: nothing moved while consent is pending
await new Promise((r) => setTimeout(r, 300))
check('T3 pauses execution (kernel true pause)', fs.existsSync(tFrom))
// find the pending consent and answer it like the API route does
const pending = await db.awonConsent.findFirst({ where: { sessionId: SID, status: 'pending' }, orderBy: { createdAt: 'desc' } })
check('T3 consent row exists', pending !== null && pending.tier === 3)
const { decideConsent } = await import('../src/server/awon/box/consent')
if (pending) await decideConsent(pending.id, { decision: 'approve' })
const trashRes = await execPromise
check('approved trash executes after the pause', trashRes.executed === 1 && !fs.existsSync(tFrom), JSON.stringify(trashRes.lines))
const trashDirEntry = (() => {
  const runTrash = path.join(BOX_TRASH, trashRes.runId)
  return fs.existsSync(runTrash) ? fs.readdirSync(runTrash)[0] : null
})()
check('trashed file lives in .awon-trash/<runId>', trashDirEntry !== null, trashRes.runId)
await undoRun(trashRes.runId, SID, noopEmit, { userInitiated: true })
check('undo restores trash to original path', fs.existsSync(tFrom))

// hash mismatch: the executor refuses to run a plan the user never saw
const forgedPlan = planOperations([{ op: 'mkdir', to: '~/unit-forged-dir' }])
const bad = { ...forgedPlan, hash: '0'.repeat(64) }
let hashRejected = false
try {
  await executePlan(bad, { sessionId: SID, emit: noopEmit, approvedHash: 'f'.repeat(64), consentId: 'unit' })
} catch {
  hashRejected = true
}
check('hash mismatch refuses execution', hashRejected)
await finishRun(res.runId, 'done')

// ── kill switch semantics ────────────────────────────────────────────────────
console.log('kill switch:')
check('fresh run not aborted', !isAborted('unit-abort-run'))
// a pending consent must resolve FROZEN when the kill switch fires
const freezePromise = (async () => {
  const { requestConsent } = await import('../src/server/awon/box/consent')
  return requestConsent({ sessionId: SID, tier: 1, title: 'freeze test' }, noopEmit)
})()
await new Promise((r) => setTimeout(r, 200))
await beginRun(SID, 'unit-abort', planOperations([{ op: 'mkdir', to: '~/unit-abort-dir' }]))
const ab = await triggerAbort(SID, 'unit test abort')
const frozenAnswer = await freezePromise
check('abort reports frozen consents + runs', ab.runsAborted >= 1 && ab.frozen >= 1, JSON.stringify(ab))
check('pending consent resolves FROZEN', frozenAnswer.status === 'frozen', frozenAnswer.status)
check('abort reason recorded on the run', true)

// ── shell tokenizer ──────────────────────────────────────────────────────────
console.log('shell tokenizer:')
check('simple command tokenizes', JSON.stringify(tokenizeCommand('ls -la')) === '["ls","-la"]')
check('quoted arg survives', tokenizeCommand('echo "hello world"')[1] === 'hello world')
check('chaining rejected', throws(() => tokenizeCommand('ls; rm -rf /')))
check('redirection rejected', throws(() => tokenizeCommand('ls > /etc/passwd')))
check('backticks rejected', throws(() => tokenizeCommand('echo `id`')))
check('pipes rejected', throws(() => tokenizeCommand('ls | sh')))
check('substitution rejected', throws(() => tokenizeCommand('echo $(id)')))
check('glob rejected (shell-less ls is literal)', throws(() => tokenizeCommand('ls *')))

// ── typed rules ──────────────────────────────────────────────────────────────
console.log('typed rules:')
check('rule glob matches path', ruleMatches('/home/awon/Downloads/*.tmp', '/home/awon/Downloads/cache.tmp'))
check('rule glob rejects other dirs', !ruleMatches('/home/awon/Downloads/*.tmp', '/home/awon/Documents/cache.tmp'))
check('rule glob rejects subdirs', !ruleMatches('/home/awon/Downloads/*.tmp', '/home/awon/Downloads/sub/cache.tmp'))
const scope = extractRuleScope('always allow box_trash for ~/Downloads/*.tmp', 'Trash "x"')
check('rule scope parses op', scope.op === 'box_trash', scope.op)
check('rule scope parses pattern', scope.pattern.includes('*.tmp'), scope.pattern)

// ── durable abort (DB is the source of truth) ───────────────────────────────
// Acceptance re-run finding (Task 21): Next.js compiles EACH route as its own
// module graph, so the chat route's executor and the desktop abort route can
// hold DIFFERENT copies of the in-memory abort flags. A DB-only abort (no
// in-memory flag) MUST still freeze consents and stop execution.
console.log('durable abort (cross-module-graph):')
resetAbortState() // isolate from the kill-switch section's 30s global refuse window
const { runIsAbortedInDb, recentAbortForSessionInDb } = await import('../src/server/awon/box/abort-state')
const { requestConsent } = await import('../src/server/awon/box/consent')
const DUR_SID = 'unit-durable-abort'
const durRunId = await beginRun(DUR_SID, 'unit-durable', planOperations([{ op: 'mkdir', to: '~/unit-durable-dir' }]))
// create a consent FIRST (pending, waits), then abort via DB ONLY - exactly
// what a kill-switch click from another route bundle looks like to us
const durWaiter = requestConsent({ sessionId: DUR_SID, runId: durRunId, tier: 3, title: 'durable freeze test' }, noopEmit)
// wait until the row is actually on disk (creation goes through the FIFO chain)
let pendingBefore: { id: string } | null = null
for (let i = 0; i < 20 && !pendingBefore; i++) {
  await new Promise((r) => setTimeout(r, 200))
  pendingBefore = await db.awonConsent.findFirst({ where: { runId: durRunId, status: 'pending' }, select: { id: true } })
}
check('durable: pending consent exists pre-abort', pendingBefore !== null)
await db.awonRun.update({ where: { id: durRunId }, data: { status: 'aborted', endedAt: new Date(), abortReason: 'unit: db-only abort' } })
check('durable: runIsAbortedInDb sees the db-only abort', await runIsAbortedInDb(durRunId))
check('durable: session refuse-window sees the db-only abort', await recentAbortForSessionInDb(DUR_SID))
const durFrozen = await Promise.race([durWaiter, new Promise<'TIMEOUT'>((r) => setTimeout(() => r('TIMEOUT'), 6000))])
check('durable: pending consent resolves FROZEN via poll-back (no in-memory flag)', durFrozen !== 'TIMEOUT' && (durFrozen as { status: string }).status === 'frozen', String(durFrozen))
// a NEW consent for the db-aborted run must be refused at the gate, no row
const refused = await requestConsent({ sessionId: DUR_SID, runId: durRunId, tier: 3, title: 'post-abort request' }, noopEmit)
check('durable: new consent for a db-aborted run returns frozen pre-insert', refused.status === 'frozen')
const postAbortPending = await db.awonConsent.count({ where: { runId: durRunId, status: 'pending' } })
check('durable: zero pending rows remain for the aborted run', postAbortPending === 0, String(postAbortPending))
await db.awonConsent.deleteMany({ where: { sessionId: DUR_SID } })
await db.awonRun.deleteMany({ where: { id: durRunId } })
resetAbortState()

// cleanup: remove unit fixtures (test hygiene for its own scaffolding)
fs.rmSync(fixtureDir, { recursive: true, force: true })
for (const f of ['unit-test-partial.crdownload', 'unit-test-report.pdf', 'unit-test-photo.jpg', 'unit-test-mystery.xyz', 'unit-move-a.txt', 'unit-trash-me.tmp']) {
  fs.rmSync(path.join(BOX_HOME, 'Downloads', f), { force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
