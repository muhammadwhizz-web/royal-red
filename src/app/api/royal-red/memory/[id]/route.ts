// ROYAL RED memory API, per-id mutations (Round 6, Section 2.5):
// PATCH  /api/royal-red/memory/:id -> edit value/key/tags/scope/expiry, or
//                                     promote/demote (scope move keeps the key)
// DELETE /api/royal-red/memory/:id -> forget
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { auditMemory, MEMORY_SCOPES, type MemoryScope } from '@/server/royal-red/memory'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as
    | { key?: string; value?: string; tags?: string[] | string; scope?: string; scopeRef?: string; confidence?: number; expiresAt?: string | null; promote?: boolean; demote?: boolean }
    | null

  const existing = await db.royalRedMemory.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'memory not found' }, { status: 404 })

  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t) => t.toLowerCase().trim()).filter(Boolean).join(',')
    : typeof body?.tags === 'string'
      ? body.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).join(',')
      : existing.tags

  // promote: session -> project -> global. demote: global -> project -> session.
  // The ladder keeps memories honest: a promoted memory is visible everywhere.
  const ladder: MemoryScope[] = ['session', 'agent', 'project', 'global']
  let scope = existing.scope as MemoryScope
  let scopeRef = existing.scopeRef
  if (body?.promote || body?.demote) {
    const idx = ladder.indexOf(scope)
    const next = body.promote ? Math.min(ladder.length - 1, idx + 1) : Math.max(0, idx - 1)
    scope = ladder[next]
    scopeRef = scope === 'session' ? existing.scopeRef : '' // project/global carry no per-session ref in this build
  }
  if (body?.scope && (MEMORY_SCOPES as string[]).includes(body.scope)) {
    scope = body.scope as MemoryScope
    scopeRef = scope === 'global' ? '' : (body?.scopeRef ?? existing.scopeRef)
  }

  const expiresAt =
    body?.expiresAt === null ? null : body?.expiresAt ? new Date(body.expiresAt) : existing.expiresAt
  if (body?.expiresAt && expiresAt && Number.isNaN(expiresAt.getTime())) {
    return Response.json({ error: 'expiresAt invalid' }, { status: 400 })
  }

  const row = await db.royalRedMemory.update({
    where: { id },
    data: {
      key: body?.key?.trim().slice(0, 80) ?? existing.key,
      value: body?.value?.trim().slice(0, 2000) ?? existing.value,
      tags: tags ?? null,
      scope,
      scopeRef,
      confidence:
        typeof body?.confidence === 'number' ? Math.min(1, Math.max(0, body.confidence)) : existing.confidence,
      expiresAt,
    },
  })
  await auditMemory(body?.promote ? 'memory:promote' : body?.demote ? 'memory:demote' : 'memory:edit', `${scope}/${row.key}`)
  return Response.json({ ok: true, id: row.id })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const existing = await db.royalRedMemory.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'memory not found' }, { status: 404 })
  await db.royalRedMemory.delete({ where: { id } })
  await auditMemory('memory:forget', `${existing.scope}/${existing.key}`)
  return Response.json({ ok: true })
}
