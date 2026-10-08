import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findProvider } from '@/server/royal-red/providers/matrix'
import { resolveApiKey, invalidateKeyCache } from '@/server/royal-red/providers/creds'
import { probeProvider } from '@/server/royal-red/providers/health'
import { recordProbe, getKeyRow } from '@/server/royal-red/providers/keys'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/providers/:id/test — run the health probe NOW and
// persist the outcome. Returns { ok, latencyMs, state, error? }.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await findProvider(id)
  if (!p) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
  invalidateKeyCache()
  const key = p.requiresKey ? await resolveApiKey(p) : null
  const rec = await probeProvider(p, key, true)
  const ok = rec.state === 'reachable'
  const error = ok ? null : (rec.detail ?? `probe state: ${rec.state}`)
  await recordProbe(id, ok, rec.latencyMs, error)
  await db.royalRedAudit.create({
    data: {
      action: 'provider.probe',
      detail: `${p.label} (${id}) probe=${rec.state} latency=${rec.latencyMs ?? 'n/a'}ms`,
      ok,
      agentRole: 'Settings',
    },
  }).catch(() => {})
  const krow = await getKeyRow(id)
  return NextResponse.json({
    ok,
    latencyMs: rec.latencyMs,
    state: rec.state,
    error,
    keyConfigured: p.requiresKey ? !!key : true,
    lastProbeAt: krow?.lastProbeAt ?? null,
  })
}
