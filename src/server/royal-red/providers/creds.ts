// ROYAL RED credential resolution for the provider matrix.
//
// Order: BYO key stored in the RoyalRedProviderKey table (Settings cockpit,
// AES-256-GCM at rest) → legacy RoyalRedProviderConfig row (critique configs,
// matched by binding/family/host) → environment variable → null. Keys NEVER
// appear in logs, results, or API responses — only a masked hint.

import { db } from '@/lib/db'
import { decryptSecret } from '../verify/crypto'
import { readStoredKey } from './keys'
import type { ProviderDef } from './types'

const keyCache = new Map<string, { key: string | null; at: number }>()
const CACHE_TTL_MS = 30_000

export async function resolveApiKey(p: ProviderDef): Promise<string | null> {
  const cached = keyCache.get(p.id)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.key

  let key: string | null = null

  // 1. the Settings cockpit key store (canonical path)
  try {
    key = await readStoredKey(p.id)
  } catch { /* DB unavailable — fall through */ }

  // 2. legacy provider config rows (critique configs and pre-cockpit keys)
  if (!key) {
    try {
      const rows = await db.royalRedProviderConfig.findMany({ where: { active: true } })
      for (const row of rows) {
        // match by explicit binding, by provider family name, or by baseUrl host
        const host = (u: string) => { try { return new URL(u).host } catch { return '' } }
        const match =
          row.provider === p.id ||
          row.provider === (p.credProviderId ?? p.id) ||
          host(row.baseUrl) === host(p.baseUrl)
        if (!match || !row.apiKeyEnc) continue
        const dec = decryptSecret(row.apiKeyEnc)
        if (dec) { key = dec; break }
      }
    } catch { /* DB unavailable — fall through to env */ }
  }

  // 3. environment variable named by the registry entry
  if (!key && p.envKey) {
    const env = process.env[p.envKey]
    if (env && env.length > 8) key = env
  }

  keyCache.set(p.id, { key, at: Date.now() })
  return key
}

// effective runtime overrides for a provider (base URL, default model) stored
// in the key row. The router and adapters should use these when present.
export async function effectiveOverrides(p: ProviderDef): Promise<{ baseUrl?: string; model?: string }> {
  try {
    const { db: database } = await import('@/lib/db')
    const row = await database.royalRedProviderKey.findUnique({
      where: { providerId: p.id },
      select: { baseUrl: true, model: true },
    })
    const out: { baseUrl?: string; model?: string } = {}
    if (row?.baseUrl) out.baseUrl = row.baseUrl
    if (row?.model) out.model = row.model
    return out
  } catch {
    return {}
  }
}

export function invalidateKeyCache() {
  keyCache.clear()
}

/** providers that can execute RIGHT NOW (keyed or keyless-local) */
export async function executableProviderIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const { providerById } = await import('./registry')
  for (const id of ids) {
    const p = providerById(id)
    if (!p) continue
    const key = await resolveApiKey(p)
    if (!p.requiresKey || key) out.add(id)
  }
  return out
}
