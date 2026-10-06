import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { runAwonTurn, generateSessionTitle } from '@/server/awon/agent'
import { isMode, type AwonSseEvent, type AwonMode } from '@/lib/awon/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; message?: string; mode?: string }
    | null

  const message = body?.message?.trim()
  if (!message) {
    return Response.json({ error: 'message required' }, { status: 400 })
  }
  const mode: AwonMode = body?.mode && isMode(body.mode) ? body.mode : 'ask'

  let sessionId = body?.sessionId
  if (sessionId) {
    const exists = await db.awonSession.findUnique({ where: { id: sessionId }, select: { id: true } })
    if (!exists) sessionId = undefined
  }
  // first turn of a brand-new session gets an auto-generated title later
  const isNewSession = !sessionId
  if (!sessionId) {
    const created = await db.awonSession.create({
      data: { title: message.slice(0, 70), mode },
    })
    sessionId = created.id
  }

  await db.awonMessage.create({
    data: { sessionId, role: 'user', content: message },
  })
  await db.awonSession.update({
    where: { id: sessionId },
    data: { mode, updatedAt: new Date() },
  })

  const encoder = new TextEncoder()
  const sid = sessionId

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let lastSay = ''
      const emit = (e: AwonSseEvent) => {
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
        // req.signal aborts when the client disconnects (stop button, tab close),
        // which ends the agent loop server side instead of burning iterations
        await runAwonTurn({ sessionId: sid, userText: message, requestedMode: mode, emit, signal: req.signal })
        // first turn of a new session: replace the raw command-slice title with
        // a generated one; runs after 'done' so the UI is already responsive
        if (isNewSession && !req.signal.aborted) {
          const title = await generateSessionTitle(message, lastSay)
          if (title) {
            await db.awonSession.update({ where: { id: sid }, data: { title } }).catch(() => null)
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
