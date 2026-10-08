import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { executeUnified } from '@/server/royal-red/tools/unified'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/mcp/:id/call — call a tool, read a resource or fetch a
// prompt through the unified execution layer.
// Body: { tool, args?, confirm? } | { resource: uri } | { prompt: name }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedMcpServer.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as
    | { tool?: string; args?: Record<string, unknown>; confirm?: boolean; resource?: string; prompt?: string }
    | null
  if (!body) return NextResponse.json({ error: 'empty body' }, { status: 400 })

  const tool = body.resource ? `resource:${body.resource}` : body.prompt ? `prompt:${body.prompt}` : body.tool
  if (!tool) return NextResponse.json({ error: 'provide tool, resource or prompt' }, { status: 400 })

  const result = await executeUnified({
    source: 'mcp',
    sourceId: row.name,
    tool,
    args: body.args ?? {},
    confirm: body.confirm === true,
    actor: 'Settings',
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
