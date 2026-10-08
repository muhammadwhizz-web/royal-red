import { NextRequest, NextResponse } from 'next/server'
import { unifiedRegistry, executeUnified } from '@/server/royal-red/tools/unified'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/tools — the unified tool registry: every tool from every
// source (native, connector, MCP, skill) with its permission tier.
export async function GET() {
  const tools = await unifiedRegistry()
  const bySource: Record<string, number> = {}
  const byTier: Record<string, number> = {}
  for (const t of tools) {
    bySource[t.source] = (bySource[t.source] ?? 0) + 1
    byTier[t.permission] = (byTier[t.permission] ?? 0) + 1
  }
  return NextResponse.json({ counts: { total: tools.length, bySource, byTier }, tools })
}

// POST /api/royal-red/tools — execute any tool through the unified layer.
// Body: { source, sourceId, tool, args?, confirm? }. Destructive tools need
// confirm: true (per-action consent). Every call is audited.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { source?: string; sourceId?: string; tool?: string; args?: Record<string, unknown>; confirm?: boolean }
    | null
  if (!body?.source || !body.tool) {
    return NextResponse.json({ error: 'body must be { source, sourceId?, tool, args?, confirm? }' }, { status: 400 })
  }
  const result = await executeUnified({
    source: body.source as 'native' | 'connector' | 'mcp' | 'skill',
    sourceId: body.sourceId ?? 'native',
    tool: body.tool,
    args: body.args ?? {},
    confirm: body.confirm === true,
    actor: 'Settings',
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
