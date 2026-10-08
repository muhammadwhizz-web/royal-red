// ROYAL RED settings store: general settings + routing preferences.
// Settings are simple key/value rows; router preferences are a singleton row
// that the router reads on every decision. Both are audit-logged by callers.

import { db } from '@/lib/db'

export const DEFAULT_SETTINGS: Record<string, string> = {
  theme: 'system',
  language: 'en',
  defaultMode: 'build',
  bootAnimation: 'on',
  sound: 'off',
  telemetry: 'off',
  autoUpdate: 'notify',
  fontSize: 'normal',
  density: 'comfortable',
  motion: 'full',
  port: '3000',
  logLevel: 'info',
  maxConcurrentAgents: '4',
  wallClockBudgetMin: '20',
  tokenBudget: '200000',
  autoLockMin: '30',
  auditRetentionDays: '365',
}

export interface RouterPrefsShape {
  priority: string[]
  fallbackBehavior: 'next-on-failure' | 'fail-fast' | 'next-on-rate-limit'
  costCeilingUsd: number
  localFirst: boolean
  freeTierFirst: boolean
  region: 'any' | 'eu' | 'us'
  allowlist: string[]
  denylist: string[]
  rateLimitBehavior: 'wait-retry' | 'next-immediately'
}

export const DEFAULT_PREFS: RouterPrefsShape = {
  priority: [],
  fallbackBehavior: 'next-on-failure',
  costCeilingUsd: 0.5,
  localFirst: false,
  freeTierFirst: false,
  region: 'any',
  allowlist: [],
  denylist: [],
  rateLimitBehavior: 'wait-retry',
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.royalRedSetting.findMany()
  const out: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const r of rows) out[r.key] = r.value
  return out
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.royalRedSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function setSettings(partial: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(partial)) await setSetting(k, v)
}

export async function getRouterPrefs(): Promise<RouterPrefsShape> {
  try {
    const row = await db.royalRedRouterPrefs.findUnique({ where: { id: 'default' } })
    if (!row) return { ...DEFAULT_PREFS }
    return {
      priority: row.priorityJson ? (JSON.parse(row.priorityJson) as string[]) : [],
      fallbackBehavior: row.fallbackBehavior as RouterPrefsShape['fallbackBehavior'],
      costCeilingUsd: row.costCeilingUsd,
      localFirst: row.localFirst,
      freeTierFirst: row.freeTierFirst,
      region: row.region as RouterPrefsShape['region'],
      allowlist: row.allowlistJson ? (JSON.parse(row.allowlistJson) as string[]) : [],
      denylist: row.denylistJson ? (JSON.parse(row.denylistJson) as string[]) : [],
      rateLimitBehavior: row.rateLimitBehavior as RouterPrefsShape['rateLimitBehavior'],
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export async function saveRouterPrefs(prefs: Partial<RouterPrefsShape>): Promise<RouterPrefsShape> {
  const current = await getRouterPrefs()
  const next: RouterPrefsShape = { ...current, ...prefs }
  const data = {
    priorityJson: JSON.stringify(next.priority),
    fallbackBehavior: next.fallbackBehavior,
    costCeilingUsd: next.costCeilingUsd,
    localFirst: next.localFirst,
    freeTierFirst: next.freeTierFirst,
    region: next.region,
    allowlistJson: JSON.stringify(next.allowlist),
    denylistJson: JSON.stringify(next.denylist),
    rateLimitBehavior: next.rateLimitBehavior,
  }
  await db.royalRedRouterPrefs.upsert({ where: { id: 'default' }, update: data, create: { id: 'default', ...data } })
  return next
}
