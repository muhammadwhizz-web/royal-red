// AWON agent runtime: directive loop, tool dispatch, artifact persistence, SSE emit
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import type {
  AwonMode,
  AwonSseEvent,
  Directive,
  ToolOutcome,
} from '@/lib/awon/types'
import { modeRules, REVIEW_INJECT, TOOL_LABELS, detectMode, stripModePrefix } from './prompts'
import { runTool } from './tools'
import { snapshotArtifactVersion } from './versions'
import {
  ensureWorkspace,
  writeArtifactFiles,
  writeArtifactBuffer,
  readArtifactFileBuffer,
  isImagePath,
} from './workspace'
import { extractAndSaveLedger, ledgerForBuilder } from './verify/ledger'
import { runVerification, verifyCritique } from './verify/engine'

type Emit = (e: AwonSseEvent) => void

const MAX_ITERATIONS = 14
// build turns are iteration hungry (chunked files, image gen + vision check cycles
// each cost one turn), so the factory floor gets a bigger budget
const MAX_ITERATIONS_BUILD = 22

interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

function compactHistory(
  turns: HistoryTurn[],
): string {
  return turns
    .map((t) => (t.role === 'user' ? `USER: ${t.content}` : `AWON_PREVIOUS: ${t.content}`))
    .join('\n\n')
    .slice(-14000)
}

export function extractJson(raw: string): Directive | null {
  let text = raw.trim()
  // strip fences if a model adds them despite instructions
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(candidate) as Directive
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

async function callLlm(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  })
  const content = completion.choices[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error('empty model response')
  return content
}

// extract structured, testable constraints from a substantive build command;
// skips trivial turns ("continue", "fix the header") to stay fast
function looksSubstantive(text: string, ledgerEmpty: boolean): boolean {
  if (ledgerEmpty) return true
  if (text.length >= 80) return true
  return /\b(must|should|need|require|add|include|make sure|also|no |never|don't|exclude)\b/i.test(text)
}

// short session title from the first command + reply; null on any failure
// (titles are cosmetic, never block the turn)
export async function generateSessionTitle(
  firstCommand: string,
  firstReply: string,
): Promise<string | null> {
  try {
    const raw = await callLlm([
      {
        role: 'system',
        content:
          'You name AWON session transcripts. Reply with EXACTLY one title: 3 to 6 words, Title Case, no quotes, no trailing period, no emoji. Describe the task, not the outcome.',
      },
      {
        role: 'user',
        content: `COMMAND: ${firstCommand.slice(0, 500)}\n\nAWON REPLY EXCERPT: ${firstReply.slice(0, 800)}`,
      },
    ])
    let t = raw.trim()
    t = t.replace(/^["'`]+|["'`.]+$/g, '').replace(/\s+/g, ' ')
    if (!t || t.length < 3 || t.length > 80 || /\n/.test(t)) return null
    return t.slice(0, 60)
  } catch {
    return null
  }
}

export async function runAwonTurn(opts: {
  sessionId: string
  userText: string
  requestedMode: AwonMode
  emit: Emit
  signal?: AbortSignal
}): Promise<void> {
  const { sessionId, emit } = opts
  // client disconnects (stop button, tab close) must end the loop server side,
  // otherwise iterations keep burning model calls after the UI is gone
  const stopped = () => opts.signal?.aborted === true
  ensureWorkspace()

  const userText = stripModePrefix(opts.userText)
  const slash = opts.userText.trim().startsWith('/')
  const detected = detectMode(opts.userText)
  // honor explicit modes; auto-correct only when the default BUILDER chip is
  // active but the command is clearly research/system work
  const mode: AwonMode = slash
    ? detected
    : opts.requestedMode === 'build' && (detected === 'research' || detected === 'pc')
      ? detected
      : opts.requestedMode
  emit({ type: 'mode', value: mode })

  // load prior compacted history
  const prior = await db.awonMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 30,
  })
  const history: HistoryTurn[] = prior.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.role === 'user' ? m.content : `[previous directive] ${m.meta ?? m.content}`.slice(0, 2500),
  }))

  const system = modeRules(mode)
  const chat: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
  ]
  if (history.length) chat.push({ role: 'user', content: `CONVERSATION SO FAR:\n${compactHistory(history)}` })

  // Phase 2.1 - CONSTRAINT LEDGER: build commands get a structured constraint
  // list extracted BEFORE the loop starts; the builder is told it will be
  // graded per constraint and the console shows the ledger immediately.
  // Substantive follow-up commands merge new constraints into the ledger.
  let ledgerText = ''
  if (mode === 'build' && !slash) {
    try {
      const existingCount = await db.awonConstraint.count({ where: { sessionId } })
      if (looksSubstantive(userText, existingCount === 0)) {
        emit({ type: 'phase', value: 'extracting constraints' })
        const items = await extractAndSaveLedger(sessionId, userText)
        if (items.length) {
          ledgerText = ledgerForBuilder(items)
          emit({ type: 'constraints', items })
        }
      }
    } catch {
      // ledger extraction is best-effort; the build never depends on it
    }
  }

  chat.push({ role: 'user', content: `USER COMMAND: ${userText}${ledgerText ? `\n\n${ledgerText}` : ''}` })

  let deliveredArtifactId: string | null = null
  let finalSay = ''
  let iteration = 0
  let fixAttempts = 0
  let lastSayText = ''
  let repeatedSays = 0
  let lastPlan: NonNullable<Directive['plan']> = []
  const maxIterations = mode === 'build' ? MAX_ITERATIONS_BUILD : MAX_ITERATIONS

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    if (stopped()) break
    emit({ type: 'phase', value: iteration === 1 ? 'processing command' : `iteration ${iteration}` })

    let raw: string
    try {
      raw = await callLlm(chat)
    } catch (e) {
      if (stopped()) break
      emit({ type: 'error', message: `model error: ${(e as Error).message}` })
      return
    }
    if (stopped()) break

    let d = extractJson(raw)
    if (!d) {
      // up to two repair retries with a shrinking budget instruction
      for (let repair = 1; repair <= 2 && !d; repair++) {
        chat.push({
          role: 'user',
          content:
            repair === 1
              ? 'MALFORMED_DIRECTIVE: your last output was not valid JSON (likely too long or truncated). Re-output EXACTLY ONE small valid JSON object: at most "say" (one sentence) plus ONE "file_chunk" of max 50 lines, or just "say". Smaller is always valid.'
              : 'STILL_MALFORMED: output EXACTLY ONE tiny JSON object. Safest: {"say":"one short sentence"} and nothing else.',
        })
        try {
          raw = await callLlm(chat)
          d = extractJson(raw)
        } catch {
          d = null
        }
      }
      if (!d) {
        if (deliveredArtifactId) {
          // partial work exists: degrade gracefully instead of killing the turn
          finalSay = finalSay || 'AWON hit a malformed directive mid-turn.'
          emit({
            type: 'say',
            text: `${finalSay}\n\nPartial progress is saved (artifact + files intact). Send **continue** to resume the loop.`,
          })
          emit({ type: 'done' })
          return
        }
        finalSay = 'AWON hit a malformed directive and aborted this turn. Try rephrasing the command.'
        emit({ type: 'say', text: finalSay })
        emit({ type: 'done' })
        return
      }
      // the repair succeeded because the model shrank its output to a bare
      // say-only directive; teach the truncation-recovery pattern so the next
      // iteration resumes DELIVERY instead of re-attempting the giant file
      const hasPayload =
        (d.artifact && Array.isArray(d.artifact.files) && d.artifact.files.length) ||
        (d.file_chunk && typeof d.file_chunk.content === 'string' && d.file_chunk.content.length) ||
        Array.isArray(d.tools) && d.tools.length
      if (!hasPayload) {
        chat.push({
          role: 'user',
          content: 'TRUNCATION RECOVERY: your long outputs keep getting cut off. From now on deliver content in SMALL PIECES: one artifact file or one file_chunk of at most 60 lines per turn, exactly like the normal build loop. Deliver the next chunk NOW instead of announcing it.',
        })
      }
    }

    // let the model see its own previous directive (loop memory)
    chat.push({ role: 'assistant', content: raw.slice(0, 3500) })

    // plan
    if (Array.isArray(d.plan) && d.plan.length) {
      lastPlan = d.plan.slice(0, 12)
      emit({ type: 'plan', plan: lastPlan })
    }

    // say
    if (typeof d.say === 'string' && d.say.trim()) {
      finalSay = d.say
      emit({ type: 'say', text: d.say })
    }

    // stuck-loop guard: the same say three iterations in a row with no file
    // delivery means the model is announcing instead of building; force the
    // incremental delivery pattern to break the loop
    const deliveredThisTurn =
      (d.artifact && Array.isArray(d.artifact.files) && d.artifact.files.length) ||
      (d.file_chunk && typeof d.file_chunk.content === 'string' && d.file_chunk.content.length)
    if (typeof d.say === 'string' && d.say.trim() && d.say === lastSayText && !deliveredThisTurn) {
      repeatedSays++
    } else {
      repeatedSays = 0
    }
    lastSayText = typeof d.say === 'string' ? d.say : lastSayText
    if (repeatedSays >= 2 && !deliveredThisTurn) {
      chat.push({
        role: 'user',
        content: 'LOOP BROKEN: you have repeated the same message without delivering files. Output ONE directive containing either artifact.files (one file, complete, at most 80 lines) or file_chunk (the next 60-80 lines of the largest unfinished file). No announcements - deliver.',
      })
    }

    // artifact (incremental: same name merges into the existing artifact)
    if (d.artifact && Array.isArray(d.artifact.files) && d.artifact.files.length) {
      const a = d.artifact
      const name = String(a.name ?? 'artifact').slice(0, 80)
      try {
        const existing = await db.awonArtifact.findFirst({
          where: { sessionId, name },
          orderBy: { createdAt: 'desc' },
        })
        let id: string
        let mergedFiles: { path: string; content: string }[]
        if (existing) {
          const prev = JSON.parse(existing.files) as { path: string; content: string }[]
          const map = new Map(prev.map((f) => [f.path, f.content]))
          for (const f of a.files) map.set(f.path, f.content)
          mergedFiles = [...map.entries()].map(([path, content]) => ({ path, content }))
          id = existing.id
          const mergedJson = JSON.stringify(mergedFiles)
          await db.awonArtifact.update({
            where: { id },
            data: {
              files: mergedJson,
              entry: String(a.entry ?? existing.entry),
              score: typeof d.score === 'number' ? Math.max(0, Math.min(10, Math.round(d.score))) : existing.score,
              review: typeof d.review === 'string' ? d.review.slice(0, 4000) : existing.review,
            },
          })
          await snapshotArtifactVersion(id, mergedJson, 'merge update')
        } else {
          id = `awon_${randomUUID().slice(0, 12)}`
          mergedFiles = a.files.map((f) => ({ path: f.path, content: f.content }))
          // carry binary assets (generated images) forward from earlier artifacts of
          // this session so relative refs like assets/logo.png keep working
          try {
            const priorArts = await db.awonArtifact.findMany({
              where: { sessionId },
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: { id: true, files: true },
            })
            for (const pa of priorArts) {
              const paFiles = JSON.parse(pa.files) as { path: string; content: string }[]
              for (const pf of paFiles) {
                if (!isImagePath(pf.path) || pf.content !== '') continue
                if (mergedFiles.some((m) => m.path === pf.path)) continue
                const buf = readArtifactFileBuffer(pa.id, pf.path)
                if (!buf) continue
                writeArtifactBuffer(id, pf.path, buf)
                mergedFiles.push({ path: pf.path, content: '' })
              }
            }
          } catch (carryErr) {
            console.error('asset carry-forward failed', carryErr)
          }
          const createdJson = JSON.stringify(mergedFiles)
          await db.awonArtifact.create({
            data: {
              id,
              sessionId,
              name,
              kind: String(a.kind ?? 'site'),
              entry: String(a.entry ?? 'index.html'),
              files: createdJson,
              score: typeof d.score === 'number' ? Math.max(0, Math.min(10, Math.round(d.score))) : null,
              review: typeof d.review === 'string' ? d.review.slice(0, 4000) : null,
            },
          })
          await snapshotArtifactVersion(id, createdJson, 'initial build')
        }
        try {
          writeArtifactFiles(id, a.files)
        } catch (we) {
          console.error('workspace write failed', we)
        }
        deliveredArtifactId = id
        emit({
          type: 'artifact',
          id,
          name,
          entry: String(a.entry ?? (existing ? existing.entry : 'index.html')),
          files: mergedFiles.map((f) => f.path),
          score: typeof d.score === 'number' ? Math.round(d.score) : undefined,
          review: typeof d.review === 'string' ? d.review : undefined,
        })
      } catch (e) {
        emit({ type: 'error', message: `artifact write failed: ${(e as Error).message}` })
      }
    }

    // file_chunk (append mode for large files, avoids output truncation)
    let chunked = false
    if (d.file_chunk && typeof d.file_chunk.path === 'string' && typeof d.file_chunk.content === 'string') {
      const cp = d.file_chunk
      const cleanPath = cp.path.replaceAll('\\', '/').replace(/^\/+/, '')
      if (cleanPath && !cleanPath.includes('..')) {
        try {
          const existing = await db.awonArtifact.findFirst({
            where: { sessionId },
            orderBy: { createdAt: 'desc' },
          })
          if (existing) {
            const files = JSON.parse(existing.files) as { path: string; content: string }[]
            const idx = files.findIndex((f) => f.path === cleanPath)
            if (idx >= 0) files[idx] = { path: cleanPath, content: files[idx].content + cp.content }
            else files.push({ path: cleanPath, content: cp.content })
            const chunkedJson = JSON.stringify(files)
            await db.awonArtifact.update({
              where: { id: existing.id },
              data: { files: chunkedJson },
            })
            await snapshotArtifactVersion(existing.id, chunkedJson, `file_chunk ${cleanPath}`)
            writeArtifactFiles(existing.id, [files.find((f) => f.path === cleanPath)!])
            deliveredArtifactId = existing.id
            chunked = true
            emit({
              type: 'artifact',
              id: existing.id,
              name: existing.name,
              entry: existing.entry,
              files: files.map((f) => f.path),
            })
          } else {
            const id = `awon_${randomUUID().slice(0, 12)}`
            const chunkCreateJson = JSON.stringify([{ path: cleanPath, content: cp.content }])
            await db.awonArtifact.create({
              data: {
                id,
                sessionId,
                name: 'artifact',
                entry: cleanPath,
                files: chunkCreateJson,
              },
            })
            await snapshotArtifactVersion(id, chunkCreateJson, `file_chunk ${cleanPath}`)
            writeArtifactFiles(id, [{ path: cleanPath, content: cp.content }])
            deliveredArtifactId = id
            chunked = true
            emit({ type: 'artifact', id, name: 'artifact', entry: cleanPath, files: [cleanPath] })
          }
        } catch (e) {
          emit({ type: 'error', message: `file chunk failed: ${(e as Error).message}` })
        }
      }
    }

    // tools
    const outcomes: ToolOutcome[] = []
    const tools = Array.isArray(d.tools) ? d.tools.slice(0, 5) : []
    for (const t of tools) {
      if (stopped()) break
      if (!t || typeof t.name !== 'string') continue
      emit({ type: 'tool_start', name: t.name, label: TOOL_LABELS[t.name] ?? t.name })
      const out = await runTool(t, { sessionId, emit })
      if (stopped()) break
      outcomes.push(out)
      emit({
        type: 'tool_end',
        name: t.name,
        ok: out.ok,
        summary: out.summary,
        output: out.detail ? `${out.summary}\n\n${out.detail}` : undefined,
      })
      if (out.ok && out.artifactPatch) {
        const p = out.artifactPatch
        deliveredArtifactId = p.id
        emit({
          type: 'artifact',
          id: p.id,
          name: p.name,
          entry: p.entry,
          files: p.files,
        })
      }
    }

    // persist assistant turn (tool output is stored too so restored sessions
    // keep the full OUTPUT expanders, not just the one-line summaries)
    await db.awonMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content:
          finalSay ||
          (stopped() ? '(stopped by user mid-turn; partial work is saved)' : outcomes.length ? '(working)' : ''),
        meta: JSON.stringify({
          mode,
          iteration,
          score: d.score ?? null,
          review: d.review ?? null,
          artifactId: deliveredArtifactId,
          plan: lastPlan.length ? lastPlan : null,
          tools: outcomes.map((o) => ({
            name: o.name,
            ok: o.ok,
            summary: o.summary,
            output: o.detail ? `${o.summary}\n\n${o.detail}`.slice(0, 4000) : undefined,
          })),
        }),
      },
    })

    const scoreGiven = typeof d.score === 'number'
    const belowBar = scoreGiven && (d.score as number) < 10
    // a honest 10/10 finish means the build plan completed: sync the rail so it
    // never shows stale unchecked items after the artifact ships
    if (scoreGiven && (d.score as number) >= 10 && lastPlan.some((p) => !p.done)) {
      lastPlan = lastPlan.map((p) => ({ ...p, done: true }))
      emit({ type: 'plan', plan: lastPlan })
    }
    const chunkPending = chunked && !d.file_chunk?.done
    const needsAnotherPass =
      chunkPending ||
      (deliveredArtifactId && !scoreGiven) ||
      (deliveredArtifactId && belowBar && fixAttempts < 4)
    if (outcomes.length) {
      chat.push({
        role: 'user',
        content: `TOOL_RESULTS:\n${outcomes
          .map((o) => `### ${o.name} ok=${o.ok}\n${o.detail ?? o.summary}`)
          .join('\n\n')
          .slice(0, 8000)}`,
      })
      continue
    }
    if (stopped()) break
    if (needsAnotherPass) {
      // iteration-budget awareness: when the loop is running out, tell the
      // builder plainly so it completes ALL requested sections before polish
      const budgetLeft = maxIterations - iteration
      const budgetLine =
        budgetLeft <= 6
          ? ` ITERATION BUDGET: ${budgetLeft} left. Prioritize delivering every requested section completely over polish; a complete site beats a polished fragment.`
          : ''
      if (belowBar) {
        fixAttempts++
        if (fixAttempts >= 4) {
          break
        }
        chat.push({
          role: 'user',
          content: `FIX_REQUIRED (pass ${fixAttempts}/4): your artifact scored ${(d.score as number)}/10. Repair it INCREMENTALLY: deliver ONLY the files that need changes, full contents (use file_chunk for large files). NEVER restart from scratch. NEVER resubmit files that are already good. Fix every deduction you listed, then give the new honest score. A complete working site that satisfies every bar item is 10. Scores of 0-2 are invalid for a functioning site; do not low-ball to earn extra turns.${budgetLine}`,
        })
      } else {
        chat.push({ role: 'user', content: REVIEW_INJECT + budgetLine })
      }
      continue
    }
    break
  }

  // ------------------------------------------------------------------
  // Phase 2 - VERIFICATION 2.0: the moat. When a build turn delivered an
  // artifact, the kernel proof-tests it before the turn ends: per-constraint
  // ledger grading, deterministic screenshots + perceptual regression, an
  // adversarial critique with no shared context, and CMS panel proof when a
  // cms page ships. Receipts stream to the console as 'verify' events and
  // PERSIST EVEN IF THE CLIENT DISCONNECTS mid-verification (emits become
  // no-ops; the receipts reload from the DB on the next session load).
  if (mode === 'build' && deliveredArtifactId) {
    try {
      const artifactRow = await db.awonArtifact.findUnique({
        where: { id: deliveredArtifactId },
        select: { files: true, score: true },
      })
      if (artifactRow) {
        const result = await runVerification(sessionId, deliveredArtifactId, userText, artifactRow.score, {
          emit: (e) => emit(e as AwonSseEvent),
        })

        // adversarial disagreement policy: |builder - critic| >= 2 triggers ONE
        // bounded regeneration pass fed by the critic's deductions, then a
        // critique-only re-check. Never more than one; never when stopped.
        if (
          result.critique?.disagree &&
          result.critique.critique.status === 'ok' &&
          result.critique.critique.deductions.length > 0 &&
          artifactRow.score !== null
        ) {
          emit({
            type: 'say',
            text: `**Adversarial review disagreement.** The independent critic scored ${result.critique.critique.score}/10 against the builder's ${artifactRow.score}/10. Running one regeneration pass on the critic's deductions.`,
          })
          chat.push({
            role: 'user',
            content: `ADVERSARIAL_REVIEW_REQUIRED: an INDEPENDENT critic (no shared context with you) scored this artifact ${result.critique.critique.score}/10, far from your ${artifactRow.score}/10. Fix the critic's deductions INCREMENTALLY (only changed files, full contents):\n${result.critique.critique.deductions.map((x, i) => `${i + 1}. ${x}`).join('\n')}\nThen give your new honest score.`,
          })
          for (let regen = 0; regen < 2; regen++) {
            if (stopped()) break
            emit({ type: 'phase', value: `regeneration pass ${regen + 1}` })
            let regenRaw = ''
            try {
              regenRaw = await callLlm(chat)
            } catch {
              break
            }
            const rd = extractJson(regenRaw)
            if (!rd) break
            chat.push({ role: 'assistant', content: regenRaw.slice(0, 3500) })
            if (typeof rd.say === 'string' && rd.say.trim()) emit({ type: 'say', text: rd.say })
            if (Array.isArray(rd.plan) && rd.plan.length) emit({ type: 'plan', plan: rd.plan.slice(0, 12) })
            let regenArtifact = false
            if (rd.artifact && Array.isArray(rd.artifact.files) && rd.artifact.files.length) {
              const a = rd.artifact
              try {
                const existing = await db.awonArtifact.findFirst({
                  where: { sessionId },
                  orderBy: { createdAt: 'desc' },
                })
                if (existing) {
                  const prev = JSON.parse(existing.files) as { path: string; content: string }[]
                  const map = new Map(prev.map((f) => [f.path, f.content]))
                  for (const f of a.files) map.set(f.path, f.content)
                  const mergedJson = JSON.stringify([...map.entries()].map(([p, content]) => ({ path: p, content })))
                  await db.awonArtifact.update({
                    where: { id: existing.id },
                    data: {
                      files: mergedJson,
                      entry: String(a.entry ?? existing.entry),
                      score: typeof rd.score === 'number' ? Math.max(0, Math.min(10, Math.round(rd.score))) : existing.score,
                      review: typeof rd.review === 'string' ? rd.review.slice(0, 4000) : existing.review,
                    },
                  })
                  await snapshotArtifactVersion(existing.id, mergedJson, 'adversarial regeneration')
                  try {
                    writeArtifactFiles(existing.id, a.files)
                  } catch {}
                  deliveredArtifactId = existing.id
                  regenArtifact = true
                  emit({
                    type: 'artifact',
                    id: existing.id,
                    name: existing.name,
                    entry: String(a.entry ?? existing.entry),
                    files: [...map.keys()],
                  })
                }
              } catch {
                break
              }
            }
            const scoreGiven = typeof rd.score === 'number'
            if (scoreGiven && (rd.score as number) >= 10) break
            if (regen === 0 && (regenArtifact || scoreGiven)) {
              chat.push({
                role: 'user',
                content:
                  scoreGiven && (rd.score as number) >= 10
                    ? 'Regeneration accepted.'
                    : 'Continue: fix every remaining deduction, deliver only changed files, then set the final honest score.',
              })
              continue
            }
            break
          }

          // critique-only re-check after regeneration (bounded; screenshots are
          // re-captured on demand via /verify, not twice inside one turn)
          if (!stopped() && deliveredArtifactId) {
            try {
              const updated = await db.awonArtifact.findUnique({
                where: { id: deliveredArtifactId },
                select: { files: true, score: true },
              })
              if (updated) {
                const re = await verifyCritique(sessionId, deliveredArtifactId, result.runId, userText, updated.files, updated.score, [])
                emit({
                  type: 'verify',
                  kind: 'critique',
                  status: re.critique.status === 'ok' ? (re.disagree ? 'partial' : 'pass') : 'unverified',
                  summary:
                    re.critique.status === 'ok'
                      ? `post-regeneration: critic ${re.critique.score}/10 vs builder ${re.builderScore ?? '?'}/10 (honest ${re.honestScore})`
                      : re.critique.summary,
                  data: re,
                })
              }
            } catch {}
          }
        }
      }
    } catch (ve) {
      // verification is a receipt generator, never a turn killer
      emit({ type: 'error', message: `verification pipeline error: ${(ve as Error).message.slice(0, 160)}` })
    }
  }

  emit({ type: 'done' })
}
