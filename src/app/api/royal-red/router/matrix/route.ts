import { NextRequest, NextResponse } from 'next/server'
import { PROVIDERS, matrixCounts, REGISTRY_VERSION } from '@/server/royal-red/providers/registry'
import { resolveApiKey } from '@/server/royal-red/providers/creds'
import { breakerSnapshot, probeAll } from '@/server/royal-red/providers/health'
import { costSummary, recentCosts } from '@/server/royal-red/router/ledger'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/router/matrix?probe=1 — the PROVIDERS panel feed:
// full matrix, health (measured when probe=1), breaker states, ledger tail.
export async function GET(req: NextRequest) {
  const probe = req.nextUrl.searchParams.get('probe') === '1'
  const keys = new Map<string, string | null>()
  for (const p of PROVIDERS) keys.set(p.id, p.requiresKey ? await resolveApiKey(p) : null)

  const health = probe ? await probeAll(PROVIDERS, keys) : {}

  const counts = matrixCounts()
  const summary = await costSummary()
  const recent = await recentCosts(25)

  return NextResponse.json({
    registryVersion: REGISTRY_VERSION,
    counts,
    routes: {
      definition: counts.providers,
      perProduct18: counts.providers * 18,
      note: 'route = provider × modality × product binding; 42-product total projected at ' + counts.providers * 42,
    },
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      protocol: p.protocol,
      modalities: p.modalities,
      tier: p.tier,
      local: p.local,
      model: p.model,
      cost: p.cost,
      priceNote: p.priceNote,
      requiresKey: p.requiresKey,
      keyConfigured: p.requiresKey ? !!keys.get(p.id) : null,
      adapterReady: p.protocol !== 'none',
      supportsTools: p.supportsTools ?? false,
    })),
    health,
    breaker: breakerSnapshot(),
    ledger: { summary, recent },
  })
}
