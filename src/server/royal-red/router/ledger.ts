// ROYAL RED cost ledger — every router decision and every provider call is
// recorded: provider, modality, model, tokens, cost, latency, outcome. This
// is the "what did this operation cost me" surface, and it is append-only.

import { db } from '@/lib/db'

export interface CostEntryInput {
  operation: string
  modality: string
  providerId: string
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  outcome: 'ok' | 'error' | 'switched' | 'dry-run'
  error?: string
  attempt: number
}

export async function recordCost(e: CostEntryInput) {
  try {
    await db.royalRedCostEntry.create({
      data: {
        operation: e.operation,
        modality: e.modality,
        providerId: e.providerId,
        model: e.model,
        tokensIn: e.tokensIn,
        tokensOut: e.tokensOut,
        costUsd: e.costUsd,
        latencyMs: e.latencyMs,
        outcome: e.outcome,
        error: e.error ?? null,
        attempt: e.attempt,
      },
    })
    await db.royalRedAudit.create({
      data: {
        action: `router.call.${e.outcome}`,
        detail: `${e.operation} ${e.modality} -> ${e.providerId}/${e.model} attempt ${e.attempt}: $${e.costUsd.toFixed(6)} ${e.tokensIn}in/${e.tokensOut}out ${e.latencyMs}ms${e.error ? ` error=${e.error.slice(0, 160)}` : ''}`,
        ok: e.outcome !== 'error',
      },
    })
  } catch {
    // ledger writes must never break the operation itself
  }
}

export async function recentCosts(limit = 20) {
  return db.royalRedCostEntry.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
}

export async function costSummary() {
  const agg = await db.royalRedCostEntry.aggregate({
    _sum: { costUsd: true, tokensIn: true, tokensOut: true },
    _count: { id: true },
  })
  const byProvider = await db.royalRedCostEntry.groupBy({
    by: ['providerId'],
    _sum: { costUsd: true },
    _count: { id: true },
    orderBy: { _count: { providerId: 'desc' } },
  })
  return {
    totalCostUsd: agg._sum.costUsd ?? 0,
    totalTokensIn: agg._sum.tokensIn ?? 0,
    totalTokensOut: agg._sum.tokensOut ?? 0,
    totalCalls: agg._count.id ?? 0,
    byProvider,
  }
}
