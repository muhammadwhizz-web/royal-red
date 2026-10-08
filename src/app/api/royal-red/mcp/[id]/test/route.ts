import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { connectAndList } from '@/server/royal-red/mcp/client'
import { decryptSecret } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/mcp/:id/test — connect for real: initialize handshake,
// then tools/list + resources/list + prompts/list. The discovered manifests are
// persisted on the row (they become the unified tool registry entries).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedMcpServer.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  if (!row.enabled) return NextResponse.json({ error: 'server is disabled: enable it first' }, { status: 400 })

  const token = row.tokenEnc ? decryptSecret(row.tokenEnc) ?? undefined : undefined
  const spec = {
    type: row.type as 'stdio' | 'http' | 'ws',
    command: row.command ?? undefined,
    args: row.argsJson ? (JSON.parse(row.argsJson) as string[]) : undefined,
    env: row.envJson ? (JSON.parse(row.envJson) as Record<string, string>) : undefined,
    url: row.url ?? undefined,
    token,
    timeoutMs: 20_000,
  }

  const result = await connectAndList(spec)
  const status = result.ok ? 'connected' : 'error'
  await db.royalRedMcpServer.update({
    where: { id },
    data: {
      status,
      lastConnectedAt: result.ok ? new Date() : row.lastConnectedAt,
      lastError: result.ok ? null : (result.error ?? 'connection failed'),
      toolsJson: result.ok && result.manifest ? JSON.stringify(result.manifest.tools) : row.toolsJson,
      resourcesJson: result.ok && result.manifest ? JSON.stringify(result.manifest.resources) : row.resourcesJson,
      promptsJson: result.ok && result.manifest ? JSON.stringify(result.manifest.prompts) : row.promptsJson,
    },
  })
  await db.royalRedAudit.create({
    data: { action: 'mcp.server.test', detail: `${row.name}: ${result.ok ? `connected, ${result.manifest?.tools.length ?? 0} tools` : (result.error ?? 'failed').slice(0, 160)}`, ok: result.ok, agentRole: 'Settings' },
  }).catch(() => {})

  return NextResponse.json({
    ok: result.ok,
    latencyMs: result.latencyMs,
    status,
    error: result.error,
    tools: result.manifest?.tools ?? [],
    resources: result.manifest?.resources ?? [],
    prompts: result.manifest?.prompts ?? [],
    serverInfo: result.manifest?.serverInfo ?? null,
  })
}
