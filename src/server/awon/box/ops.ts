// AWON Box — run executor (Phases 4.5 + 4.6).
//
// Execution law, in order of authority:
//  1. ABORTED   - the kill switch wins over everything, checked before EVERY step
//  2. PLAN HASH - a batch only executes if its sha256 matches the approved
//                 dry-run; the executor refuses to run anything that was not
//                 on the card the user saw
//  3. JOURNAL   - every mutating step writes its undo entry BEFORE touching
//                 the disk (write-ahead). No journal row, no execution.
//  4. AUDIT     - every executed step emits one SSE desktop_step event and one
//                 AwonAudit row (Tier 3 granularity: one log per action)
//  5. TRASH     - there is no delete. box trash = move into
//                 .awon-trash/<runId>/, restorable by undo for 7 days.
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { BOX_TRASH, BOX_HOME, resolveVirtual, verifyReal, statVirtual, ensureBoxTree } from './prison'
import { planOperations, type DryRunPlan, type PlanStep, type RawOp } from './dryrun'
import { requestConsent, findMatchingRule, type ConsentAnswer } from './consent'
import { isAborted as checkAbort, markRunAborted, setGlobalAbort } from './abort-state'

// re-export the shared checker so existing importers keep working
export function isAborted(runId: string): boolean {
  return checkAbort(runId)
}

type Emit = (e: unknown) => void

export async function triggerAbort(sessionId: string | undefined, reason: string): Promise<{ frozen: number; runsAborted: number; killed: number }> {
  const { terminateAll } = await import('./runtime')
  const killed = terminateAll('SIGTERM')
  const where = sessionId ? { status: 'running', sessionId } : { status: 'running' }
  const runs = await db.awonRun.findMany({ where })
  for (const r of runs) markRunAborted(r.id)
  const updated = await db.awonRun.updateMany({ where, data: { status: 'aborted', endedAt: new Date(), abortReason: reason.slice(0, 300) } })
  const frozenCount = await (await import('./consent')).freezeAllPending(sessionId)
  await db.awonAudit.create({ data: { action: 'desktop.abort', detail: `${reason} | runs=${updated.count} frozen=${frozenCount} killed=${killed}`, ok: true } })
  // one-shot global abort consumed by the next executor checkpoint
  setGlobalAbort(true)
  setTimeout(() => {
    setGlobalAbort(false)
  }, 30_000)
  return { frozen: frozenCount, runsAborted: updated.count, killed }
}

// ─── run lifecycle ───────────────────────────────────────────────────────────

export async function beginRun(sessionId: string, tool: string, plan: DryRunPlan): Promise<string> {
  ensureBoxTree()
  const id = `run_${randomUUID().slice(0, 12)}`
  await db.awonRun.create({
    data: {
      id,
      sessionId,
      tool,
      planJson: JSON.stringify(plan).slice(0, 400_000),
      planHash: plan.hash,
      actionsTotal: plan.summary.proposable,
    },
  })
  return id
}

export async function finishRun(runId: string, status: 'done' | 'aborted'): Promise<void> {
  await db.awonRun.update({ where: { id: runId }, data: { status, endedAt: new Date() } }).catch(() => null)
}

// ─── write-ahead journal (4.5) ───────────────────────────────────────────────

async function journal(runId: string, sessionId: string, seq: number, op: string, fromPath: string, toPath: string, trashPath?: string): Promise<void> {
  await db.awonUndoEntry.create({ data: { runId, sessionId, seq, op, fromPath, toPath, trashPath: trashPath ?? null } })
}

// undo one journal entry (reverse replay). Returns a human result line.
async function undoEntry(entry: { id: string; op: string; fromPath: string; toPath: string; trashPath: string | null; runId: string; seq: number }, sessionId: string): Promise<string> {
  if (entry.op === 'move') {
    if (statVirtual(entry.fromPath)) {
      await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
      return `${entry.fromPath} already occupied - skipped (nothing overwritten)`
    }
    const { real: toReal, mount: toMount } = resolveVirtual(entry.toPath)
    verifyReal(toReal, toMount.real)
    const { real: fromReal, mount: fromMount } = resolveVirtual(entry.fromPath)
    verifyReal(fromReal, fromMount.real)
    fs.mkdirSync(path.dirname(fromReal), { recursive: true })
    fs.renameSync(toReal, fromReal)
    await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
    return `${entry.toPath} -> ${entry.fromPath}`
  }
  if (entry.op === 'trash') {
    if (!entry.trashPath || !fs.existsSync(entry.trashPath)) {
      await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
      return `trash for ${entry.fromPath} already gone - skipped`
    }
    if (statVirtual(entry.fromPath)) {
      await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
      return `${entry.fromPath} already occupied - trash copy kept`
    }
    const { real: fromReal, mount: fromMount } = resolveVirtual(entry.fromPath)
    verifyReal(fromReal, fromMount.real)
    fs.mkdirSync(path.dirname(fromReal), { recursive: true })
    fs.renameSync(entry.trashPath, fromReal)
    await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
    return `${entry.fromPath} restored from trash`
  }
  if (entry.op === 'copy') {
    // undoing a copy moves the copy into trash (never unlink)
    if (!statVirtual(entry.toPath)) {
      await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
      return `copy ${entry.toPath} already gone - skipped`
    }
    const trashRel = `${entry.runId}/undo_${entry.seq}_${path.basename(entry.toPath)}`
    const trashAbs = path.join(BOX_TRASH, trashRel)
    fs.mkdirSync(path.dirname(trashAbs), { recursive: true })
    const { real: toReal } = resolveVirtual(entry.toPath)
    fs.renameSync(toReal, trashAbs)
    await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
    return `copy ${entry.toPath} moved to .awon-trash/${trashRel}`
  }
  if (entry.op === 'mkdir') {
    const st = statVirtual(entry.toPath)
    if (st && st.isDirectory() && fs.readdirSync(resolveVirtual(entry.toPath).real).length === 0) {
      const trashRel = `${entry.runId}/undo_${entry.seq}_${path.basename(entry.toPath)}`
      fs.mkdirSync(path.join(BOX_TRASH, trashRel), { recursive: true })
      fs.renameSync(resolveVirtual(entry.toPath).real, path.join(BOX_TRASH, trashRel))
    }
    await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
    return `directory ${entry.toPath} removed (empty) or left (non-empty)`
  }
  if (entry.op === 'write') {
    // write undo: the pre-write content was trashed under undo_<seq>_; restore
    if (entry.trashPath && fs.existsSync(entry.trashPath)) {
      const { real: toReal } = resolveVirtual(entry.toPath)
      const prev = path.join(path.dirname(toReal), path.basename(entry.trashPath).replace(/^prev_/, ''))
      fs.mkdirSync(path.dirname(prev), { recursive: true })
      fs.renameSync(entry.trashPath, prev)
      await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
      return `${entry.toPath} restored to pre-write content`
    }
    // no previous content: the write itself created the file -> trash it
    if (statVirtual(entry.toPath)) {
      const trashRel = `${entry.runId}/undo_${entry.seq}_${path.basename(entry.toPath)}`
      fs.mkdirSync(path.dirname(path.join(BOX_TRASH, trashRel)), { recursive: true })
      fs.renameSync(resolveVirtual(entry.toPath).real, path.join(BOX_TRASH, trashRel))
    }
    await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
    return `${entry.toPath} created by run - moved to trash`
  }
  await db.awonUndoEntry.update({ where: { id: entry.id }, data: { undone: true } })
  return `${entry.op}: no inverse needed`
}

// undo a whole run: newest-first. Agent-initiated undo shows a Tier 2 consent
// card; panel-initiated undo (the user clicked UNDO) IS the consent - the click
// is audited and no redundant dialog is raised.
export async function undoRun(runId: string, sessionId: string, emit: Emit, opts?: { userInitiated?: boolean }): Promise<{ ok: boolean; lines: string[]; error?: string }> {
  const run = await db.awonRun.findUnique({ where: { id: runId } })
  if (!run) return { ok: false, lines: [], error: `no run ${runId}` }
  if (isAborted(runId)) return { ok: false, lines: [], error: 'run is aborted' }
  const entries = await db.awonUndoEntry.findMany({ where: { runId, undone: false }, orderBy: { seq: 'desc' } })
  if (!entries.length) return { ok: false, lines: [], error: 'this run has nothing left to undo' }

  const lines = entries.map((e) => `${e.op}: ${e.fromPath}${e.toPath ? ` -> ${e.toPath}` : ''}`)
  if (!opts?.userInitiated) {
    const answer = await requestConsent(
      {
        sessionId,
        runId,
        tier: 2,
        title: `Undo run ${runId} (${entries.length} steps, newest first)`,
        detail: 'Every step replays its exact inverse from the write-ahead journal. Nothing is deleted - restored files come back from .awon-trash.',
        payload: { kind: 'undo', steps: lines },
      },
      emit,
    )
    if (answer.status !== 'approved') {
      await db.awonAudit.create({ data: { action: 'desktop.undo.denied', detail: `${runId} status=${answer.status}`, ok: false } })
      return { ok: false, lines: [], error: `undo ${answer.status}` }
    }
  } else {
    await db.awonAudit.create({ data: { action: 'desktop.undo.panel', detail: `${runId} initiated by the user's UNDO click (${entries.length} steps)`, ok: true } })
  }

  const results: string[] = []
  for (const e of entries) {
    if (isAborted(runId)) {
      results.push('ABORTED by kill switch - remaining steps untouched')
      await finishRun(runId, 'aborted')
      break
    }
    try {
      const line = await undoEntry(e, sessionId)
      results.push(line)
      await db.awonAudit.create({ data: { action: 'desktop.undo', detail: `${runId} #${e.seq} ${line}`, ok: true } })
      emit({ type: 'desktop_step', runId, seq: e.seq, op: `undo_${e.op}`, detail: line, ok: true })
    } catch (err) {
      const line = `step ${e.seq} failed: ${(err as Error).message}`
      results.push(line)
      await db.awonAudit.create({ data: { action: 'desktop.undo', detail: `${runId} #${e.seq} ${line}`, ok: false } })
      emit({ type: 'desktop_step', runId, seq: e.seq, op: `undo_${e.op}`, detail: line, ok: false })
    }
  }
  await finishRun(runId, isAborted(runId) ? 'aborted' : 'done')
  return { ok: true, lines: results }
}

// most recent run of a session that still has undoable entries
export async function latestUndoableRun(sessionId: string): Promise<string | null> {
  const runs = await db.awonRun.findMany({ where: { sessionId }, orderBy: { startedAt: 'desc' }, take: 10 })
  for (const r of runs) {
    const n = await db.awonUndoEntry.count({ where: { runId: r.id, undone: false } })
    if (n > 0) return r.id
  }
  return null
}

// trash TTL report for the panel (nothing is ever auto-deleted; 7-day clock is
// displayed, purge is a manual, journaled user action)
export async function trashStats(): Promise<{ files: number; bytes: number; oldest: string | null }> {
  let files = 0
  let bytes = 0
  let oldest: number | null = null
  const walk = (dir: string) => {
    let list: fs.Dirent[] = []
    try {
      list = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of list) {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) walk(p)
      else {
        try {
          const st = fs.statSync(p)
          files++
          bytes += st.size
          if (oldest === null || st.mtimeMs < oldest) oldest = st.mtimeMs
        } catch {}
      }
    }
  }
  walk(BOX_TRASH)
  return { files, bytes, oldest: oldest ? new Date(oldest).toISOString() : null }
}

// ─── the executor (the approved plan becomes reality, step by step) ─────────

export async function executePlan(
  plan: DryRunPlan,
  opts: { sessionId: string; emit: Emit; approvedHash: string; consentId: string; contentBySeq?: Map<number, string> },
): Promise<{ runId: string; executed: number; refused: number; aborted: boolean; lines: string[] }> {
  const { sessionId, emit } = opts
  if (opts.approvedHash !== plan.hash) {
    // the card the user approved is not the plan being executed: refuse, log
    await db.awonAudit.create({ data: { action: 'desktop.exec.hash_mismatch', detail: `approved=${opts.approvedHash} got=${plan.hash}`, ok: false } })
    throw new Error('plan hash mismatch: the approved dry-run is not this plan (refusing to execute)')
  }
  const runId = await beginRun(sessionId, 'box_batch', plan)
  const steps = plan.steps.filter((s): s is PlanStep => s.proposable)
  const lines: string[] = []
  let executed = 0
  let aborted = false

  emit({ type: 'desktop_run', runId, status: 'running', total: steps.length })

  for (const step of steps) {
    if (isAborted(runId)) {
      aborted = true
      lines.push('ABORTED by kill switch - remaining steps untouched, journal intact')
      break
    }

    // Tier 3: trash steps ask PER ACTION. A typed permanent rule can match and
    // skip the dialog; every rule match is still audited.
    if (step.op === 'trash') {
      const rule = await findMatchingRule('box_trash', step.from)
      if (!rule) {
        const ans = await requestConsent(
          {
            sessionId,
            runId,
            tier: 3,
            title: `Trash "${step.from}"`,
            detail: `Tier 3 destructive action, asked per action. It moves to .awon-trash (restorable, 7-day TTL) - it is never deleted. To never ask again for this pattern, choose TYPE A RULE and type it.`,
            payload: { kind: 'single', step },
          },
          emit,
        )
        if (ans.status !== 'approved') {
          lines.push(`trash ${step.from}: ${ans.status} by you - skipped`)
          await db.awonAudit.create({ data: { action: 'desktop.trash', detail: `${step.from} ${ans.status}`, ok: false } })
          emit({ type: 'desktop_step', runId, seq: step.seq, op: 'trash', detail: `${step.from} - ${ans.status}`, ok: false })
          continue
        }
      } else {
        await db.awonAudit.create({ data: { action: 'desktop.trash.rule', detail: `${step.from} matched typed rule "${rule.ruleText}"`, ok: true } })
        emit({ type: 'desktop_step', runId, seq: step.seq, op: 'rule', detail: `typed rule matched: ${rule.ruleText}`, ok: true })
      }
    }

    try {
      const line = await executeStep(runId, sessionId, step, opts.contentBySeq?.get(step.seq))
      executed++
      lines.push(line)
      await db.awonRun.update({ where: { id: runId }, data: { actionsDone: executed } })
      await db.awonAudit.create({ data: { action: `desktop.${step.op}`, detail: line, ok: true } })
      emit({ type: 'desktop_step', runId, seq: step.seq, op: step.op, detail: line, ok: true })
    } catch (err) {
      lines.push(`step ${step.seq} (${step.op} ${step.from}) failed: ${(err as Error).message}`)
      await db.awonAudit.create({ data: { action: `desktop.${step.op}`, detail: `${step.from} failed: ${(err as Error).message.slice(0, 200)}`, ok: false } })
      emit({ type: 'desktop_step', runId, seq: step.seq, op: step.op, detail: (err as Error).message, ok: false })
    }
  }

  await finishRun(runId, aborted ? 'aborted' : 'done')
  emit({ type: 'desktop_run', runId, status: aborted ? 'aborted' : 'done', total: steps.length, executed })
  return { runId, executed, refused: plan.summary.refused, aborted, lines }
}

async function executeStep(runId: string, sessionId: string, step: PlanStep, writeContent?: string): Promise<string> {
  const seq = step.seq
  if (step.op === 'trash') {
    const trashRel = `${runId}/${seq}_${path.basename(step.from)}`
    const trashAbs = path.join(BOX_TRASH, trashRel)
    fs.mkdirSync(path.dirname(trashAbs), { recursive: true })
    const { real: fromReal, mount } = resolveVirtual(step.from)
    verifyReal(fromReal, mount.real)
    // journal BEFORE the disk move
    await journal(runId, sessionId, seq, 'trash', step.from, '', trashAbs)
    fs.renameSync(fromReal, trashAbs)
    return `trash ${step.from} -> .awon-trash/${trashRel}`
  }
  if (step.op === 'move') {
    await journal(runId, sessionId, seq, 'move', step.from, step.to)
    const { real: fromReal, mount: fm } = resolveVirtual(step.from)
    verifyReal(fromReal, fm.real)
    const { real: toReal, mount: tm } = resolveVirtual(step.to)
    verifyReal(toReal, tm.real)
    fs.mkdirSync(path.dirname(toReal), { recursive: true })
    fs.renameSync(fromReal, toReal)
    return `move ${step.from} -> ${step.to}`
  }
  if (step.op === 'copy') {
    await journal(runId, sessionId, seq, 'copy', step.from, step.to)
    const { real: fromReal, mount: fm } = resolveVirtual(step.from)
    verifyReal(fromReal, fm.real)
    const { real: toReal, mount: tm } = resolveVirtual(step.to)
    verifyReal(toReal, tm.real)
    fs.mkdirSync(path.dirname(toReal), { recursive: true })
    fs.copyFileSync(fromReal, toReal)
    return `copy ${step.from} -> ${step.to}`
  }
  if (step.op === 'mkdir') {
    await journal(runId, sessionId, seq, 'mkdir', '', step.to)
    const { real: toReal, mount: tm } = resolveVirtual(step.to)
    verifyReal(toReal, tm.real)
    fs.mkdirSync(toReal, { recursive: false })
    return `mkdir ${step.to}`
  }
  if (step.op === 'write') {
    const { real: toReal, mount: tm } = resolveVirtual(step.to)
    verifyReal(toReal, tm.real)
    fs.mkdirSync(path.dirname(toReal), { recursive: true })
    // pre-write protection: existing content is preserved in trash for undo
    let trashAbs: string | undefined
    if (fs.existsSync(toReal)) {
      trashAbs = path.join(BOX_TRASH, runId, `prev_${seq}_${path.basename(step.to)}`)
      fs.mkdirSync(path.dirname(trashAbs), { recursive: true })
      fs.renameSync(toReal, trashAbs)
    }
    await journal(runId, sessionId, seq, 'write', trashAbs ? step.to : '', step.to, trashAbs)
    fs.writeFileSync(toReal, writeContent ?? '', 'utf8')
    return `write ${step.to}${trashAbs ? ' (previous content kept in trash)' : ''}`
  }
  throw new Error(`executor has no implementation for op "${step.op}"`)
}

// the single-action entry point used by box_trash (Tier 3, one action, one
// dialog, one journal row) when the agent asks outside a plan
export async function executeSingleTrash(fromVirtual: string, sessionId: string, emit: Emit): Promise<{ ok: boolean; line: string; runId?: string }> {
  const plan = planOperations([{ op: 'trash', from: fromVirtual }])
  const step = plan.steps[0]
  if (!step || !step.proposable) {
    return { ok: false, line: `cannot trash: ${step && !step.proposable ? step.reason : 'not proposable'}` }
  }
  const consent = await requestConsent(
    {
      sessionId,
      tier: 3,
      title: `Trash "${step.from}"`,
      detail: 'Tier 3 destructive action (single). Moves to .awon-trash, restorable, never deleted.',
      payload: { kind: 'single', step },
    },
    emit,
  )
  if (consent.status !== 'approved') return { ok: false, line: `trash ${step.from}: ${consent.status}` }
  const runId = await beginRun(sessionId, 'box_trash', plan)
  try {
    const line = await executeStep(runId, sessionId, step)
    await db.awonRun.update({ where: { id: runId }, data: { actionsDone: 1 } })
    await db.awonAudit.create({ data: { action: 'desktop.trash', detail: line, ok: true } })
    emit({ type: 'desktop_step', runId, seq: 1, op: 'trash', detail: line, ok: true })
    await finishRun(runId, 'done')
    return { ok: true, line, runId }
  } catch (err) {
    await finishRun(runId, 'aborted')
    return { ok: false, line: `trash failed: ${(err as Error).message}` }
  }
}

export function hashPlan(steps: unknown): string {
  return createHash('sha256').update(JSON.stringify(steps)).digest('hex')
}

export type { ConsentAnswer, RawOp }
export { BOX_HOME }
