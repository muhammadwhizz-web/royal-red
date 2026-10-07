import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { WORKSPACE_ROOT } from '@/server/royal-red/workspace'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await db.royalRedSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
      artifacts: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      mode: session.mode,
      updatedAt: session.updatedAt,
    },
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      meta: m.meta ? JSON.parse(m.meta) : null,
      createdAt: m.createdAt,
    })),
    artifacts: session.artifacts.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      entry: a.entry,
      score: a.score,
      review: a.review,
      files: JSON.parse(a.files) as { path: string; content: string }[],
    })),
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as { title?: string; pinned?: boolean } | null
  const data: { title?: string; pinned?: boolean } = {}
  const title = body?.title?.trim().slice(0, 120)
  if (title) data.title = title
  if (typeof body?.pinned === 'boolean') data.pinned = body.pinned
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'title or pinned required' }, { status: 400 })
  }
  const updated = await db.royalRedSession.update({ where: { id }, data }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, title: updated.title, pinned: updated.pinned })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  // collect artifact ids first so the on-disk artifact dirs can be cleaned too
  const arts = await db.royalRedArtifact.findMany({ where: { sessionId: id }, select: { id: true } })
  await db.royalRedSession.delete({ where: { id } }).catch(() => null)
  const fs = await import('fs')
  const path = await import('path')
  for (const a of arts) {
    try {
      fs.rmSync(path.join(WORKSPACE_ROOT, 'artifacts', a.id), { recursive: true, force: true })
    } catch {}
  }
  await db.royalRedAudit.create({ data: { action: 'session.delete', detail: id, ok: true } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
