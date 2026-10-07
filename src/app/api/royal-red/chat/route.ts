import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { runRoyalRedTurn, generateSessionTitle } from '@/server/royal-red/agent'
import { isMode, type RoyalRedSseEvent, type RoyalRedMode } from '@/lib/royal-red/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; message?: string; mode?: string }
    | null

  const message = body?.message?.trim()
  if (!message) {
    return Response.json({ error: 'message required' }, { status: 400 })
  }
  const mode: RoyalRedMode = body?.mode && isMode(body.mode) ? body.mode : 'ask'

  let sessionId = body?.sessionId
  if (sessionId) {
    const exists = await db.royalRedSession.findUnique({ where: { id: sessionId }, select: { id: true } })
    if (!exists) sessionId = undefined
  }
  // first turn of a brand-new session gets an auto-generated title later
  const isNewSession = !sessionId
  if (!sessionId) {
    const created = await db.royalRedSession.create({
      data: { title: message.slice(0, 70), mode },
    })
    sessionId = created.id
  }

  await db.royalRedMessage.create({
    data: { sessionId, role: 'user', content: message },
  })
  await db.royalRedSession.update({
    where: { id: sessionId },
    data: { mode, updatedAt: new Date() },
  })

  const encoder = new TextEncoder()
  const sid = sessionId

  // ABORT BRIDGE: client disconnects (stop button, tab close, cancelled reader)
  // must end the loop server side. req.signal alone does not fire reliably for
  // cancelled streams in every runtime, so the turn runs on its OWN controller
  // that is aborted by BOTH req.signal and the stream's cancel() path.
  const turnAbort = new AbortController()
  const abortTurn = () => {
    if (!turnAbort.signal.aborted) turnAbort.abort()
  }
  if (req.signal.aborted) abortTurn()
  else req.signal.addEventListener('abort', abortTurn, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let lastSay = ''
      const emit = (e: RoyalRedSseEvent) => {
        if (closed) return
        if (e.type === 'say') lastSay = e.text
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        } catch {
          closed = true
        }
      }
      emit({ type: 'session', id: sid, title: message.slice(0, 70) })
      try {
        // the loop honors the bridge signal: client disconnects stop iterations
        await runRoyalRedTurn({ sessionId: sid, userText: message, requestedMode: mode, emit, signal: turnAbort.signal })
        // first turn of a new session: replace the raw command-slice title with
        // a generated one; runs after 'done' so the UI is already responsive
        if (isNewSession && !turnAbort.signal.aborted) {
          const title = await generateSessionTitle(message, lastSay)
          if (title) {
            await db.royalRedSession.update({ where: { id: sid }, data: { title } }).catch(() => null)
            emit({ type: 'session', id: sid, title })
          }
        }
      } catch (e) {
        emit({ type: 'error', message: (e as Error).message })
        emit({ type: 'done' })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {}
      }
    },
    // reader.cancel() (stop button, tab close, fetch abort) also lands here
    cancel() {
      abortTurn()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
