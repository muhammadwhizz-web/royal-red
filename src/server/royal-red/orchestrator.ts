// ROYAL RED orchestrator — Phase 5 slice 1 (Round 4): the planner/builder pair.
//
// WHAT THIS IS (and is not)
//   The minimum slice that proves the isolation model works: ONE planner
//   sub-agent + ONE builder sub-agent, sharing ONE Box, ONE consent queue, ONE
//   undo journal, ONE session event log — with the attribution and caps from
//   docs/PHASE5-ISOLATION.md. No critic team (Round 6), no third sub-agent
//   type, no recursion below depth 1 (the kernel caps in subagents.ts deny it).
//
// THE LOOP (the directive's contract):
//   planner proposes a task list -> builder executes ONE task ->
//   planner reviews and decides done | retry (once, bounded) | escalate ->
//   next task or honest stop. Every step attributed, budgeted, pausable,
//   abortable, journaled.
//
// LIFECYCLE DISCIPLINE: every sub-run closes EXACTLY ONCE (closeSubRunOnce).
// An aborted sub-agent's `subagent/aborted` lifecycle event comes from the
// scalpel (abortOneRun); the orchestrator only closes the run row via
// finishRun — the single run/ended choke point. No duplicate terminal events.
//
// ATTRIBUTION LAW: every sub-agent event lands on the durable log with its
// runId (partitioned at read-side); every sub-agent audit row carries
// subAgentId (`<role>:<runId>`) AND parentRunId. Nothing is unattributed.
//
// HONESTY LAW: degrade paths (spawn denied, malformed plan, budget exhausted,
// abort, pause) all produce a typed event, an audit row, and a plain-language
// line to the user — the same shape as the kill-switch report.

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import type { RoyalRedSseEvent } from '@/lib/royal-red/types'
import { extractAndSaveLedger, ledgerForBuilder } from './verify/ledger'
import { runVerification } from './verify/engine'
import { appendEvent, durableEmitter } from './event-log'
import { seamComplete, type SeamCompleteOpts, type SeamResult } from './llm/seam'
import { beginRun, finishRun, isAborted } from './box/ops'
import { emptyPlan, spawnSubRun, finishSubRun, type SpawnedSubRun } from './subagents'
import {
  beginBudget, emitBudgetExhausted, getUsage, maybeWarn, capsFor,
} from './budget'
import { waitWhilePaused } from './pause-state'

type Emit = (e: RoyalRedSseEvent) => void

const PLANNER_TASKS_MAX = 3
const BUILDER_RETRIES_MAX = 1
const CALL_TIMEOUT_MS = 120_000

// test seam override: deterministic scripts inject a scripted seam so the
// orchestration CONTRACT is testable without a live model
export interface SeamOverride {
  complete(opts: SeamCompleteOpts): Promise<SeamResult>
}

interface PlannerTask {
  id: string
  title: string
  description: string
  acceptance: string
}

interface BuilderDelivery {
  say?: string
  notes?: string
  artifact?: { name?: string; entry?: string; files: { path: string; content: string }[] }
}

export function shouldOrchestrate(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.startsWith('/team')) return true
  // conservative auto-detection: a research-shaped verb AND a build-shaped
  // deliverable in one build-mode prompt (e.g. "research 3 coffee brands and
  // write a landing page comparing them"). Simple one-shot builds never match.
  const researchish = /\b(research|compare|investigate|gather|find|survey|analy[sz]e)\b/.test(t)
  const buildish = /\b(write|build|make|create|design|produce|draft)\b/.test(t) && /\b(landing page|website|web ?site|web ?page|page|site|dashboard|pdf|deck|report)\b/.test(t)
  return researchish && buildish
}

function extractJson<T>(raw: string): T | null {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  if (start === -1) return null
  // scan to the matching close brace (tolerates braces inside strings)
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function clip(s: unknown, n: number): string {
  return typeof s === 'string' ? s.slice(0, n) : ''
}

export interface OrchestratorResult {
  ok: boolean
  artifactId?: string
  tasks: PlannerTask[]
  verdict: 'done' | 'escalated' | 'aborted' | 'failed'
  notes?: string
  stopReason?: string
}

export async function runOrchestratedTurn(opts: {
  sessionId: string
  userText: string
  emit: Emit
  signal?: AbortSignal
  seam?: SeamOverride
  /**
   * test seam: the deterministic scripts assert the ORCHESTRATION contract
   * (spawns, attribution, verdicts, budget) without depending on the live
   * model twice; the real acceptance runs with verification ON (default).
   */
  verification?: boolean
}): Promise<OrchestratorResult> {
  const { sessionId } = opts
  const rawEmit = opts.emit
  const stopped = () => opts.signal?.aborted === true
  // test seam: default is the real seam (house + router + budget gate)
  const seam: SeamOverride = opts.seam ?? { complete: seamComplete }

  // ── top-level orchestrator run (depth 0, role null) ──────────────────────
  const topRunId = await beginRun(sessionId, 'orchestrator', emptyPlan())
  beginBudget(topRunId, 'top')
  const emit = durableEmitter(sessionId, rawEmit as (e: { type: string } & Record<string, unknown>) => void, topRunId) as Emit
  const auditTop = (action: string, detail: string, ok = true) =>
    db.royalRedAudit.create({ data: { action, runId: topRunId, detail: detail.slice(0, 300), ok } })

  emit({ type: 'mode', value: 'build' })
  emit({ type: 'phase', value: 'orchestrating: constraint ledger' })
  await auditTop('orchestrator.started', `top run ${topRunId} for: ${opts.userText.slice(0, 160)}`)

  // constraint ledger (same primitive as the single-agent loop — verification
  // grades the SAME ledger for orchestrated artifacts)
  let ledgerText = ''
  try {
    const items = await extractAndSaveLedger(sessionId, opts.userText)
    if (items.length) {
      ledgerText = ledgerForBuilder(items)
      emit({ type: 'constraints', items })
    }
  } catch {
    // ledger extraction is best-effort; the orchestration never depends on it
  }

  const pauseGate = async (): Promise<boolean> => {
    // true = continue; false = aborted (pause lifted by the kill switch)
    const r = await waitWhilePaused(sessionId, () => isAborted(topRunId))
    return r === 'resumed'
  }

  const notes: string[] = []
  let artifactId: string | null = null
  let verdict: OrchestratorResult['verdict'] = 'failed'
  let stopReason: string | undefined

  // ── spawn + run the PLANNER ───────────────────────────────────────────────
  emit({ type: 'phase', value: 'orchestrating: spawning planner' })
  const plannerSpawn = await spawnSubRun({ sessionId, parentRunId: topRunId, role: 'planner', task: opts.userText })
  const emitFor = (sub: SpawnedSubRun | null, fallback: string) =>
    durableEmitter(sessionId, rawEmit as (e: { type: string } & Record<string, unknown>) => void, sub ? sub.runId : fallback) as Emit

  let planner: SpawnedSubRun | null = null
  let plannerClosed = false
  // an aborted sub-agent already has its subagent/aborted event from the
  // scalpel; close = run row only. A finished sub-agent closes via
  // finishSubRun (lifecycle event + run row).
  const closePlanner = async (status: 'done' | 'aborted', note: string) => {
    if (plannerClosed || !planner) return
    plannerClosed = true
    if (status === 'aborted') await finishRun(planner.runId, 'aborted')
    else await finishSubRun(planner, 'done', note)
  }

  let tasks: PlannerTask[] = []

  if ('denied' in plannerSpawn) {
    stopReason = `planner spawn denied by kernel: ${plannerSpawn.denied.detail}`
    emit({ type: 'say', text: `**Orchestrator degraded honestly:** ${stopReason} Proceeding with the raw command as the single task.` })
    await auditTop('orchestrator.degraded', stopReason, false)
    tasks = [{ id: 'T1', title: opts.userText.slice(0, 80), description: opts.userText, acceptance: 'delivered' }]
  } else {
    planner = plannerSpawn
    rawEmit({ type: 'subagent', phase: 'spawned', role: 'planner', runId: planner.runId, parentRunId: topRunId } as unknown as RoyalRedSseEvent)
    const pEmit = emitFor(planner, topRunId)
    pEmit({ type: 'phase', value: 'PLANNER: proposing task list' })

    const planCall = async (repairNote?: string): Promise<string | null> => {
      const r = await seam.complete({
        operation: 'orchestrator.plan',
        sessionId,
        runId: planner!.runId,
        role: 'planner',
        timeoutMs: CALL_TIMEOUT_MS,
        messages: [
          {
            role: 'system',
            content:
              'You are the PLANNER sub-agent of ROYAL RED. Decompose the user command into AT MOST 3 concrete, sequentially executable tasks. Output EXACTLY ONE valid JSON object, no prose, no markdown fences: {"tasks":[{"id":"T1","title":"short imperative title","description":"what the BUILDER sub-agent must do for this task","acceptance":"how the PLANNER will judge this task done"}]}. For research-and-build commands, an early task must produce written research notes and a final task must produce the deliverable itself. Keep descriptions under 60 words each.',
          },
          {
            role: 'user',
            content: `USER COMMAND: ${opts.userText.slice(0, 2000)}${ledgerText ? `\n\nVERIFICATION LEDGER (every task must serve these):\n${ledgerText.slice(0, 3000)}` : ''}${repairNote ? `\n\n${repairNote}` : ''}`,
          },
        ],
      })
      if (!r.ok) {
        if (r.meta.budgetExhausted) {
          const line = await emitBudgetExhausted({
            sessionId, runId: planner!.runId, subAgentId: planner!.subAgentId, parentRunId: planner!.parentRunId,
            role: 'planner', reason: 'tokens-in', used: getUsage(planner!.runId) ?? undefined, caps: capsFor('planner'),
          })
          pEmit({ type: 'say', text: `PLANNER: ${line}` })
          await closePlanner('done', line)
        }
        return null
      }
      return r.text
    }

    if (!(await pauseGate()) || stopped()) {
      await closePlanner('aborted', 'aborted before planning (kill switch / pause aborted)')
      await finishRun(topRunId, 'aborted')
      return { ok: false, tasks, verdict: 'aborted', stopReason: 'aborted before planning' }
    }

    let planRaw = await planCall()
    let parsed = planRaw ? extractJson<{ tasks: PlannerTask[] }>(planRaw) : null
    if (!parsed && planRaw) {
      pEmit({ type: 'phase', value: 'PLANNER: repairing malformed plan' })
      planRaw = await planCall('MALFORMED_PLAN: re-output EXACTLY ONE small valid JSON object {"tasks":[...]}, at most 3 tasks.')
      parsed = planRaw ? extractJson<{ tasks: PlannerTask[] }>(planRaw) : null
    }
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length) {
      tasks = parsed.tasks.slice(0, PLANNER_TASKS_MAX).map((t, i) => ({
        id: String(t.id ?? `T${i + 1}`).slice(0, 8),
        title: clip(t.title, 120) || `Task ${i + 1}`,
        description: clip(t.description, 600) || clip(t.title, 200),
        acceptance: clip(t.acceptance, 300) || 'delivered',
      }))
      // the planner stays RESIDENT (open) from here until turn end — it
      // reviews every builder delivery. Exactly ONE close, at the end.
    } else {
      // planner could not produce a plan: degrade honestly, keep the slice alive
      stopReason = 'planner produced no parseable task list (degraded to the raw command as one task)'
      emit({ type: 'say', text: `**PLANNER degraded honestly:** ${stopReason}` })
      await auditTop('orchestrator.degraded', stopReason, false)
      await closePlanner('done', 'no parseable plan; degraded')
      planner = null
      tasks = [{ id: 'T1', title: opts.userText.slice(0, 80), description: opts.userText, acceptance: 'delivered' }]
    }
  }

  emit({
    type: 'plan',
    plan: tasks.map((t) => ({ id: t.id, title: t.title, done: false })),
  })
  await appendEvent({ sessionId, runId: topRunId, type: 'plan/updated', payload: { source: 'planner', tasks } })

  // ── the BUILD LOOP: builder executes one task, planner reviews the verdict ─
  let taskCursor = 0
  let escalated = false

  for (taskCursor = 0; taskCursor < tasks.length; taskCursor++) {
    const task = tasks[taskCursor]
    if (stopped() || !(await pauseGate())) {
      verdict = 'aborted'
      stopReason = stopReason ?? `aborted before task ${task.id}`
      break
    }
    emit({ type: 'plan', plan: tasks.map((t, i) => ({ id: t.id, title: t.title, done: i < taskCursor })) })
    emit({ type: 'phase', value: `orchestrating: ${task.id} — ${task.title}` })

    const builderSpawn = await spawnSubRun({ sessionId, parentRunId: topRunId, role: 'builder', task: `${task.title}: ${task.description}` })
    if ('denied' in builderSpawn) {
      stopReason = `builder spawn denied by kernel: ${builderSpawn.denied.detail}`
      emit({ type: 'error', message: stopReason })
      await auditTop('orchestrator.degraded', stopReason, false)
      escalated = true
      break
    }
    const builder = builderSpawn
    let builderClosed = false
    const closeBuilder = async (status: 'done' | 'aborted', note: string) => {
      if (builderClosed) return
      builderClosed = true
      if (status === 'aborted') await finishRun(builder.runId, 'aborted')
      else await finishSubRun(builder, 'done', note)
    }
    rawEmit({ type: 'subagent', phase: 'spawned', role: 'builder', runId: builder.runId, parentRunId: topRunId } as unknown as RoyalRedSseEvent)
    const bEmit = emitFor(builder, topRunId)
    bEmit({ type: 'phase', value: `BUILDER: executing ${task.id}` })

    const buildOnce = async (retryReason?: string): Promise<BuilderDelivery | { fail: string; budget?: string }> => {
      const r = await seam.complete({
        operation: 'orchestrator.build',
        sessionId,
        runId: builder.runId,
        role: 'builder',
        timeoutMs: CALL_TIMEOUT_MS,
        messages: [
          {
            role: 'system',
            content:
              'You are the BUILDER sub-agent of ROYAL RED, executing ONE task assigned by the PLANNER. Output EXACTLY ONE valid JSON object, no prose, no markdown fences. ' +
              'For research/gathering tasks: {"say":"one sentence","notes":"your full research notes as plain text (markdown allowed)"} — notes must contain concrete facts (names, positioning, price points, verdicts). ' +
              'For production tasks: {"say":"one sentence","artifact":{"name":"short-name","entry":"index.html","files":[{"path":"index.html","content":"<!doctype html>..."}]}} — a COMPLETE single-file HTML deliverable, self-contained (inline CSS/JS), at most 160 lines, with a visible section that presents the research findings (embed the key findings inline AND link research-notes.md). ' +
              'You may combine both shapes: {"say":"...","notes":"...","artifact":{...}}. NEVER output anything except one JSON object.',
          },
          {
            role: 'user',
            content: `OVERALL GOAL: ${opts.userText.slice(0, 1500)}\n\nYOUR TASK (${task.id}): ${task.title}\n${task.description}\nACCEPTANCE: ${task.acceptance}\n${ledgerText ? `\nVERIFICATION LEDGER:\n${ledgerText.slice(0, 2500)}` : ''}\n${notes.length ? `\nRESEARCH NOTES FROM EARLIER TASKS (use them; do not contradict them):\n${notes.join('\n\n').slice(0, 4000)}` : ''}\n${retryReason ? `\nPLANNER REVIEW SAID RETRY: ${retryReason}\nFix exactly this and re-deliver.` : ''}`,
          },
        ],
      })
      if (!r.ok) {
        if (r.meta.budgetExhausted) {
          const line = await emitBudgetExhausted({
            sessionId, runId: builder.runId, subAgentId: builder.subAgentId, parentRunId: builder.parentRunId,
            role: 'builder', reason: 'tokens-in', used: getUsage(builder.runId) ?? undefined, caps: capsFor('builder'),
          })
          bEmit({ type: 'say', text: `BUILDER: ${line}` })
          return { fail: line, budget: line }
        }
        return { fail: r.meta.error ?? 'builder call failed' }
      }
      const parsed = extractJson<BuilderDelivery>(r.text)
      if (!parsed) return { fail: 'builder produced unparseable output' }
      return parsed
    }

    // wall-clock half tripwire (budget/warning event)
    void maybeWarn(sessionId, builder.runId, 'builder', 'wall-clock-half')

    let delivery = await buildOnce()
    let deliveryIsFail = 'fail' in delivery
    let retries = 0
    let taskAborted = false

    // ── planner REVIEW: done | retry (once) | escalate ──────────────────────
    while (true) {
      if (stopped() || isAborted(builder.runId) || isAborted(topRunId) || !(await pauseGate())) {
        await closeBuilder('aborted', `aborted during ${task.id}; siblings + finished tasks intact; session resumable`)
        taskAborted = true
        verdict = 'aborted'
        stopReason = `aborted during task ${task.id}; planner + finished tasks intact; session resumable`
        break
      }

      if (deliveryIsFail) {
        const f = delivery as { fail: string; budget?: string }
        if (f.budget) {
          // a budget stop IS an honest stop (escalation rule 1): the sub-run
          // ends done with a partial-work receipt, never killed mid-call
          await closeBuilder('done', f.budget)
          verdict = verdict === 'aborted' ? verdict : 'done'
          stopReason = f.budget
          break
        }
        emit({ type: 'error', message: `BUILDER failed on ${task.id}: ${f.fail}` })
        await auditTop('orchestrator.builder_failed', `${task.id}: ${f.fail}`, false)
        if (retries < BUILDER_RETRIES_MAX) {
          retries++
          delivery = await buildOnce(`previous attempt failed technically: ${f.fail}`)
          deliveryIsFail = 'fail' in delivery
          continue
        }
        await closeBuilder('aborted', `could not complete ${task.id} after ${retries} technical retry`)
        escalated = true
        stopReason = `builder could not complete ${task.id}: ${f.fail}`
        break
      }

      const d = delivery as BuilderDelivery
      if (typeof d.say === 'string' && d.say.trim()) bEmit({ type: 'say', text: `BUILDER: ${d.say.slice(0, 400)}` })
      if (typeof d.notes === 'string' && d.notes.trim().length > 40) notes.push(`## ${task.title}\n${d.notes.slice(0, 6000)}`)

      const artifactReady = !!(d.artifact && Array.isArray(d.artifact.files) && d.artifact.files.some((f) => typeof f.content === 'string' && f.content.length > 40))
      const researchReady = !!(d.notes && d.notes.trim().length > 40)
      if (!artifactReady && !researchReady) {
        if (retries < BUILDER_RETRIES_MAX) {
          retries++
          bEmit({ type: 'phase', value: `BUILDER: empty delivery, retry ${retries}/${BUILDER_RETRIES_MAX}` })
          delivery = await buildOnce('your last delivery contained no notes and no artifact files; deliver real content now')
          deliveryIsFail = 'fail' in delivery
          continue
        }
        await closeBuilder('done', `empty delivery for ${task.id}; escalated`)
        escalated = true
        stopReason = `builder delivered nothing usable for ${task.id}`
        break
      }

      // persist the artifact NOW (versioned, attributed to the builder run)
      if (artifactReady) {
        const a = (delivery as BuilderDelivery).artifact!
        const id = await persistOrchestratedArtifact({
          sessionId,
          runId: builder.runId,
          parentRunId: topRunId,
          emit: bEmit,
          name: clip(a.name, 80) || 'orchestrated-artifact',
          entry: clip(a.entry, 120) || 'index.html',
          files: a.files.filter((f) => typeof f.path === 'string' && !f.path.includes('..')),
          notes: notes.join('\n\n').slice(0, 40_000),
        })
        if (id) artifactId = id
      }

      // the planner reviews the builder's result (verdict is a typed event)
      emit({ type: 'phase', value: `PLANNER: reviewing ${task.id}` })
      if (planner) {
        const review = await seam.complete({
          operation: 'orchestrator.review',
          sessionId,
          runId: planner.runId,
          role: 'planner',
          timeoutMs: CALL_TIMEOUT_MS,
          messages: [
            {
              role: 'system',
              content:
                'You are the PLANNER sub-agent of ROYAL RED reviewing the BUILDER sub-agent\'s result for one task. Output EXACTLY ONE valid JSON object: {"verdict":"done"|"retry"|"escalate","reason":"one or two sentences"}. "done" = the task\'s acceptance is met well enough to proceed; "retry" = fixable this instant, say precisely what to fix; "escalate" = the task cannot be completed honestly (impossible, out of scope, or repeatedly failed). Be pragmatic: a complete working deliverable beats a perfect fragment.',
            },
            {
              role: 'user',
              content: `TASK (${task.id}): ${task.title}\nACCEPTANCE: ${task.acceptance}\n\nBUILDER RESULT:\nsaid: ${clip(d.say, 300) || '(nothing)'}\nresearch notes: ${d.notes ? `yes (${d.notes.length} chars)` : 'no'}\nartifact: ${d.artifact ? `${(d.artifact.files ?? []).length} file(s): ${(d.artifact.files ?? []).map((f) => f.path).join(', ').slice(0, 200)}` : 'no'}\n\nVerdict?`,
            },
          ],
        })
        if (review.ok) {
          const v = extractJson<{ verdict: string; reason?: string }>(review.text)
          const word = v?.verdict === 'retry' && retries >= BUILDER_RETRIES_MAX ? 'escalate' : String(v?.verdict ?? 'done')
          const reason = clip(v?.reason, 300)
          await appendEvent({ sessionId, runId: planner.runId, type: 'subagent/verdict', payload: { task: task.id, verdict: word, reason, subAgentId: planner.subAgentId } })
          await db.royalRedAudit.create({
            data: {
              action: 'orchestrator.verdict',
              runId: planner.runId,
              subAgentId: planner.subAgentId,
              parentRunId: planner.parentRunId,
              detail: `${task.id}: ${word} — ${reason}`,
              ok: word !== 'escalate',
            },
          })
          rawEmit({ type: 'subagent', phase: 'verdict', role: 'planner', runId: planner.runId, parentRunId: topRunId, label: `${task.id}: ${word}`, status: word } as unknown as RoyalRedSseEvent)
          if (word === 'retry' && retries < BUILDER_RETRIES_MAX) {
            retries++
            emit({ type: 'say', text: `**PLANNER verdict on ${task.id}: retry.** ${reason}` })
            bEmit({ type: 'phase', value: `BUILDER: retry ${retries}/${BUILDER_RETRIES_MAX} on ${task.id}` })
            delivery = await buildOnce(reason)
            deliveryIsFail = 'fail' in delivery
            continue
          }
          if (word === 'escalate') {
            await closeBuilder('done', `${task.id} delivered; planner escalated the task`)
            escalated = true
            stopReason = `planner escalated on ${task.id}: ${reason}`
            emit({ type: 'say', text: `**PLANNER verdict on ${task.id}: escalate.** ${reason}\n\nPartial work is saved and attributed. The turn ends honestly here.` })
            break
          }
        } else if (review.meta.budgetExhausted) {
          const line = await emitBudgetExhausted({
            sessionId, runId: planner.runId, subAgentId: planner.subAgentId, parentRunId: planner.parentRunId,
            role: 'planner', reason: 'tokens-in', used: getUsage(planner.runId) ?? undefined, caps: capsFor('planner'),
          })
          emit({ type: 'say', text: `PLANNER: ${line}` })
          stopReason = line
        }
      }
      await closeBuilder('done', `${task.id} executed (retries=${retries})`)
      break
    }

    if (taskAborted) break
    if (escalated) break
  }

  emit({
    type: 'plan',
    plan: tasks.map((t, i) => ({ id: t.id, title: t.title, done: escalated ? i < taskCursor : true })),
  })

  // close the resident planner honestly (it reviewed every executed task)
  await closePlanner(verdict === 'aborted' ? 'aborted' : 'done', verdict === 'aborted' ? 'session aborted mid-review' : `reviewed ${Math.min(taskCursor + 1, tasks.length)} task(s)`)

  // ── verification pipeline (the moat, unchanged, on the orchestrated artifact)
  if (artifactId && !stopped() && opts.verification !== false) {
    try {
      const artifactRow = await db.royalRedArtifact.findUnique({ where: { id: artifactId }, select: { files: true, score: true } })
      if (artifactRow) {
        emit({ type: 'phase', value: 'verification 2.0 (orchestrated artifact)' })
        await runVerification(sessionId, artifactId, opts.userText, artifactRow.score, {
          emit: (e) => emit(e as RoyalRedSseEvent),
        })
      }
    } catch (ve) {
      emit({ type: 'error', message: `verification pipeline error: ${(ve as Error).message.slice(0, 160)}` })
    }
  }

  // ── close the top run honestly ─────────────────────────────────────────────
  const usageTop = getUsage(topRunId)
  if (verdict !== 'aborted') {
    verdict = escalated ? 'escalated' : artifactId || notes.length ? 'done' : 'failed'
  }
  if (escalated && !stopReason) stopReason = 'planner escalated'
  await finishRun(topRunId, verdict === 'aborted' ? 'aborted' : 'done')
  await auditTop(
    'orchestrator.finished',
    `verdict=${verdict} tasks=${Math.min(taskCursor + 1, tasks.length)}/${tasks.length} artifact=${artifactId ?? 'none'} notes=${notes.length} top-tokens=${usageTop ? `${usageTop.tokensIn}in/${usageTop.tokensOut}out` : 'n/a'}${stopReason ? ` stop=${stopReason}` : ''}`,
    verdict !== 'failed',
  )
  const summary = [
    verdict === 'done'
      ? '**Orchestrated turn complete.**'
      : verdict === 'aborted'
        ? '**Orchestrated turn aborted.**'
        : '**Orchestrated turn stopped honestly.**',
    'The planner and builder ran as attributed sub-agents (audit rows carry subAgentId + parentRunId; the event log partitions per run).',
    artifactId ? 'The artifact is versioned, undoable, and verified like any single-agent build.' : 'No artifact was produced.',
    stopReason ? `Stop reason: ${stopReason}` : '',
  ].filter(Boolean).join(' ')
  emit({ type: 'say', text: summary })
  void appendEvent({ sessionId, runId: topRunId, type: 'turn/ended', payload: { reason: verdict, artifactId: artifactId ?? null } })
  emit({ type: 'done' })
  return { ok: verdict === 'done', artifactId: artifactId ?? undefined, tasks, verdict, notes: notes.join('\n\n'), stopReason }
}

// ─── artifact persistence (the SAME versioned path as the single-agent loop) ─

async function persistOrchestratedArtifact(params: {
  sessionId: string
  runId: string
  parentRunId: string
  emit: Emit
  name: string
  entry: string
  files: { path: string; content: string }[]
  notes: string
}): Promise<string | null> {
  try {
    const { ensureWorkspace, writeArtifactFiles } = await import('./workspace')
    const { snapshotArtifactVersion } = await import('./versions')
    ensureWorkspace()
    const files = [...params.files]
    if (params.notes.trim()) files.push({ path: 'research-notes.md', content: params.notes })
    const json = JSON.stringify(files)
    const existing = await db.royalRedArtifact.findFirst({ where: { sessionId: params.sessionId, name: params.name }, orderBy: { createdAt: 'desc' } })
    let id: string
    if (existing) {
      const prev = JSON.parse(existing.files) as { path: string; content: string }[]
      const map = new Map(prev.map((f) => [f.path, f.content]))
      for (const f of files) map.set(f.path, f.content)
      const merged = [...map.entries()].map(([p, content]) => ({ path: p, content }))
      const mergedJson = JSON.stringify(merged)
      await db.royalRedArtifact.update({ where: { id: existing.id }, data: { files: mergedJson, entry: params.entry } })
      await snapshotArtifactVersion(existing.id, mergedJson, `orchestrated merge (${params.runId})`)
      id = existing.id
    } else {
      id = `royalred_${randomUUID().slice(0, 12)}`
      await db.royalRedArtifact.create({
        data: { id, sessionId: params.sessionId, name: params.name, kind: 'site', entry: params.entry, files: json },
      })
      await snapshotArtifactVersion(id, json, `orchestrated initial build (${params.runId})`)
    }
    try {
      writeArtifactFiles(id, files)
    } catch (we) {
      console.error('orchestrator workspace write failed', we)
    }
    params.emit({ type: 'artifact', id, name: params.name, entry: params.entry, files: files.map((f) => f.path) })
    await appendEvent({ sessionId: params.sessionId, runId: params.runId, type: 'artifact/written', payload: { id, name: params.name, files: files.map((f) => f.path) } })
    await db.royalRedAudit.create({
      data: {
        action: 'orchestrator.artifact',
        runId: params.runId,
        subAgentId: `builder:${params.runId}`,
        parentRunId: params.parentRunId,
        detail: `artifact ${id} (${params.name}) written by builder run, ${files.length} file(s), versioned + undoable`,
        ok: true,
      },
    })
    return id
  } catch (e) {
    params.emit({ type: 'error', message: `artifact write failed: ${(e as Error).message}` })
    return null
  }
}
