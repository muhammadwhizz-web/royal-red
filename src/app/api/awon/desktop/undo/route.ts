// POST /api/awon/desktop/undo - undo a whole run from the DESKTOP panel.
// The inverse batch still gets its own Tier 2 consent card in chat.
import { NextRequest } from 'next/server'
import { undoRun } from '@/server/awon/box/ops'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string; runId?: string } | null
  if (!body?.sessionId || !body?.runId) {
    return Response.json({ error: 'sessionId and runId required' }, { status: 400 })
  }
  const noopEmit = () => {}
  const res = await undoRun(body.runId, body.sessionId, noopEmit, { userInitiated: true })
  return Response.json(res, { status: res.ok ? 200 : 409 })
}
