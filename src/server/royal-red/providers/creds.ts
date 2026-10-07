// ROYAL RED credential resolution for the provider matrix.
//
// Order: BYO key stored in the RoyalRedProviderConfig table (AES-256-GCM at
// rest via verify/crypto) → environment variable → null. Keys NEVER appear in
// logs, results, or API responses — only a masked hint.

import { db } from '@/lib/db'
import { decryptSecret } from '../verify/crypto'
import type { ProviderDef } from './types'

const keyCache = new Map<string, { key: string | null; at: number }>()
const CACHE_TTL_MS = 30_000

export async function resolveApiKey(p: ProviderDef): Promise<string | null> {
  const cached = keyCache.get(p.id)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.key

  let key: string | null = null
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

  if (!key && p.envKey) {
    const env = process.env[p.envKey]
    if (env && env.length > 8) key = env
  }

  keyCache.set(p.id, { key, at: Date.now() })
  return key
}

export function invalidateKeyCache() {
  keyCache.clear()
}

/** providers that can execute RIGHT NOW (keyed or keyless-local) */
export async function executableProviderIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const id of ids) {
    const { providerById } = await import('./registry')
    const p = providerById(id)
    if (!p) continue
    const key = await resolveApiKey(p)
    if (!p.requiresKey || key) out.add(id)
  }
  return out
}
