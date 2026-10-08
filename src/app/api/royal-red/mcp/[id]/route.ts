import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encryptSecret } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

// PATCH /api/royal-red/mcp/:id — edit config or flip enabled.
// Body: { label?, command?, args?, env?, url?, token?, enabled? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedMcpServer.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as
    | { label?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; token?: string; enabled?: boolean }
    | null
  const data: Record<string, unknown> = {}
  if (typeof body?.label === 'string') data.label = body.label.slice(0, 80)
  if (typeof body?.command === 'string') data.command = body.command
  if (Array.isArray(body?.args)) data.argsJson = JSON.stringify(body.args.map((a) => String(a).slice(0, 300)))
  if (body?.env && typeof body.env === 'object') data.envJson = JSON.stringify(body.env)
  if (typeof body?.url === 'string') data.url = body.url
  if (typeof body?.token === 'string' && body.token.trim()) data.tokenEnc = encryptSecret(body.token.trim())
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  await db.royalRedMcpServer.update({ where: { id }, data })
  await db.royalRedAudit.create({
    data: { action: typeof body?.enabled === 'boolean' ? (body.enabled ? 'mcp.server.enabled' : 'mcp.server.disabled') : 'mcp.server.updated', detail: `${row.name}: ${Object.keys(data).join(', ') || 'no-op'}`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}

// DELETE /api/royal-red/mcp/:id — remove the server row
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedMcpServer.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  await db.royalRedMcpServer.delete({ where: { id } })
  await db.royalRedAudit.create({ data: { action: 'mcp.server.removed', detail: `${row.name} removed`, ok: true, agentRole: 'Settings' } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
