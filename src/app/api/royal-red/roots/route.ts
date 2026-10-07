// ROYAL RED sandbox roots API (harness port #4) — the inspection surface for
// what each sandbox scope exposes. Every grant is visible here with its
// canonical resolution; nothing about the box exposure is implicit.
import { NextRequest, NextResponse } from 'next/server'
import { describeScopes, setScopeRoots, clearScopeRoots, defaultSpec, writableRoots, canonicalPath } from '@/server/royal-red/box/roots'
import { BOX_HOME } from '@/server/royal-red/box/prison'
import { appendEvent } from '@/server/royal-red/event-log'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ws = canonicalPath(BOX_HOME)
  return NextResponse.json({
    defaultSpec: defaultSpec(ws),
    defaultWritableRoots: writableRoots(defaultSpec(ws)),
    registeredScopes: describeScopes(),
    note: 'a missing root resolves to its spelling (matches nothing) — never silently invented; the path prison remains the sole enforcement layer',
  })
}

// declare per-scope exposure (per-run / per-mode / per-session) — Phase 5
// multi-agent foundation. Grants outside the box root are rejected, not
// canonicalized into existence.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId?: string
      runId?: string
      mode?: string
      sandboxMode?: 'read-only' | 'workspace-write'
      grants?: { path: string; mode: 'rw' | 'ro'; label: string }[]
    }
    if (!body.sessionId && !body.runId && !body.mode) {
      return NextResponse.json({ error: 'scope required: sessionId, runId, or mode' }, { status: 400 })
    }
    const ws = canonicalPath(BOX_HOME)
    const grants = (body.grants ?? []).filter((g) => g.path.startsWith(ws))
    const rejected = (body.grants ?? []).filter((g) => !g.path.startsWith(ws))
    const spec = { mode: body.sandboxMode ?? 'workspace-write', workspaceRoot: ws, grants }
    const scope = { sessionId: body.sessionId, runId: body.runId, mode: body.mode }
    const result = setScopeRoots(scope, spec)
    if (body.sessionId) {
      void appendEvent({
        sessionId: body.sessionId,
        runId: body.runId ?? null,
        type: 'sandbox/mode',
        payload: { scope, mode: spec.mode, writableRoots: result.writableRoots, rejectedOutsideBox: rejected.length },
      })
    }
    return NextResponse.json({ ok: true, ...result, rejectedGrantsOutsideBox: rejected })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined
  const runId = req.nextUrl.searchParams.get('runId') ?? undefined
  const mode = req.nextUrl.searchParams.get('mode') ?? undefined
  const removed = clearScopeRoots({ sessionId, runId, mode })
  return NextResponse.json({ ok: true, removed })
}
