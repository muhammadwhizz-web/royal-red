// ROYAL RED memory API (Round 6, Section 2.5). All mutations are audit-logged.
// GET  /api/royal-red/memory?scope=global&q=theme  -> list (search + filter)
// POST /api/royal-red/memory                        -> write (upsert by scope+key)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { auditMemory, MEMORY_SCOPES, type MemoryScope } from '@/server/royal-red/memory'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
  const sessionId = url.searchParams.get('sessionId') ?? ''

  const where: Record<string, unknown> = {}
  if (scope && (MEMORY_SCOPES as string[]).includes(scope)) where.scope = scope
  const rows = await db.royalRedMemory.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
    take: 500,
  })

  const out = rows
    .filter((r) => {
      if (q && !`${r.key} ${r.value} ${r.tags ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      scopeRef: r.scopeRef,
      key: r.key,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
      tags: (r.tags ?? '').split(',').filter(Boolean),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      // a session-scoped row belonging to another session is shown but flagged
      foreign: r.scope === 'session' && r.scopeRef !== sessionId && r.scopeRef !== '',
    }))

  return Response.json({ memories: out, count: out.length })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { scope?: string; scopeRef?: string; key?: string; value?: string; source?: string; confidence?: number; tags?: string[] | string; expiresAt?: string | null }
    | null

  const key = body?.key?.trim()
  const value = body?.value?.trim()
  if (!key || !value) {
    return Response.json({ error: 'key and value required' }, { status: 400 })
  }
  const scope = (body?.scope && (MEMORY_SCOPES as string[]).includes(body.scope) ? body.scope : 'global') as MemoryScope
  if (scope !== 'global' && !body?.scopeRef) {
    return Response.json({ error: `scope ${scope} requires scopeRef` }, { status: 400 })
  }
  const tags = Array.isArray(body?.tags)
    ? body.tags
    : typeof body?.tags === 'string'
      ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
  const source = body?.source === 'agent' || body?.source === 'inferred' ? body.source : 'user'
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null
  if (body?.expiresAt && Number.isNaN(expiresAt!.getTime())) {
    return Response.json({ error: 'expiresAt invalid' }, { status: 400 })
  }

  const row = await db.royalRedMemory.upsert({
    where: { scope_scopeRef_key: { scope, scopeRef: scope === 'global' ? '' : body!.scopeRef!, key } },
    create: {
      scope,
      scopeRef: scope === 'global' ? '' : body!.scopeRef!,
      key: key.slice(0, 80),
      value: value.slice(0, 2000),
      source,
      confidence: typeof body?.confidence === 'number' ? Math.min(1, Math.max(0, body.confidence)) : 1,
      tags: tags.join(',') || null,
      expiresAt,
    },
    update: {
      value: value.slice(0, 2000),
      source,
      confidence: typeof body?.confidence === 'number' ? Math.min(1, Math.max(0, body.confidence)) : 1,
      tags: tags.join(',') || null,
      expiresAt,
    },
  })
  await auditMemory('memory:api-write', `${scope}/${key}`)
  return Response.json({ ok: true, id: row.id })
}
