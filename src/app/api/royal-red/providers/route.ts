import { NextResponse } from 'next/server'
import { REGISTRY_VERSION } from '@/server/royal-red/providers/matrix'
import { allProviders, countsOf } from '@/server/royal-red/providers/matrix'
import { resolveApiKey } from '@/server/royal-red/providers/creds'
import { breakerSnapshot, healthSnapshot, probeAll } from '@/server/royal-red/providers/health'
import { allKeyRows } from '@/server/royal-red/providers/keys'
import { costSummary, recentCosts } from '@/server/royal-red/router/ledger'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/providers?probe=1 — the canonical provider matrix feed.
// Shared data source for the PROVIDERS panel and the Settings cockpit:
// full matrix (shipped + custom), per-provider status, key presence (masked
// hints only, keys NEVER leave the server), measured health, breaker states.
export async function GET(req: Request) {
  const probe = new URL(req.url).searchParams.get('probe') === '1'
  const matrix = await allProviders()

  const keys = new Map<string, string | null>()
  for (const p of matrix) keys.set(p.id, p.requiresKey ? await resolveApiKey(p) : null)

  const health = probe ? await probeAll(matrix, keys) : healthSnapshot()
  const keyRows = await allKeyRows()
  const counts = countsOf(matrix)
  const summary = await costSummary()
  const recent = await recentCosts(25)

  const connected = matrix.filter((p) => {
    const h = health[p.id]
    const keyed = p.requiresKey ? !!keys.get(p.id) : true
    return keyed && !keyRows.get(p.id)?.disabled && (h?.state === 'reachable' || keyed)
  }).length

  return NextResponse.json({
    registryVersion: REGISTRY_VERSION,
    counts,
    status: {
      connected,
      keyed: matrix.filter((p) => p.requiresKey && keys.get(p.id)).length,
      noKey: matrix.filter((p) => p.requiresKey && !keys.get(p.id)).length,
      disabled: [...keyRows.values()].filter((r) => r.disabled).length,
      errors: [...keyRows.values()].filter((r) => r.lastProbeOk === false).length,
    },
    providers: matrix.map((p) => {
      const k = keyRows.get(p.id)
      const h = health[p.id]
      const hasKey = p.requiresKey ? !!keys.get(p.id) : true
      return {
        id: p.id,
        label: p.label,
        protocol: p.protocol,
        modalities: p.modalities,
        tier: p.tier,
        local: p.local,
        model: k?.model || p.model,
        defaultModel: p.model,
        baseUrl: p.baseUrl,
        baseUrlOverride: k?.baseUrl ?? null,
        cost: p.cost,
        priceNote: p.priceNote,
        endpointNote: p.endpointNote,
        freeTier: p.freeTier ?? false,
        region: p.region ?? 'any',
        requiresKey: p.requiresKey,
        keyConfigured: p.requiresKey ? hasKey : null,
        keyHint: k?.keyHint ?? null,
        disabled: k?.disabled ?? false,
        custom: !p.id || undefined,
        orgId: k?.orgId ?? null,
        headersJson: k?.headersJson ?? null,
        adapterReady: p.protocol !== 'none',
        supportsTools: p.supportsTools ?? false,
        supportsStreaming: p.supportsStreaming ?? false,
        lastSuccessAt: k?.lastProbeOk ? k.lastProbeAt : null,
        lastProbeAt: k?.lastProbeAt ?? null,
        lastError: k?.lastError ?? null,
        successCount: k?.successCount ?? 0,
        failureCount: k?.failureCount ?? 0,
        avgLatencyMs: k?.avgLatencyMs ?? 0,
        health: h?.state ?? 'not-probed',
        healthLatencyMs: h?.latencyMs ?? null,
        healthDetail: h?.detail ?? null,
      }
    }),
    breaker: breakerSnapshot(),
    ledger: { summary, recent },
  })
}
