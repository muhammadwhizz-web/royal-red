import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CONNECTOR_CATALOG, BUILT_COUNT } from '@/server/royal-red/connectors/catalog'
import { toolsForConnector } from '@/server/royal-red/connectors/tools'
import { encryptSecret, maskKey } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/connectors — catalog (60) joined with stored state.
// The credential NEVER appears: only credHint and status.
export async function GET() {
  const rows = await db.royalRedConnector.findMany()
  const byId = new Map(rows.map((r) => [r.connectorId, r]))
  return NextResponse.json({
    counts: { total: CONNECTOR_CATALOG.length, built: BUILT_COUNT, connected: rows.filter((r) => r.status === 'connected').length },
    connectors: CONNECTOR_CATALOG.map((c) => {
      const r = byId.get(c.id)
      return {
        id: c.id,
        label: c.label,
        category: c.category,
        authType: c.authType,
        baseUrl: c.baseUrl,
        docsUrl: c.docsUrl,
        keyFormat: c.keyFormat,
        built: c.built,
        status: r?.status ?? 'not_connected',
        credHint: r?.credHint ?? null,
        config: r?.configJson ? JSON.parse(r.configJson) : null,
        lastCheckAt: r?.lastCheckAt ?? null,
        lastUsedAt: r?.lastUsedAt ?? null,
        lastError: r?.lastError ?? null,
        toolCount: toolsForConnector(c.id).length,
      }
    }),
  })
}

// POST /api/royal-red/connectors — connect or update: { connectorId, cred?, config? }.
// The credential is AES-256-GCM encrypted; the row flips to pending until a
// test confirms it.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { connectorId?: string; cred?: string; config?: Record<string, string> }
    | null
  const def = CONNECTOR_CATALOG.find((c) => c.id === body?.connectorId)
  if (!def) return NextResponse.json({ error: 'unknown connectorId' }, { status: 400 })
  const cred = typeof body?.cred === 'string' ? body.cred.trim() : ''
  const config = body?.config && typeof body.config === 'object' ? body.config : undefined

  const data: { label: string; authType: string; credEnc?: string; credHint?: string; status?: string; lastError?: string | null; configJson?: string } = { label: def.label, authType: def.authType }
  if (cred) {
    if (cred.length < 4) return NextResponse.json({ error: 'credential looks too short to be valid' }, { status: 400 })
    data.credEnc = encryptSecret(cred)
    data.credHint = maskKey(cred)
    data.status = 'pending'
    data.lastError = null
  }
  if (config) data.configJson = JSON.stringify(config)

  await db.royalRedConnector.upsert({
    where: { connectorId: def.id },
    update: data,
    create: { connectorId: def.id, ...data },
  })
  await db.royalRedAudit.create({
    data: { action: 'connector.connected', detail: `${def.label} (${def.id}) credential stored (encrypted), awaiting test`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: true, connectorId: def.id, status: 'pending' })
}
