import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CONNECTOR_CATALOG } from '@/server/royal-red/connectors/catalog'
import { connectorHealth } from '@/server/royal-red/connectors/tools'
import { decryptSecret } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/connectors/:id/test — run the real health check against
// the stored (decrypted) credential and persist the outcome.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const def = CONNECTOR_CATALOG.find((c) => c.id === id)
  if (!def) return NextResponse.json({ error: 'unknown connector' }, { status: 404 })
  const row = await db.royalRedConnector.findUnique({ where: { connectorId: id } })
  if (!row?.credEnc) {
    await db.royalRedConnector.upsert({
      where: { connectorId: id },
      update: { status: 'not_connected', lastCheckAt: new Date(), lastError: 'no credential stored' },
      create: { connectorId: id, label: def.label, authType: def.authType, status: 'not_connected', lastCheckAt: new Date(), lastError: 'no credential stored' },
    })
    return NextResponse.json({ ok: false, error: 'no credential stored: connect first' }, { status: 400 })
  }
  const cred = decryptSecret(row.credEnc) ?? ''
  const config = row.configJson ? (JSON.parse(row.configJson) as Record<string, string>) : {}
  const started = Date.now()
  const result = await connectorHealth(id, cred, config)
  const status = result.ok ? 'connected' : 'error'
  await db.royalRedConnector.update({
    where: { connectorId: id },
    data: { status, lastCheckAt: new Date(), lastError: result.ok ? null : (result.error ?? 'health check failed') },
  })
  await db.royalRedAudit.create({
    data: { action: 'connector.test', detail: `${def.label} (${id}) ${result.ok ? 'healthy' : 'failed'} ${result.latencyMs}ms ${result.error?.slice(0, 120) ?? ''}`, ok: result.ok, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: result.ok, latencyMs: result.latencyMs ?? Date.now() - started, status, error: result.error })
}
