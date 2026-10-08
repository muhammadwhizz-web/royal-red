import { NextResponse } from 'next/server'
import { findProvider } from '@/server/royal-red/providers/matrix'
import { resolveApiKey } from '@/server/royal-red/providers/creds'
import { healthSnapshot } from '@/server/royal-red/providers/health'
import { getKeyRow } from '@/server/royal-red/providers/keys'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/providers/:id — one provider's details. The key itself is
// NEVER included: masked hint and status flags only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await findProvider(id)
  if (!p) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
  const key = p.requiresKey ? await resolveApiKey(p) : null
  const krow = await getKeyRow(id)
  const health = healthSnapshot()[id]
  return NextResponse.json({
    id: p.id,
    label: p.label,
    protocol: p.protocol,
    modalities: p.modalities,
    tier: p.tier,
    local: p.local,
    baseUrl: p.baseUrl,
    baseUrlOverride: krow?.baseUrl ?? null,
    model: krow?.model || p.model,
    defaultModel: p.model,
    cost: p.cost,
    priceNote: p.priceNote,
    endpointNote: p.endpointNote,
    freeTier: p.freeTier ?? false,
    region: p.region ?? 'any',
    requiresKey: p.requiresKey,
    supportsTools: p.supportsTools ?? false,
    supportsStreaming: p.supportsStreaming ?? false,
    keyConfigured: p.requiresKey ? !!key : null,
    keyHint: krow?.keyHint ?? null,
    orgId: krow?.orgId ?? null,
    headersJson: krow?.headersJson ?? null,
    disabled: krow?.disabled ?? false,
    health: health?.state ?? 'not-probed',
    healthLatencyMs: health?.latencyMs ?? null,
    healthDetail: health?.detail ?? null,
    lastError: krow?.lastError ?? null,
    successCount: krow?.successCount ?? 0,
    failureCount: krow?.failureCount ?? 0,
    avgLatencyMs: krow?.avgLatencyMs ?? 0,
    lastProbeAt: krow?.lastProbeAt ?? null,
  })
}
