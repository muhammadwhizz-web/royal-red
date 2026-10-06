// POST /api/awon/desktop/abort - THE KILL SWITCH.
// One command, no args needed: stops the action queue (checked before every
// step), SIGTERMs every supervised child (box exec, Xvfb), freezes every
// pending consent forever, marks running runs aborted, writes an audit row.
// The kill switch is intentionally un-gated: the human does not ask the
// machine for permission to stop the machine.
import { NextRequest } from 'next/server'
import { triggerAbort } from '@/server/awon/box/ops'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; reason?: string }
  const res = await triggerAbort(body?.sessionId, body?.reason ?? 'kill switch pressed on the DESKTOP panel')
  return Response.json({ ok: true, ...res })
}
