// ROYAL RED provider health + circuit breaker.
//
// Health is MEASURED, not guessed: each probe records reachability and latency
// for the PROVIDERS panel. The breaker is per-provider: N failures inside the
// window opens the circuit for M seconds — a down provider never kills an
// operation, the router just routes around it.

import { db } from '@/lib/db'
import type { ProviderDef } from './types'

export type HealthState = 'unknown' | 'reachable' | 'reachable-unauthorized' | 'unreachable' | 'breaker-open' | 'unconfigured'

interface HealthRecord {
  state: HealthState
  latencyMs: number | null
  checkedAt: number
  detail?: string
}

const health = new Map<string, HealthRecord>()
const HEALTH_TTL_MS = 60_000

// ---------------- circuit breaker ----------------

interface BreakerState {
  failures: number[]
  openUntil: number
}

const breakers = new Map<string, BreakerState>()
const BREAKER_WINDOW_MS = 60_000
const BREAKER_THRESHOLD = 5
const BREAKER_OPEN_MS = 90_000

export function recordFailure(providerId: string) {
  const b = breakers.get(providerId) ?? { failures: [], openUntil: 0 }
  const now = Date.now()
  b.failures = b.failures.filter((t) => now - t < BREAKER_WINDOW_MS)
  b.failures.push(now)
  if (b.failures.length >= BREAKER_THRESHOLD) b.openUntil = now + BREAKER_OPEN_MS
  breakers.set(providerId, b)
}

export function recordSuccess(providerId: string) {
  const b = breakers.get(providerId)
  if (b) { b.failures = []; b.openUntil = 0 }
}

export function breakerOpen(providerId: string): boolean {
  const b = breakers.get(providerId)
  if (!b) return false
  if (b.openUntil > Date.now()) return true
  if (b.openUntil > 0) { b.openUntil = 0; b.failures = [] } // expired — half-open
  return false
}

export function breakerSnapshot(): Record<string, { failures: number; openForMs: number }> {
  const out: Record<string, { failures: number; openForMs: number }> = {}
  const now = Date.now()
  for (const [id, b] of breakers) {
    out[id] = { failures: b.failures.filter((t) => now - t < BREAKER_WINDOW_MS).length, openForMs: Math.max(0, b.openUntil - now) }
  }
  return out
}

export function resetBreakers() { breakers.clear() }

// ---------------- health probes ----------------

export function healthSnapshot(): Record<string, HealthRecord> {
  const out: Record<string, HealthRecord> = {}
  for (const [k, v] of health) out[k] = v
  return out
}

export async function probeProvider(p: ProviderDef, apiKey: string | null, force = false): Promise<HealthRecord> {
  const cached = health.get(p.id)
  if (!force && cached && Date.now() - cached.checkedAt < HEALTH_TTL_MS) return cached

  let rec: HealthRecord
  const started = Date.now()
  try {
    let res: Response
    if (p.protocol === 'anthropic') {
      res = await fetch(`${p.baseUrl}/v1/models`, { headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(6_000) })
    } else if (p.protocol === 'google-native') {
      // Gemini AI Studio native: /v1beta/models with the key as a query param
      res = await fetch(`${p.baseUrl}/models?key=${encodeURIComponent(apiKey ?? '')}&pageSize=1`, { signal: AbortSignal.timeout(6_000) })
    } else if (p.protocol === 'cohere-native') {
      res = await fetch(`${p.baseUrl}/v1/models?page_size=1`, { headers: { authorization: `Bearer ${apiKey ?? ''}` }, signal: AbortSignal.timeout(6_000) })
    } else if (p.protocol === 'cloudflare') {
      // Workers AI: the key is stored as "token::accountId" (see settings UI)
      const [token, accountId] = (apiKey ?? '').split('::')
      if (!token || !accountId) {
        rec = { state: breakerOpen(p.id) ? 'breaker-open' : 'unconfigured', latencyMs: null, checkedAt: Date.now(), detail: 'needs token::accountId (account id missing)' }
        health.set(p.id, rec)
        return rec
      }
      res = await fetch(`${p.baseUrl}/accounts/${accountId}/ai/models/search?per_page=1`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6_000) })
    } else if (p.protocol === 'a1111') {
      res = await fetch(`${p.baseUrl}/internal/ping`, { signal: AbortSignal.timeout(4_000) })
    } else if (p.protocol === 'search-rest' || p.protocol === 'none') {
      // no read-only surface we can hit honestly — report from breaker state only
      rec = { state: breakerOpen(p.id) ? 'breaker-open' : apiKey || !p.requiresKey ? 'unknown' : 'unconfigured', latencyMs: null, checkedAt: Date.now() }
      health.set(p.id, rec)
      return rec
    } else {
      res = await fetch(`${p.baseUrl}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(6_000) })
    }
    const latency = Date.now() - started
    const state: HealthState =
      res.ok ? 'reachable' : res.status === 401 || res.status === 403 ? 'reachable-unauthorized' : 'unreachable'
    rec = { state, latencyMs: state === 'reachable' || state === 'reachable-unauthorized' ? latency : null, checkedAt: Date.now(), detail: `HTTP ${res.status}` }
  } catch (e) {
    rec = { state: breakerOpen(p.id) ? 'breaker-open' : 'unreachable', latencyMs: null, checkedAt: Date.now(), detail: e instanceof Error ? e.message.slice(0, 120) : 'probe failed' }
  }
  health.set(p.id, rec)
  return rec
}

export async function probeAll(providers: ProviderDef[], keys: Map<string, string | null>): Promise<Record<string, HealthRecord>> {
  await Promise.allSettled(providers.map(async (p) => { await probeProvider(p, keys.get(p.id) ?? null) }))
  return healthSnapshot()
}

// audit helper shared with the router
export async function audit(action: string, detail: string, ok = true) {
  try { await db.royalRedAudit.create({ data: { action, detail, ok } }) } catch { /* audit best-effort on probe paths */ }
}
