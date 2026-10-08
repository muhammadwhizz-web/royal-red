// ROYAL RED provider key store (Settings cockpit).
//
// One RoyalRedProviderKey row per provider id (shipped or custom). The API key
// is AES-256-GCM ciphertext at rest; only the masked hint and status flags
// ever leave the server. This module is the ONLY writer for key rows; every
// mutation writes an audit row via the caller.

import { db } from '@/lib/db'
import { encryptSecret, decryptSecret, maskKey } from '../verify/crypto'
// re-exported so settings routes never import creds directly (seam boundary)
export { invalidateKeyCache } from './creds'

export interface ProviderKeyRow {
  providerId: string
  hasKey: boolean
  keyHint: string | null
  baseUrl: string | null
  model: string | null
  orgId: string | null
  headersJson: string | null
  disabled: boolean
  lastProbeAt: string | null
  lastProbeOk: boolean | null
  lastProbeLatencyMs: number | null
  lastError: string | null
  successCount: number
  failureCount: number
  avgLatencyMs: number
  rateLimitedUntil: string | null
  region: string | null
}

function toRow(r: {
  providerId: string
  apiKeyEnc: string | null
  keyHint: string | null
  baseUrl: string | null
  model: string | null
  orgId: string | null
  headersJson: string | null
  disabled: boolean
  lastProbeAt: Date | null
  lastProbeOk: boolean | null
  lastProbeLatencyMs: number | null
  lastError: string | null
  successCount: number
  failureCount: number
  avgLatencyMs: number
  rateLimitedUntil: Date | null
  region: string | null
}): ProviderKeyRow {
  return {
    providerId: r.providerId,
    hasKey: !!r.apiKeyEnc,
    keyHint: r.keyHint,
    baseUrl: r.baseUrl,
    model: r.model,
    orgId: r.orgId,
    headersJson: r.headersJson,
    disabled: r.disabled,
    lastProbeAt: r.lastProbeAt ? r.lastProbeAt.toISOString() : null,
    lastProbeOk: r.lastProbeOk,
    lastProbeLatencyMs: r.lastProbeLatencyMs,
    lastError: r.lastError,
    successCount: r.successCount,
    failureCount: r.failureCount,
    avgLatencyMs: r.avgLatencyMs,
    rateLimitedUntil: r.rateLimitedUntil ? r.rateLimitedUntil.toISOString() : null,
    region: r.region,
  }
}

export async function getKeyRow(providerId: string): Promise<ProviderKeyRow | null> {
  const r = await db.royalRedProviderKey.findUnique({ where: { providerId } })
  return r ? toRow(r) : null
}

export async function allKeyRows(): Promise<Map<string, ProviderKeyRow>> {
  const rows = await db.royalRedProviderKey.findMany()
  const out = new Map<string, ProviderKeyRow>()
  for (const r of rows) out.set(r.providerId, toRow(r))
  return out
}

export interface SaveKeyInput {
  providerId: string
  key?: string
  baseUrl?: string | null
  model?: string | null
  orgId?: string | null
  headers?: Record<string, string> | null
  region?: string | null
}

// save (create or update) the key record. `key` present + non-empty replaces
// the stored secret (rotate); absent keeps the existing one.
export async function saveKey(input: SaveKeyInput): Promise<ProviderKeyRow> {
  const existing = await db.royalRedProviderKey.findUnique({ where: { providerId: input.providerId } })
  const data: Record<string, unknown> = {
    baseUrl: input.baseUrl ?? existing?.baseUrl ?? null,
    model: input.model ?? existing?.model ?? null,
    orgId: input.orgId ?? existing?.orgId ?? null,
    region: input.region ?? existing?.region ?? null,
  }
  if (input.headers !== undefined) {
    data.headersJson = input.headers && Object.keys(input.headers).length ? JSON.stringify(input.headers) : null
  }
  if (input.key && input.key.trim()) {
    const k = input.key.trim()
    data.apiKeyEnc = encryptSecret(k)
    data.keyHint = maskKey(k)
  }
  const saved = existing
    ? await db.royalRedProviderKey.update({ where: { providerId: input.providerId }, data })
    : await db.royalRedProviderKey.create({ data: { providerId: input.providerId, ...data } })
  return toRow(saved)
}

export async function deleteKey(providerId: string): Promise<boolean> {
  const existing = await db.royalRedProviderKey.findUnique({ where: { providerId } })
  if (!existing) return false
  await db.royalRedProviderKey.update({
    where: { providerId },
    data: {
      apiKeyEnc: null,
      keyHint: null,
      // stale probe results belonged to the deleted key: clearing them keeps
      // the cockpit honest (the provider shows "no key", not a ghost error)
      lastProbeOk: null,
      lastProbeAt: null,
      lastProbeLatencyMs: null,
      lastError: null,
    },
  })
  return true
}

export async function setDisabled(providerId: string, disabled: boolean): Promise<ProviderKeyRow | null> {
  const saved = await db.royalRedProviderKey.upsert({
    where: { providerId },
    update: { disabled },
    create: { providerId, disabled },
  })
  return toRow(saved)
}

// persist a probe outcome (called by the settings/test endpoint)
export async function recordProbe(providerId: string, ok: boolean, latencyMs: number | null, error: string | null) {
  const existing = await db.royalRedProviderKey.findUnique({ where: { providerId } })
  const successCount = (existing?.successCount ?? 0) + (ok ? 1 : 0)
  const failureCount = (existing?.failureCount ?? 0) + (ok ? 0 : 1)
  // running average over successes (probe + real call latency feed the same stat)
  const prevAvg = existing?.avgLatencyMs ?? 0
  const avgLatencyMs = ok && latencyMs ? (prevAvg === 0 ? latencyMs : Math.round((prevAvg * 0.7 + latencyMs * 0.3) * 100) / 100) : prevAvg
  await db.royalRedProviderKey.upsert({
    where: { providerId },
    update: { lastProbeAt: new Date(), lastProbeOk: ok, lastProbeLatencyMs: latencyMs, lastError: error, successCount, failureCount, avgLatencyMs },
    create: { providerId, lastProbeAt: new Date(), lastProbeOk: ok, lastProbeLatencyMs: latencyMs, lastError: error, successCount, failureCount, avgLatencyMs },
  })
}

// persist a real request outcome (called by the router ledger path)
export async function recordTraffic(providerId: string, ok: boolean, latencyMs: number, error: string | null) {
  await recordProbe(providerId, ok, ok ? latencyMs : null, error).catch(() => {})
}

export async function markRateLimited(providerId: string, untilMs: number) {
  await db.royalRedProviderKey.upsert({
    where: { providerId },
    update: { rateLimitedUntil: new Date(untilMs) },
    create: { providerId, rateLimitedUntil: new Date(untilMs) },
  })
}

export async function rateLimitedUntil(providerId: string): Promise<number | null> {
  const r = await db.royalRedProviderKey.findUnique({ where: { providerId }, select: { rateLimitedUntil: true } })
  if (!r?.rateLimitedUntil) return null
  return r.rateLimitedUntil.getTime()
}

// decrypt helper for the audit-safe "is this key usable" checks (never logs)
export async function readStoredKey(providerId: string): Promise<string | null> {
  const r = await db.royalRedProviderKey.findUnique({ where: { providerId } })
  if (!r?.apiKeyEnc) return null
  return decryptSecret(r.apiKeyEnc)
}
