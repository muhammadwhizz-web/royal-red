// ROYAL RED matrix merge: the shipped registry plus the user's custom
// providers (RoyalRedCustomProvider table). Custom providers route through the
// openai-compat adapter with the auth scheme they declare. Unknown rates are
// kept unknown: cost objects stay empty and the router treats them as
// "unknown cost" until the user opts in via allowlist or priority.

import { db } from '@/lib/db'
import { PROVIDERS, providerById } from './registry'
import type { Modality, ProviderDef } from './types'

// re-exported so panel routes can read registry constants without importing
// the registry module directly (arch invariant: seam boundary)
export { REGISTRY_VERSION } from './registry'
export { invalidateKeyCache } from './creds'

export function customToProviderDef(r: {
  providerId: string
  label: string
  baseUrl: string
  authScheme: string
  headerName: string | null
  modalities: string
  model: string
  costIn: number | null
  costOut: number | null
  priceNote: string | null
}): ProviderDef {
  const modalities = r.modalities
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean) as Modality[]
  return {
    id: r.providerId,
    label: r.label,
    protocol: 'openai-compat',
    modalities: modalities.length ? modalities : ['chat'],
    baseUrl: r.baseUrl,
    model: r.model,
    tier: 'mid',
    local: r.baseUrl.includes('localhost') || r.baseUrl.includes('127.0.0.1'),
    cost: r.costIn !== null ? { chatIn: r.costIn, chatOut: r.costOut ?? 0 } : {},
    priceNote: r.priceNote ?? (r.costIn === null ? 'custom provider: rates as published by the endpoint owner' : undefined),
    requiresKey: r.authScheme !== 'none',
    supportsTools: true,
    supportsStreaming: true,
    endpointNote: `custom provider (${r.authScheme} auth${r.headerName ? ` via ${r.headerName}` : ''})`,
  }
}

export async function customProviders(): Promise<ProviderDef[]> {
  try {
    const rows = await db.royalRedCustomProvider.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.map(customToProviderDef)
  } catch {
    return []
  }
}

// the full matrix: shipped registry first (stable order), custom providers after
export async function allProviders(): Promise<ProviderDef[]> {
  const custom = await customProviders()
  const seen = new Set(PROVIDERS.map((p) => p.id))
  return [...PROVIDERS, ...custom.filter((c) => !seen.has(c.id))]
}

// merged lookup (shipped, then custom)
export async function findProvider(id: string): Promise<ProviderDef | undefined> {
  return providerById(id) ?? (await customProviders()).find((p) => p.id === id)
}

export { PROVIDERS }

export function countsOf(providers: ProviderDef[]) {
  const byModality: Record<string, number> = {}
  for (const p of providers) for (const m of p.modalities) byModality[m] = (byModality[m] ?? 0) + 1
  return {
    providers: providers.length,
    withAdapter: providers.filter((p) => p.protocol !== 'none').length,
    withCost: providers.length,
    byModality,
  }
}
