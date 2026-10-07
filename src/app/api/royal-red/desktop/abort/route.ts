// POST /api/royal-red/desktop/abort - THE KILL SWITCH.
// Two modes:
//   body {reason}            -> GLOBAL kill switch (unchanged): stops the
//                               action queue (checked before every step),
//                               SIGTERMs every supervised child (box exec,
//                               Xvfb), freezes every pending consent forever,
//                               marks ALL running runs aborted, writes an
//                               audit row. Intentionally un-gated: the human
//                               does not ask the machine for permission to
//                               stop the machine.
//   body {runId, reason}     -> SINGLE-RUN abort (run-queue scalpel, Round 3):
//                               aborts exactly one run; siblings, consents and
//                               the global refuse window are untouched.
import { NextRequest } from 'next/server'
import { triggerAbort } from '@/server/royal-red/box/ops'
import { abortOneRun } from '@/server/royal-red/runqueue'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; runId?: string; reason?: string }
  if (body?.runId) {
    const r = await abortOneRun(body.runId, body?.reason ?? 'single-run abort requested on the DESKTOP panel')
    if (!r.existed) return Response.json({ ok: false, error: `no run ${body.runId}` }, { status: 404 })
    return Response.json({ ok: true, mode: 'single', runId: body.runId, alreadyFinished: r.alreadyFinished ?? false })
  }
  const res = await triggerAbort(body?.sessionId, body?.reason ?? 'kill switch pressed on the DESKTOP panel')
  return Response.json({ ok: true, mode: 'global', ...res })
}
