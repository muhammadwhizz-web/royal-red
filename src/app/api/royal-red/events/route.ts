// ROYAL RED event log API — the replay surface for the durable session log.
// GET ?sessionId=<id>&limit=<n> returns the ordered typed events plus the
// REPLAY PROJECTION (state folded from the log) and an integrity check
// (contiguous per-session seqs — a gap would mean the append-only discipline
// was violated, which this endpoint surfaces as ok:false).
import { NextRequest, NextResponse } from 'next/server'
import { readSessionEvents, replaySessionState, verifyLogIntegrity } from '@/server/royal-red/event-log'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '2000')
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 2000
  try {
    const events = await readSessionEvents(sessionId, limit)
    return NextResponse.json({
      sessionId,
      count: events.length,
      events,
      projection: replaySessionState(events),
      integrity: verifyLogIntegrity(events),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
