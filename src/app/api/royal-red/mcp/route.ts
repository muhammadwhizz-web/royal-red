import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MCP_CATALOG } from '@/server/royal-red/mcp/catalog'
import { encryptSecret } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mcp-server'
}

// GET /api/royal-red/mcp — installed servers + the default catalog
export async function GET() {
  const rows = await db.royalRedMcpServer.findMany({ orderBy: { createdAt: 'asc' } })
  const catalogIds = new Set(MCP_CATALOG.map((c) => c.id))
  return NextResponse.json({
    counts: { installed: rows.length, catalog: MCP_CATALOG.length, connected: rows.filter((r) => r.status === 'connected').length },
    servers: rows.map((s) => ({
      id: s.id,
      name: s.name,
      label: s.label,
      type: s.type,
      command: s.command,
      args: s.argsJson ? JSON.parse(s.argsJson) : null,
      env: s.envJson ? JSON.parse(s.envJson) : null,
      url: s.url,
      hasToken: !!s.tokenEnc,
      tokenHint: s.tokenEnc ? 'stored (encrypted)' : null,
      enabled: s.enabled,
      status: s.status,
      tools: s.toolsJson ? JSON.parse(s.toolsJson) : [],
      resources: s.resourcesJson ? JSON.parse(s.resourcesJson) : [],
      prompts: s.promptsJson ? JSON.parse(s.promptsJson) : [],
      lastConnectedAt: s.lastConnectedAt,
      lastError: s.lastError,
    })),
    catalog: MCP_CATALOG,
    catalogNote: 'one-click entries fill the add form; catalog ids that are already installed are marked on the client',
    catalogIds: [...catalogIds],
  })
}

// POST /api/royal-red/mcp — add a server: { name, label?, type, command?, args?, env?, url?, token? }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; label?: string; type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; token?: string }
    | null
  if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const type = ['stdio', 'http', 'ws'].includes(String(body.type)) ? String(body.type) : 'stdio'
  if (type === 'stdio' && !body.command) return NextResponse.json({ error: 'stdio servers need a command' }, { status: 400 })
  if (type !== 'stdio' && !body.url) return NextResponse.json({ error: 'http/ws servers need a url' }, { status: 400 })

  let name = slugify(body.name)
  const clash = await db.royalRedMcpServer.findUnique({ where: { name } })
  if (clash) name = `${name}-${Date.now().toString(36).slice(-4)}`

  const data: {
    name: string
    label: string
    type: string
    command: string | null
    argsJson: string | null
    envJson: string | null
    url: string | null
    tokenEnc?: string
  } = {
    name,
    label: (body.label ?? body.name).slice(0, 80),
    type,
    command: type === 'stdio' ? body.command : null,
    argsJson: body.args && body.args.length ? JSON.stringify(body.args.map((a) => String(a).slice(0, 300))) : null,
    envJson: body.env && Object.keys(body.env).length ? JSON.stringify(body.env) : null,
    url: type !== 'stdio' ? body.url : null,
  }
  if (typeof body.token === 'string' && body.token.trim()) {
    data.tokenEnc = encryptSecret(body.token.trim())
  }
  await db.royalRedMcpServer.create({ data })
  await db.royalRedAudit.create({
    data: { action: 'mcp.server.added', detail: `${name} (${type}) ${type === 'stdio' ? body.command : body.url}`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: true, name })
}
