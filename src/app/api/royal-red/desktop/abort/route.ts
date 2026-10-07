// POST /api/royal-red/desktop/abort - THE KILL SWITCH.
// Three modes (Round 4 contract) + the pause verb:
//   body {reason}            -> GLOBAL kill switch (unchanged): stops the
//                               action queue (checked before every step),
//                               SIGTERMs every supervised child (box exec,
//                               Xvfb), freezes every pending consent forever,
//                               marks ALL running runs aborted, writes an
//                               audit row. Intentionally un-gated: the human
//                               does not ask the machine for permission to
//                               stop the machine.
//   body {runId, reason}     -> SINGLE-RUN abort (run-queue scalpel): aborts
//                               exactly one run/sub-agent; siblings, consents
//                               and the global refuse window are untouched.
//   body {mode:'pause'}      -> PAUSE the session: the loop freezes at the
//                               next step/phase boundary; state fully kept
//                               (runs stay running, consents stay pending,
//                               journals intact). A user action only — the
//                               model cannot pause itself. Audited.
//   body {mode:'resume'}     -> RESUME the paused session; runs continue
//                               where they froze. Audited.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { triggerAbort } from '@/server/royal-red/box/ops'
import { abortOneRun } from '@/server/royal-red/runqueue'
import { pauseSession, resumeSession } from '@/server/royal-red/pause-state'
import { appendEvent } from '@/server/royal-red/event-log'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; runId?: string; reason?: string; mode?: string }

  if (body?.mode === 'pause') {
    const sessionId = body.sessionId
    if (!sessionId) return Response.json({ ok: false, error: 'sessionId required for pause' }, { status: 400 })
    const created = pauseSession(sessionId)
    await appendEvent({ sessionId, type: 'session/paused', payload: { by: 'user', alreadyPaused: !created } })
    await db.royalRedAudit.create({
      data: { action: 'desktop.pause', detail: created ? `session ${sessionId} paused by the user; state kept, runs frozen at next boundary` : `session ${sessionId} was already paused`, ok: created },
    })
    return Response.json({ ok: created, mode: 'pause', error: created ? undefined : 'already paused' })
  }

  if (body?.mode === 'resume') {
    const sessionId = body.sessionId
    if (!sessionId) return Response.json({ ok: false, error: 'sessionId required for resume' }, { status: 400 })
    const lifted = resumeSession(sessionId)
    await appendEvent({ sessionId, type: 'session/resumed', payload: { by: 'user', wasPaused: lifted } })
    await db.royalRedAudit.create({
      data: { action: 'desktop.resume', detail: lifted ? `session ${sessionId} resumed by the user; runs continue where they froze` : `session ${sessionId} was not paused`, ok: lifted },
    })
    return Response.json({ ok: lifted, mode: 'resume', error: lifted ? undefined : 'not paused' })
  }

  if (body?.runId) {
    const r = await abortOneRun(body.runId, body?.reason ?? 'single-run abort requested on the DESKTOP panel')
    if (!r.existed) return Response.json({ ok: false, error: `no run ${body.runId}` }, { status: 404 })
    return Response.json({ ok: true, mode: 'single', runId: body.runId, alreadyFinished: r.alreadyFinished ?? false })
  }
  const res = await triggerAbort(body?.sessionId, body?.reason ?? 'kill switch pressed on the DESKTOP panel')
  return Response.json({ ok: true, mode: 'global', ...res })
}
