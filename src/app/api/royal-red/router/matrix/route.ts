import { NextRequest, NextResponse } from 'next/server'
import { REGISTRY_VERSION } from '@/server/royal-red/providers/registry'
import { allProviders, countsOf } from '@/server/royal-red/providers/matrix'
import { resolveApiKey } from '@/server/royal-red/providers/creds'
import { breakerSnapshot, probeAll } from '@/server/royal-red/providers/health'
import { allKeyRows } from '@/server/royal-red/providers/keys'
import { costSummary, recentCosts } from '@/server/royal-red/router/ledger'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/router/matrix?probe=1 — legacy PROVIDERS panel feed,
// now backed by the same merged matrix (shipped 96 + custom) and key store as
// the Settings cockpit. Kept so existing surfaces do not break.
export async function GET(req: NextRequest) {
  const probe = req.nextUrl.searchParams.get('probe') === '1'
  const matrix = await allProviders()
  const keys = new Map<string, string | null>()
  for (const p of matrix) keys.set(p.id, p.requiresKey ? await resolveApiKey(p) : null)

  const health = probe ? await probeAll(matrix, keys) : {}
  const keyRows = await allKeyRows()
  const counts = countsOf(matrix)
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
    providers: matrix.map((p) => {
      const k = keyRows.get(p.id)
      return {
        id: p.id,
        label: p.label,
        protocol: p.protocol,
        modalities: p.modalities,
        tier: p.tier,
        local: p.local,
        model: k?.model || p.model,
        cost: p.cost,
        priceNote: p.priceNote,
        requiresKey: p.requiresKey,
        keyConfigured: p.requiresKey ? !!keys.get(p.id) : null,
        disabled: k?.disabled ?? false,
        adapterReady: p.protocol !== 'none',
        supportsTools: p.supportsTools ?? false,
      }
    }),
    health,
    breaker: breakerSnapshot(),
    ledger: { summary, recent },
  })
}
