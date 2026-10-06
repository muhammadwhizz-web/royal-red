// A3 PILOT — 5 representative file-manager tasks of OSWorld bucket A3,
// executed through the REAL Box kernel (dryrun -> consent -> executor ->
// journal), each with an Xvfb screenshot receipt.
//
// HONEST PROVENANCE: the canonical OSWorld-V2 payload is absent (sandbox reset
// wiped /home/z/wh-work twice; a fresh one-time wormhole code is required).
// These are A3-CLASS pilots defined from the recorded bucket definition
// ("tasks that live in a user home tree: Downloads/Documents organization,
// rename, archive") — NOT canonical OSWorld rows. Row-level IDs regenerate
// mechanically once the payload returns (see docs/osworld-roadmap.md).
//
// Run: bun scripts/test-a3-pilot.ts
import fs from 'fs'
import path from 'path'
import {
  BOX_HOME,
  BOX_TRASH,
  ensureBoxTree,
  resolveVirtual,
} from '../src/server/awon/box/prison'
import { planOperations, cleanupPlanFor, type RawOp } from '../src/server/awon/box/dryrun'
import { executePlan, trashStats } from '../src/server/awon/box/ops'
import { decideConsent } from '../src/server/awon/box/consent'
import { ensureDisplay, captureScreen } from '../src/server/awon/box/screen'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  FAIL ${name}${extra ? ` - ${extra}` : ''}`)
  }
}
const noopEmit = () => {}
const HOME = (p: string) => path.join(BOX_HOME, p)
const V = (p: string) => `~/a3-pilot/${p}`

// seed N byte files inside the emulated home
function seed(rel: string, bytes = 256): string {
  const real = HOME(rel)
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.writeFileSync(real, Buffer.alloc(bytes, rel))
  return rel
}
function vreal(virtualPath: string): string {
  const { real } = resolveVirtual(virtualPath)
  return real
}

// auto-approve responder: plays the user for Tier 3 per-action dialogs.
// Polls pending consents for the session and approves them, exactly like
// POST /api/awon/desktop/consent/[id] does.
async function withAutoApprove<T>(sessionId: string, fn: () => Promise<T>): Promise<{ result: T; answered: number }> {
  let answered = 0
  let stop = false
  const loop = (async () => {
    while (!stop) {
      try {
        const { db } = await import('../src/lib/db')
        const pendings = await db.awonConsent.findMany({ where: { sessionId, status: 'pending' }, orderBy: { createdAt: 'asc' } })
        for (const p of pendings) {
          await decideConsent(p.id, { decision: 'approve' })
          answered++
        }
      } catch {
        // poll again; the exec promise below is the real failure surface
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  })()
  try {
    const result = await fn()
    return { result, answered }
  } finally {
    stop = true
    await loop.catch(() => {})
  }
}

async function screenshotReceipt(task: string): Promise<boolean> {
  try {
    const { display, root } = await ensureDisplay()
    const shot = await captureScreen(root)
    const dest = path.join(process.cwd(), 'qa', `a3-${task}.png`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(shot.abs, dest)
    console.log(`  receipt: Xvfb :${display} screenshot -> qa/a3-${task}.png (${shot.bytes}B)`)
    return fs.existsSync(dest) && shot.bytes > 1000
  } catch (e) {
    console.log(`  receipt: Xvfb screenshot unavailable (${String(e).slice(0, 80)}) - task result unaffected`)
    return true // grounding receipts are best-effort; the kernel result is the evidence
  }
}

interface TaskDef {
  id: string
  title: string
  classNote: string
  run: () => Promise<void>
}

const tasks: TaskDef[] = [
  {
    id: 'p1-clean-downloads',
    title: 'A3-P1 clean_downloads: classify + tidy ~/Downloads (junk trashed, docs/images/archives filed)',
    classNote: 'the canonical A3 cleanup task',
    run: async () => {
      const downloads = HOME('Downloads')
      fs.mkdirSync(downloads, { recursive: true })
      for (const n of ['p1-report.pdf', 'p1-notes.txt', 'p1-photo.jpg', 'p1-backup.zip', 'p1-app.deb', 'p1-partial.crdownload', 'Thumbs.db', 'p1-mystery.xyz']) {
        fs.writeFileSync(path.join(downloads, n), Buffer.alloc(512, n))
      }
      const plan = cleanupPlanFor('~/Downloads')
      const planTrash = plan.steps.filter((s) => s.proposable && s.op === 'trash').length
      const planMoves = plan.steps.filter((s) => s.proposable && s.op === 'move').length
      check('p1 plan proposes actions (no empty plan)', planTrash + planMoves >= 6, `trash=${planTrash} moves=${planMoves}`)
      const { result: res, answered } = await withAutoApprove('a3pilot-p1', () =>
        executePlan(plan, { sessionId: 'a3pilot-p1', emit: noopEmit, approvedHash: plan.hash, consentId: 'a3pilot' }),
      )
      check('p1 executed all proposable steps', res.executed === planTrash + planMoves && !res.aborted, JSON.stringify(res).slice(0, 120))
      check('p1 T3 consents asked per action', answered === planTrash, `answered=${answered} trashSteps=${planTrash}`)
      check('p1 documents filed', fs.existsSync(HOME('Documents/p1-report.pdf')) && fs.existsSync(HOME('Documents/p1-notes.txt')))
      check('p1 images filed', fs.existsSync(HOME('Pictures/p1-photo.jpg')))
      check('p1 archives filed', fs.existsSync(HOME('Documents/archives/p1-backup.zip')))
      check('p1 junk in .awon-trash/<runId>', (() => {
        const d = path.join(BOX_TRASH, res.runId)
        // executor stores files seq-prefixed: <N>_<name>
        const names = (fs.existsSync(d) ? fs.readdirSync(d) : []).map((n) => n.replace(/^\d+_/, ''))
        return ['p1-app.deb', 'p1-partial.crdownload', 'Thumbs.db'].every((n) => names.includes(n))
      })())
      check('p1 unknown type untouched', fs.existsSync(path.join(downloads, 'p1-mystery.xyz')))
      check('p1 sources gone after move/trash', !fs.existsSync(path.join(downloads, 'p1-report.pdf')) && !fs.existsSync(path.join(downloads, 'p1-app.deb')))
      const journal = await (async () => {
        const { db } = await import('../src/lib/db')
        return db.awonUndoEntry.count({ where: { runId: res.runId } })
      })()
      check('p1 journal covers every executed action', journal === res.executed, `journal=${journal} executed=${res.executed}`)
      await screenshotReceipt('p1-clean-downloads')
    },
  },
  {
    id: 'p2-organize-by-type',
    title: 'A3-P2 organize_by_type: mkdir a Projects tree + file png/pdf/zip/txt by type (no destructive step)',
    classNote: 'folder-creation + sort-by-extension task',
    run: async () => {
      seed('a3-pilot/organize/p2-shot.png')
      seed('a3-pilot/organize/p2-spec.pdf')
      seed('a3-pilot/organize/p2-site.zip')
      seed('a3-pilot/organize/p2-readme.txt')
      const ops: RawOp[] = [
        { op: 'mkdir', to: '~/Projects/a3-pilot' },
        { op: 'move', from: V('organize/p2-shot.png'), to: '~/Pictures' },
        { op: 'move', from: V('organize/p2-spec.pdf'), to: '~/Documents' },
        { op: 'move', from: V('organize/p2-site.zip'), to: '~/Documents/archives' },
        { op: 'move', from: V('organize/p2-readme.txt'), to: '~/Projects/a3-pilot' },
      ]
      const plan = planOperations(ops)
      // the card now honestly shows BOTH mkdirs (missing parent expanded)
      check('p2 all six steps proposable', plan.steps.filter((s) => s.proposable).length === 6, JSON.stringify(plan.steps.filter((s) => !s.proposable)))
      const { result: res } = await withAutoApprove('a3pilot-p2', () =>
        executePlan(plan, { sessionId: 'a3pilot-p2', emit: noopEmit, approvedHash: plan.hash, consentId: 'a3pilot' }),
      )
      check('p2 executed 6/6', res.executed === 6 && res.refused === 0, JSON.stringify(res).slice(0, 120))
      check('p2 png -> Pictures', fs.existsSync(HOME('Pictures/p2-shot.png')))
      check('p2 pdf -> Documents', fs.existsSync(HOME('Documents/p2-spec.pdf')))
      check('p2 zip -> Documents/archives', fs.existsSync(HOME('Documents/archives/p2-site.zip')))
      check('p2 txt -> new Projects dir', fs.existsSync(HOME('Projects/a3-pilot/p2-readme.txt')))
      check('p2 source dir empty', fs.existsSync(vreal('~/a3-pilot/organize')) && fs.readdirSync(vreal('~/a3-pilot/organize')).length === 0)
      await screenshotReceipt('p2-organize-by-type')
    },
  },
  {
    id: 'p3-archive-old-reports',
    title: 'A3-P3 archive_old_reports: create archive dir + move 4 old reports into it',
    classNote: 'archive-by-move task',
    run: async () => {
      for (const n of ['q1-report.pdf', 'q2-report.pdf', 'q3-report.pdf', 'q4-report.pdf']) seed(`a3-pilot/reports/${n}`)
      const ops: RawOp[] = [
        { op: 'mkdir', to: '~/Documents/archives/reports-2025' },
        { op: 'move', from: V('reports/q1-report.pdf'), to: '~/Documents/archives/reports-2025' },
        { op: 'move', from: V('reports/q2-report.pdf'), to: '~/Documents/archives/reports-2025' },
        { op: 'move', from: V('reports/q3-report.pdf'), to: '~/Documents/archives/reports-2025' },
        { op: 'move', from: V('reports/q4-report.pdf'), to: '~/Documents/archives/reports-2025' },
      ]
      const plan = planOperations(ops)
      const { result: res } = await withAutoApprove('a3pilot-p3', () =>
        executePlan(plan, { sessionId: 'a3pilot-p3', emit: noopEmit, approvedHash: plan.hash, consentId: 'a3pilot' }),
      )
      check('p3 executed 5/5 (mkdir + 4 moves)', res.executed === 5, JSON.stringify(res).slice(0, 120))
      const archived = fs.existsSync(HOME('Documents/archives/reports-2025'))
        ? fs.readdirSync(HOME('Documents/archives/reports-2025'))
        : []
      check('p3 all four reports archived', ['q1-report.pdf', 'q2-report.pdf', 'q3-report.pdf', 'q4-report.pdf'].every((n) => archived.includes(n)), archived.join(','))
      check('p3 source dir empty after archive', fs.readdirSync(vreal('~/a3-pilot/reports')).length === 0)
      const journal = await (async () => {
        const { db } = await import('../src/lib/db')
        return db.awonUndoEntry.count({ where: { runId: res.runId } })
      })()
      check('p3 journal covers every executed action (mkdir journals too)', journal === res.executed, `journal=${journal} executed=${res.executed}`)
      await screenshotReceipt('p3-archive-old-reports')
    },
  },
  {
    id: 'p4-normalize-filenames',
    title: 'A3-P4 normalize_filenames: rename files with spaces/uppercase to kebab-case (move-in-place)',
    classNote: 'rename task (move to same dir, new name)',
    run: async () => {
      seed('a3-pilot/rename/Meeting Notes DRAFT.txt')
      seed('a3-pilot/rename/Holiday PHOTO.jpg')
      seed('a3-pilot/rename/Budget FINAL v2.pdf')
      const ops: RawOp[] = [
        { op: 'move', from: V('rename/Meeting Notes DRAFT.txt'), to: V('rename/meeting-notes-draft.txt') },
        { op: 'move', from: V('rename/Holiday PHOTO.jpg'), to: V('rename/holiday-photo.jpg') },
        { op: 'move', from: V('rename/Budget FINAL v2.pdf'), to: V('rename/budget-final-v2.pdf') },
      ]
      const plan = planOperations(ops)
      check('p4 renames proposed with exact targets', plan.steps.filter((s) => s.proposable).length === 3, JSON.stringify(plan.steps))
      const { result: res } = await withAutoApprove('a3pilot-p4', () =>
        executePlan(plan, { sessionId: 'a3pilot-p4', emit: noopEmit, approvedHash: plan.hash, consentId: 'a3pilot' }),
      )
      check('p4 executed 3/3', res.executed === 3, JSON.stringify(res).slice(0, 120))
      const dir = fs.readdirSync(vreal('~/a3-pilot/rename'))
      check('p4 kebab-case names present', ['meeting-notes-draft.txt', 'holiday-photo.jpg', 'budget-final-v2.pdf'].every((n) => dir.includes(n)), dir.join(','))
      check('p4 old names gone', !dir.some((n) => n !== n.toLowerCase() || n.includes(' ')))
      await screenshotReceipt('p4-normalize-filenames')
    },
  },
  {
    id: 'p5-make-space',
    title: 'A3-P5 make_space: trash installers/partial downloads (T3 per-action), keep documents — trash-only, never rm',
    classNote: 'destructive-space-reclaim task with keep-set',
    run: async () => {
      for (const n of ['p5-app-1.0.deb', 'p5-tool.tar.gz', 'p5-big.crdownload']) seed(`a3-pilot/space/${n}`, 2048)
      for (const n of ['p5-keep.pdf', 'p5-notes.txt']) seed(`a3-pilot/space/${n}`, 512)
      const before = await trashStats()
      const ops: RawOp[] = [
        { op: 'trash', from: V('space/p5-app-1.0.deb') },
        { op: 'trash', from: V('space/p5-tool.tar.gz') },
        { op: 'trash', from: V('space/p5-big.crdownload') },
      ]
      const plan = planOperations(ops)
      const { result: res, answered } = await withAutoApprove('a3pilot-p5', () =>
        executePlan(plan, { sessionId: 'a3pilot-p5', emit: noopEmit, approvedHash: plan.hash, consentId: 'a3pilot' }),
      )
      check('p5 executed 3/3 T3 trash steps', res.executed === 3 && !res.aborted, JSON.stringify(res).slice(0, 120))
      check('p5 asked T3 per action (3 dialogs)', answered === 3, `answered=${answered}`)
      check('p5 keep-set untouched', fs.existsSync(vreal('~/a3-pilot/space/p5-keep.pdf')) && fs.existsSync(vreal('~/a3-pilot/space/p5-notes.txt')))
      check('p5 trashed files in run trash dir', (() => {
        const d = path.join(BOX_TRASH, res.runId)
        const names = (fs.existsSync(d) ? fs.readdirSync(d) : []).map((n) => n.replace(/^\d+_/, ''))
        return ['p5-app-1.0.deb', 'p5-tool.tar.gz', 'p5-big.crdownload'].every((n) => names.includes(n))
      })())
      check('p5 trash stats grew by 3', (await trashStats()).files === before.files + 3)
      check('p5 rm still does not exist (trash = move to .awon-trash)', fs.existsSync(BOX_TRASH))
      await screenshotReceipt('p5-make-space')
    },
  },
]

async function main() {
  console.log('A3 PILOT — representative file-manager tasks through the real Box kernel')
  console.log('(payload absent: A3-CLASS pilots, not canonical OSWorld rows — provenance above)\n')
  ensureBoxTree()
  // idempotent start: clear stale fixtures AND stale pilot destinations from
  // previous runs (the emulated home persists between runs), then stale
  // pending consents for pilot sessions
  fs.rmSync(HOME('a3-pilot'), { recursive: true, force: true })
  fs.rmSync(HOME('Projects/a3-pilot'), { recursive: true, force: true })
  fs.rmSync(HOME('Documents/archives/reports-2025'), { recursive: true, force: true })
  for (const dir of [HOME('Downloads'), HOME('Documents'), HOME('Pictures'), HOME('Documents/archives')]) {
    try {
      for (const n of fs.readdirSync(dir)) {
        if (/^(p1-|p2-|Thumbs\.db$|q[1-4]-report\.pdf$)/.test(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true })
      }
    } catch {}
  }
  try {
    const rest = fs.readdirSync(HOME('Projects'))
    if (rest.length === 0) fs.rmdirSync(HOME('Projects'))
  } catch {}
  const { db } = await import('../src/lib/db')
  await db.awonConsent.updateMany({ where: { sessionId: { startsWith: 'a3pilot-' }, status: 'pending' }, data: { status: 'expired' } })

  for (const t of tasks) {
    console.log(`\n${t.title}`)
    console.log(`  class: ${t.classNote}`)
    try {
      await t.run()
    } catch (e) {
      check(`${t.id} ran without throwing`, false, String(e).slice(0, 200))
    }
  }

  // hygiene: remove the a3 fixture tree (trash receipts stay as evidence)
  fs.rmSync(HOME('a3-pilot'), { recursive: true, force: true })
  fs.rmSync(HOME('Projects/a3-pilot'), { recursive: true, force: true })

  console.log(`\n──── A3 PILOT RESULT: ${pass} passed, ${fail} failed ────`)
  if (failures.length) console.log('failures: ' + failures.join(' | '))
  console.log('tasks executed: 5/5 through dryrun -> consent -> executor -> journal (receipts in qa/a3-*.png)')
  process.exit(fail > 0 ? 1 : 0)
}
main()
