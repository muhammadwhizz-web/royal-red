import { NextRequest, NextResponse } from 'next/server'
import { CONNECTOR_CATALOG } from '@/server/royal-red/connectors/catalog'
import { toolsForConnector } from '@/server/royal-red/connectors/tools'
import { executeUnified } from '@/server/royal-red/tools/unified'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/connectors/:id/tools — the tool surface a connector exposes
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const def = CONNECTOR_CATALOG.find((c) => c.id === id)
  if (!def) return NextResponse.json({ error: 'unknown connector' }, { status: 404 })
  if (!def.built) {
    return NextResponse.json({ tools: [], note: 'connector not yet implemented: definition only' })
  }
  return NextResponse.json({
    tools: toolsForConnector(id).map((t) => ({ name: t.name, description: t.description, permission: t.permission, schema: t.schema })),
  })
}

// POST /api/royal-red/connectors/:id/tools — call one tool through the unified
// execution layer (consent gate + rate limit + audit). Destructive tools must
// carry confirm: true.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const def = CONNECTOR_CATALOG.find((c) => c.id === id)
  if (!def) return NextResponse.json({ error: 'unknown connector' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { tool?: string; args?: Record<string, unknown>; confirm?: boolean } | null
  if (!body?.tool) return NextResponse.json({ error: 'body must be { tool, args?, confirm? }' }, { status: 400 })
  const result = await executeUnified({
    source: 'connector',
    sourceId: id,
    tool: body.tool,
    args: body.args ?? {},
    confirm: body.confirm === true,
    actor: 'Settings',
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
