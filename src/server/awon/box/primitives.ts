// AWON Box — the 13 permitted desktop primitives (Phase 4.7).
//
// Exactly thirteen agent-facing primitives. The kernel enforces the tier of
// each one regardless of what the model asks for:
//
//   #  primitive      tier  what it does
//   1  box_list        T1   list a directory inside the emulated home
//   2  box_read        T1   read a text file inside the box
//   3  box_plan         -   dry-run a batch (NEVER mutates; free because it
//                            cannot do anything - "dry-run is the product")
//   4  box_write       T2   write a file (plan card, journaled, undoable)
//   5  box_mkdir       T2   create a directory (plan card, journaled)
//   6  box_move        T2   move files (plan card, journaled, undoable)
//   7  box_copy        T2   copy files (plan card, journaled, undoable)
//   8  box_trash       T3   move to .awon-trash - the ONLY "delete";
//                            one dialog per action, never batched
//   9  box_undo        T2   replay a run's journal in reverse
//  10  shell_exec      T3   EXTREME consent: typed rule required, no checkbox,
//                            shell-less tokenization, no rm, supervised
//  11  screen_shot     T1   screenshot of the VIRTUAL display (Xvfb)
//  12  screen_click    T3   click on the virtual display (fails closed here:
//                            no input backend in this environment)
//  13  screen_type     T3   type on the virtual display (fails closed here)
//
// Anything outside these thirteen (mounting the real home, disabling consent,
// raw rm) has NO code path. That is the product.
import type { ToolOutcome } from '@/lib/awon/types'
import {
  BOX_HOME,
  defaultMounts,
  ensureBoxTree,
  resolveVirtual,
  statVirtual,
  PrisonEscapeError,
} from './prison'
import { boxExec } from './box'
import { cleanupPlanFor, planOperations, cachePlanRaw, type RawOp, type DryRunPlan } from './dryrun'
import { requestConsent, findMatchingRule } from './consent'
import { executePlan, executeSingleTrash, undoRun, latestUndoableRun, isAborted } from './ops'
import { ensureDisplay, captureScreen, segmentScreenshot, inputUnavailableError } from './screen'
import fs from 'fs'
import path from 'path'

type Emit = (e: unknown) => void

export interface BoxPrimitiveCtx {
  sessionId: string
  emit: Emit
}

const T1_READ_TITLE = 'Read inside the AWON box (Tier 1)'

// one shared batch consent for a group of T1 reads
async function consentRead(ctx: BoxPrimitiveCtx, detail: string, payload: unknown): Promise<boolean> {
  const ans = await requestConsent(
    {
      sessionId: ctx.sessionId,
      tier: 1,
      title: T1_READ_TITLE,
      detail: `${detail} The box is the emulated home inside AWON's sandbox - the real host filesystem is not mounted, not even read-only.`,
      payload,
    },
    ctx.emit,
  )
  return ans.status === 'approved'
}

// plan-card flow for a T2 batch: plan -> card (approve/modify/deny/type-rule)
// -> on approve, execute with hash check
async function planCardFlow(
  ctx: BoxPrimitiveCtx,
  rawOps: RawOp[],
  toolName: string,
  extra?: { contentBySeq?: Map<number, string> },
): Promise<ToolOutcome> {
  const plan = planOperations(rawOps)
  if (rawOps.some((o) => o.op === 'write')) cachePlanRaw(plan.planId, rawOps)
  emitPlanCard(ctx, plan, toolName)

  const ans = await requestConsent(
    {
      sessionId: ctx.sessionId,
      tier: 2,
      title: `Approve ${toolName} plan (${plan.summary.proposable} actions)`,
      detail:
        plan.summary.refused > 0
          ? `${plan.summary.refused} operation(s) could not produce a dry-run and will NOT run. Every executed step is journaled for undo.`
          : 'Every step is journaled before it executes; one command undoes the whole run.',
      payload: { kind: 'plan', plan, toolName },
    },
    ctx.emit,
  )

  if (ans.status !== 'approved') {
    await import('@/lib/db').then(({ db }) =>
      db.awonAudit.create({ data: { action: `desktop.${toolName}.plan`, detail: `plan ${plan.planId} ${ans.status}`, ok: false } }),
    )
    return {
      name: toolName,
      ok: false,
      summary: `the user did not approve the plan (${ans.status}). Nothing was touched.`,
      detail: 'If the plan was wrong, fix the op list and propose a new dry-run.',
    }
  }
  // "modify" support: the user may return an edited plan payload
  let planToRun = plan
  let approvedHash = plan.hash
  const modified = ans.modifiedPayload as { plan?: DryRunPlan } | undefined
  if (ans.decision === 'modify' && modified?.plan?.steps) {
    // the edited plan arrives from the card; it must re-plan deterministically.
    // We re-plan from the edited steps' raw ops (from/to pairs) so the hash
    // discipline stays intact: the edited plan is the plan that runs.
    const editedRaw: RawOp[] = modified.plan.steps
      .filter((s) => s.proposable)
      .map((s) => (s.op === 'write' ? { op: 'write', to: s.to, content: '' } : { op: s.op, from: s.from, to: s.to || undefined }))
    const reContent = new Map<number, string>()
    for (const s of modified.plan.steps) {
      if (s.op === 'write' && s.proposable) {
        const orig = rawOps.find((o, i) => plan.steps[i] && plan.steps[i].seq === s.seq && o.op === 'write')
        reContent.set(s.seq, orig && 'content' in orig ? String(orig.content ?? '') : '')
      }
    }
    planToRun = planOperations(editedRaw)
    cachePlanRaw(planToRun.planId, editedRaw)
    approvedHash = planToRun.hash
    extra = { contentBySeq: reContent }
    emitPlanCard(ctx, planToRun, `${toolName} (modified by you)`)
  }

  try {
    const res = await executePlan(planToRun, {
      sessionId: ctx.sessionId,
      emit: ctx.emit,
      approvedHash,
      consentId: 'in-band',
      contentBySeq: extra?.contentBySeq,
    })
    return {
      name: toolName,
      ok: !res.aborted,
      summary: res.aborted
        ? `ABORTED after ${res.executed} of ${planToRun.summary.proposable} steps (kill switch). Journal intact; say "undo" to reverse what ran.`
        : `${res.executed}/${planToRun.summary.proposable} actions done, run ${res.runId}${res.refused ? `, ${res.refused} refused (never proposable)` : ''}`,
      detail: res.lines.join('\n'),
    }
  } catch (e) {
    return { name: toolName, ok: false, summary: `execution refused: ${(e as Error).message}` }
  }
}

function emitPlanCard(ctx: BoxPrimitiveCtx, plan: DryRunPlan, toolName: string): void {
  ctx.emit({
    type: 'desktop_plan',
    planId: plan.planId,
    toolName,
    summary: plan.summary,
    steps: plan.steps,
  })
}

// ─── the dispatcher ──────────────────────────────────────────────────────────

export async function runBoxPrimitive(
  name: string,
  args: Record<string, unknown>,
  ctx: BoxPrimitiveCtx,
): Promise<ToolOutcome> {
  ensureBoxTree()
  try {
    switch (name) {
      case 'box_list':
        return await boxList(args, ctx)
      case 'box_read':
        return await boxRead(args, ctx)
      case 'box_plan':
        return await boxPlan(args, ctx)
      case 'box_write':
        return await boxWrite(args, ctx)
      case 'box_mkdir':
        return await boxMkdir(args, ctx)
      case 'box_move':
        return await boxBatch(args, ctx, 'box_move', 'move')
      case 'box_copy':
        return await boxBatch(args, ctx, 'box_copy', 'copy')
      case 'box_trash':
        return await boxTrash(args, ctx)
      case 'box_undo':
        return await boxUndo(args, ctx)
      case 'shell_exec':
        return await shellExec(args, ctx)
      case 'screen_shot':
        return await screenShot(args, ctx)
      case 'screen_click':
        return await screenClick(args, ctx)
      case 'screen_type':
        return await screenType(args, ctx)
      default:
        return { name, ok: false, summary: `unknown box primitive "${name}"` }
    }
  } catch (e) {
    if (e instanceof PrisonEscapeError) {
      return { name, ok: false, summary: `PATH PRISON: ${(e as Error).message}` }
    }
    return { name, ok: false, summary: `${name} failed: ${(e as Error).message}` }
  }
}

// ─── 1. box_list (T1) ────────────────────────────────────────────────────────
async function boxList(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const dir = String(args.path ?? '~')
  const st = statVirtual(dir)
  if (!st) return { name: 'box_list', ok: false, summary: `"${dir}" does not exist inside the box` }
  if (!st.isDirectory()) return { name: 'box_list', ok: false, summary: `"${dir}" is a file, not a directory` }
  if (!(await consentRead(ctx, `AWON asks to LIST "${resolveVirtual(dir).virtual}".`, { op: 'list', path: resolveVirtual(dir).virtual }))) {
    return { name: 'box_list', ok: false, summary: 'read consent denied - nothing was listed' }
  }
  const { real } = resolveVirtual(dir)
  const entries = fs
    .readdirSync(real, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => {
      const s = fs.statSync(path.join(real, d.name))
      return `${d.isDirectory() ? 'd' : '-'} ${(s.size + ' B').padStart(10)} ${d.name}`
    })
  // contextual nudge: keep the box job protocol moving (the plan card is the
  // permission gate, so the agent should propose it now, not end its turn)
  const nudge = /Downloads|Documents|Pictures/i.test(resolveVirtual(dir).virtual)
    ? '\n\nNEXT STEP (same turn): if the user asked to clean up or organize this directory, call box_plan cleanup {path:"<this dir>"} NOW - do not end the turn.'
    : ''
  return {
    name: 'box_list',
    ok: true,
    summary: `${entries.length} entries in ${resolveVirtual(dir).virtual}`,
    detail: (entries.join('\n') || '(empty directory)') + nudge,
  }
}

// ─── 2. box_read (T1) ────────────────────────────────────────────────────────
async function boxRead(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const p = String(args.path ?? '')
  const st = statVirtual(p)
  if (!st) return { name: 'box_read', ok: false, summary: `"${p}" does not exist inside the box` }
  if (!st.isFile()) return { name: 'box_read', ok: false, summary: `"${p}" is not a file` }
  if (st.size > 2 * 1024 * 1024) return { name: 'box_read', ok: false, summary: `file too large to read (${Math.round(st.size / 1048576)}MB, cap 2MB)` }
  if (!(await consentRead(ctx, `AWON asks to READ "${resolveVirtual(p).virtual}" (${st.size} B).`, { op: 'read', path: resolveVirtual(p).virtual }))) {
    return { name: 'box_read', ok: false, summary: 'read consent denied - nothing was read' }
  }
  const { real } = resolveVirtual(p)
  const content = fs.readFileSync(real, 'utf8')
  return { name: 'box_read', ok: true, summary: `${p} (${content.length} chars)`, detail: content.slice(0, 8000) }
}

// ─── 3. box_plan (free - dry-run cannot mutate) ──────────────────────────────
async function boxPlan(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const kind = String(args.kind ?? 'cleanup')
  if (kind === 'cleanup') {
    const dir = String(args.path ?? '~/Downloads')
    const plan = cleanupPlanFor(dir)
    if (!plan.steps.length) {
      return { name: 'box_plan', ok: true, summary: `${dir}: default policy proposes 0 actions (nothing matched)` }
    }
    emitPlanCard(ctx, plan, 'cleanup')
    const ans = await requestConsent(
      {
        sessionId: ctx.sessionId,
        tier: 2,
        title: `Approve cleanup plan for ${resolveVirtual(dir).virtual} (${plan.summary.proposable} actions)`,
        detail:
          'Default policy: junk and installers -> .awon-trash (Tier 3, asked per item), documents -> ~/Documents, images -> ~/Pictures, archives -> ~/Documents/archives. Refused items (if any) will NOT run. Every step is journaled and undoable.',
        payload: { kind: 'plan', plan, toolName: 'cleanup' },
      },
      ctx.emit,
    )
    if (ans.status !== 'approved') {
      return { name: 'box_plan', ok: false, summary: `plan not approved (${ans.status}) - nothing was touched` }
    }
    const res = await executePlan(plan, { sessionId: ctx.sessionId, emit: ctx.emit, approvedHash: plan.hash, consentId: 'in-band' })
    return {
      name: 'box_plan',
      ok: !res.aborted,
      summary: res.aborted
        ? `ABORTED after ${res.executed} of ${plan.summary.proposable} steps (kill switch). Journal intact; say "undo" to reverse what ran.`
        : `cleanup done: ${res.executed}/${plan.summary.proposable} actions, run ${res.runId}${res.refused ? `, ${res.refused} refused` : ''}`,
      detail: res.lines.join('\n'),
    }
  }
  // generic plan: caller supplies an ops list
  const ops = Array.isArray(args.ops) ? (args.ops as RawOp[]) : []
  if (!ops.length) return { name: 'box_plan', ok: false, summary: 'no ops to plan (pass ops: [{op, from, to}])' }
  return await planCardFlow(ctx, ops, 'box_plan')
}

// ─── 4. box_write (T2) ───────────────────────────────────────────────────────
async function boxWrite(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const to = String(args.path ?? args.to ?? '')
  const content = String(args.content ?? '')
  if (!to) return { name: 'box_write', ok: false, summary: 'box_write needs a path' }
  return await planCardFlow(ctx, [{ op: 'write', to, content }], 'box_write', {
    contentBySeq: new Map([[1, content]]),
  })
}

// ─── 5. box_mkdir (T2) ───────────────────────────────────────────────────────
async function boxMkdir(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const to = String(args.path ?? args.to ?? '')
  if (!to) return { name: 'box_mkdir', ok: false, summary: 'box_mkdir needs a path' }
  return await planCardFlow(ctx, [{ op: 'mkdir', to }], 'box_mkdir')
}

// ─── 6/7. box_move / box_copy (T2) ───────────────────────────────────────────
async function boxBatch(args: Record<string, unknown>, ctx: BoxPrimitiveCtx, toolName: 'box_move' | 'box_copy', op: 'move' | 'copy'): Promise<ToolOutcome> {
  // two shapes: {items: [{from, to}]} or {from, to} (single)
  let pairs: { from: string; to: string }[] = []
  if (Array.isArray(args.items)) {
    pairs = (args.items as { from?: string; to?: string }[]).map((i) => ({ from: String(i.from ?? ''), to: String(i.to ?? '') }))
  } else if (args.from && args.to) {
    pairs = [{ from: String(args.from), to: String(args.to) }]
  }
  pairs = pairs.filter((p) => p.from && p.to)
  if (!pairs.length) return { name: toolName, ok: false, summary: 'no from/to pairs given' }
  return await planCardFlow(ctx, pairs.map((p) => ({ op, from: p.from, to: p.to })), toolName)
}

// ─── 8. box_trash (T3, per-action) ───────────────────────────────────────────
async function boxTrash(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const targets = (Array.isArray(args.paths) ? args.paths : [args.path]).filter(Boolean).map(String)
  if (!targets.length) return { name: 'box_trash', ok: false, summary: 'box_trash needs path or paths' }
  if (targets.length > 1) {
    return {
      name: 'box_trash',
      ok: false,
      summary: 'REFUSED: box_trash is Tier 3 and never batches. Trash items one at a time, or propose a cleanup plan (each trash item will still ask separately).',
    }
  }
  // typed permanent rule check (the ONLY way to skip the dialog)
  const rule = await findMatchingRule('box_trash', targets[0])
  if (!rule) {
    const res = await executeSingleTrash(targets[0], ctx.sessionId, ctx.emit)
    return { name: 'box_trash', ok: res.ok, summary: res.line }
  }
  const { db } = await import('@/lib/db')
  await db.awonAudit.create({ data: { action: 'desktop.trash.rule', detail: `${targets[0]} matched typed rule "${rule.ruleText}"`, ok: true } })
  const res = await executeSingleTrash(targets[0], ctx.sessionId, ctx.emit)
  return { name: 'box_trash', ok: res.ok, summary: `${res.line} (typed rule matched: "${rule.ruleText}")` }
}

// ─── 9. box_undo (T2 card over the inverse batch) ────────────────────────────
async function boxUndo(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const runId = args.runId ? String(args.runId) : await latestUndoableRun(ctx.sessionId)
  if (!runId) return { name: 'box_undo', ok: false, summary: 'no undoable run found for this session' }
  const res = await undoRun(runId, ctx.sessionId, ctx.emit)
  return {
    name: 'box_undo',
    ok: res.ok,
    summary: res.ok ? `undone run ${runId}: ${res.lines.length} steps reversed` : res.error ?? 'undo failed',
    detail: res.lines.join('\n') || res.error,
  }
}

// ─── 10. shell_exec (T3 EXTREME) ─────────────────────────────────────────────
async function shellExec(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  const command = String(args.command ?? '').trim()
  if (!command) return { name: 'shell_exec', ok: false, summary: 'shell_exec needs a command' }
  // rm is structurally impossible (not whitelisted) - reject early for a
  // clearer audit line, the tokenizer whitelist is the real wall
  if (/(^|\s|\/)rm\s/.test(command) || command.split(/\s+/)[0] === 'rm') {
    return { name: 'shell_exec', ok: false, summary: 'rm is NEVER available. Deletions are box_trash moves into .awon-trash (undoable).' }
  }
  // EXTREME consent: a typed rule match may skip the dialog; otherwise the
  // card requires typing the exact command as a rule - no checkbox anywhere
  const rule = await findMatchingRule('shell_exec', command)
  if (!rule) {
    const ans = await requestConsent(
      {
        sessionId: ctx.sessionId,
        tier: 3,
        title: 'Run a command inside the box (Tier 3 EXTREME)',
        detail: `Command: ${command.slice(0, 300)}\n\nShell-less (no chaining, no redirection), whitelisted binaries, 15s timeout, supervised. To allow this command permanently, choose TYPE A RULE and type exactly: always allow shell_exec: ${command.slice(0, 80)}`,
        payload: { kind: 'shell', command },
      },
      ctx.emit,
    )
    if (ans.status !== 'approved') {
      await import('@/lib/db').then(({ db }) => db.awonAudit.create({ data: { action: 'desktop.shell_exec', detail: `${command.slice(0, 120)} ${ans.status}`, ok: false } }))
      return { name: 'shell_exec', ok: false, summary: `command not run (${ans.status})` }
    }
  }
  const res = await boxExec(command)
  const { db } = await import('@/lib/db')
  await db.awonAudit.create({ data: { action: 'desktop.shell_exec', detail: `${command.slice(0, 120)} exit=${res.code}${rule ? ' [typed rule]' : ''}`, ok: res.ok } })
  return {
    name: 'shell_exec',
    ok: res.ok,
    summary: res.timedOut ? `TIMED OUT after 15s: ${command.slice(0, 80)}` : `exit ${res.code}: ${(res.stdout || res.stderr).slice(0, 160) || '(no output)'}`,
    detail: `${res.stdout}\n${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`.slice(0, 4000),
  }
}

// ─── 11. screen_shot (T1, virtual display) ───────────────────────────────────
async function screenShot(args: Record<string, unknown>, ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  if (!(await consentRead(ctx, 'AWON asks to screenshot the VIRTUAL display (Xvfb). Nothing physical is captured.', { op: 'screen_shot' }))) {
    return { name: 'screen_shot', ok: false, summary: 'read consent denied' }
  }
  const { root } = await ensureDisplay()
  const shot = await captureScreen(root)
  // serve through the box tmp -> copy to workspace so the console can show it
  const rel = `box-screen-${Date.now()}.png`
  const { writeArtifactBuffer } = await import('../workspace')
  writeArtifactBuffer(`boxshots_${ctx.sessionId.slice(0, 8)}`, rel, fs.readFileSync(shot.abs))
  let seg: Awaited<ReturnType<typeof segmentScreenshot>> | null = null
  if (args.analyze === true) {
    try {
      seg = await segmentScreenshot(shot.abs)
    } catch {}
  }
  return {
    name: 'screen_shot',
    ok: true,
    summary: `captured ${root} (${Math.round(shot.bytes / 1024)}KB)${seg ? `, ${seg.regions.length} candidate regions` : ''}`,
    detail: seg ? `${seg.note}\n\n${seg.regions.slice(0, 12).map((r) => `(${r.x},${r.y} ${r.w}x${r.h}) conf=${r.confidence} ${r.kind}`).join('\n')}` : 'use analyze_image on the workspace file for semantic understanding',
  }
}

// ─── 12/13. screen_click / screen_type (T3, fail closed) ─────────────────────
async function screenClick(_args: Record<string, unknown>, _ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  try {
    await inputUnavailableError()
    return { name: 'screen_click', ok: false, summary: 'unreachable' }
  } catch (e) {
    return { name: 'screen_click', ok: false, summary: (e as Error).message }
  }
}

async function screenType(_args: Record<string, unknown>, _ctx: BoxPrimitiveCtx): Promise<ToolOutcome> {
  try {
    await inputUnavailableError()
    return { name: 'screen_type', ok: false, summary: 'unreachable' }
  } catch (e) {
    return { name: 'screen_type', ok: false, summary: (e as Error).message }
  }
}

export { BOX_HOME, defaultMounts, isAborted }
