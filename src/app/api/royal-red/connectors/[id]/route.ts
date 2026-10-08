import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CONNECTOR_CATALOG } from '@/server/royal-red/connectors/catalog'
import { encryptSecret, maskKey } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

// PATCH /api/royal-red/connectors/:id — edit config, replace credential, or
// disconnect. Body: { cred?, config?, disconnect?: true }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const def = CONNECTOR_CATALOG.find((c) => c.id === id)
  if (!def) return NextResponse.json({ error: 'unknown connector' }, { status: 404 })
  const row = await db.royalRedConnector.findUnique({ where: { connectorId: id } })
  if (!row) return NextResponse.json({ error: 'connector is not set up yet' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { cred?: string; config?: Record<string, string>; disconnect?: boolean } | null
  const data: Record<string, unknown> = {}
  if (body?.disconnect) {
    data.credEnc = null
    data.credHint = null
    data.status = 'not_connected'
    data.lastError = null
    await db.royalRedConnector.update({ where: { connectorId: id }, data })
    await db.royalRedAudit.create({ data: { action: 'connector.disconnected', detail: `${def.label} (${id}) credential removed`, ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true, status: 'not_connected' })
  }
  if (typeof body?.cred === 'string' && body.cred.trim()) {
    data.credEnc = encryptSecret(body.cred.trim())
    data.credHint = maskKey(body.cred.trim())
    data.status = 'pending'
    data.lastError = null
  }
  if (body?.config) data.configJson = JSON.stringify(body.config)
  await db.royalRedConnector.update({ where: { connectorId: id }, data })
  await db.royalRedAudit.create({ data: { action: 'connector.updated', detail: `${def.label} (${id}) ${Object.keys(data).join(', ') || 'no-op'}`, ok: true, agentRole: 'Settings' } }).catch(() => {})
  const updated = await db.royalRedConnector.findUnique({ where: { connectorId: id } })
  return NextResponse.json({ ok: true, status: updated?.status ?? 'pending', credHint: updated?.credHint ?? null })
}

// DELETE /api/royal-red/connectors/:id — same as disconnect (kept for symmetry
// with the directive's connector lifecycle).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.royalRedConnector.updateMany({ where: { connectorId: id }, data: { credEnc: null, credHint: null, status: 'not_connected', lastError: null } })
  await db.royalRedAudit.create({ data: { action: 'connector.disconnected', detail: `${id} disconnected via DELETE`, ok: true, agentRole: 'Settings' } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
