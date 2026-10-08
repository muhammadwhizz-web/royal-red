// ROYAL RED memory store (Round 6, Section 2).
//
// Persistent, scoped, cross-session memory. Three paths:
//   WRITE  - the user says "remember that ..." (trusted, source=user) or the
//            kernel proposes an inference (source=agent, confidence < 1).
//   READ   - before every turn, memories in scope (global + this session) are
//            loaded, scored for relevance, and injected into the agent's
//            context under a strict character budget.
//   PANEL  - the MEMORY panel lists, edits, promotes, demotes, expires,
//            searches, and exports memories (all audit-logged).
//
// Privacy law: memories never leave the machine. No cloud sync path exists in
// this module, and any future sync must be end-to-end encrypted and opt-in.

import { db } from '@/lib/db'

export type MemoryScope = 'global' | 'project' | 'session' | 'agent'

export const MEMORY_SCOPES: MemoryScope[] = ['global', 'project', 'session', 'agent']

// the injected-context budget. Roughly 4 chars per token; 3200 chars keeps the
// injection near 800 tokens so memory never crowds the actual command.
export const MEMORY_CHAR_BUDGET = 3200
const MAX_ROWS = 40

export interface RoyalRedMemoryView {
  id: string
  scope: MemoryScope
  scopeRef: string // empty string = none (global scope)
  key: string
  value: string
  source: 'user' | 'agent' | 'inferred'
  confidence: number
  tags: string[]
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

function isScope(v: unknown): v is MemoryScope {
  return typeof v === 'string' && (MEMORY_SCOPES as string[]).includes(v)
}

function toView(m: {
  id: string
  scope: string
  scopeRef: string
  key: string
  value: string
  source: string
  confidence: number
  tags: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}): RoyalRedMemoryView {
  return {
    id: m.id,
    scope: (isScope(m.scope) ? m.scope : 'global') as MemoryScope,
    scopeRef: m.scopeRef,
    key: m.key,
    value: m.value,
    source: (['user', 'agent', 'inferred'].includes(m.source) ? m.source : 'inferred') as RoyalRedMemoryView['source'],
    confidence: m.confidence,
    tags: (m.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    expiresAt: m.expiresAt ? m.expiresAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------- write path

// "remember that I prefer royal red in dark mode" -> a memory. Returns null
// when the text is not a remember-command (the turn then proceeds normally).
export function parseRememberCommand(text: string): { key: string; value: string } | null {
  const t = text.trim().replace(/\s+/g, ' ')
  const m = t.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.{4,500})[.!]?$/i)
  if (!m) return null
  const value = m[1].trim()
  if (!value) return null
  // key = the first five significant words, lowercased: a short searchable
  // handle ("prefer royal red in dark") that stays stable across rephrasing
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1)
  const key = words.slice(0, 5).join(' ') || value.toLowerCase().slice(0, 40)
  return { key, value }
}

export async function writeMemory(input: {
  scope?: MemoryScope
  scopeRef?: string
  key: string
  value: string
  source?: 'user' | 'agent' | 'inferred'
  confidence?: number
  tags?: string[]
  expiresAt?: Date | null
}): Promise<RoyalRedMemoryView> {
  const scope: MemoryScope = input.scope ?? 'global'
  const scopeRef = input.scopeRef ?? ''
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).join(',')
  const row = await db.royalRedMemory.upsert({
    where: { scope_scopeRef_key: { scope, scopeRef, key: input.key } },
    create: {
      scope,
      scopeRef,
      key: input.key.slice(0, 80),
      value: input.value.slice(0, 2000),
      source: input.source ?? 'user',
      confidence: input.confidence ?? 1,
      tags: tags || null,
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      value: input.value.slice(0, 2000),
      source: input.source ?? 'user',
      confidence: input.confidence ?? 1,
      tags: tags || null,
      expiresAt: input.expiresAt ?? null,
    },
  })
  await auditMemory('memory:write', `${scope}/${input.key}`)
  return toView(row)
}

// ---------------------------------------------------------------- read path

function scoreRelevance(m: { key: string; value: string; tags: string | null; updatedAt: Date }, words: string[]): number {
  if (!words.length) return 0
  const hay = `${m.key} ${m.value} ${m.tags ?? ''}`.toLowerCase()
  let overlap = 0
  for (const w of words) {
    if (w.length > 2 && hay.includes(w)) overlap++
  }
  // recency: newer memories win ties (last 7 days = up to 2 points)
  const days = (Date.now() - m.updatedAt.getTime()) / 86_400_000
  const recency = days < 7 ? 2 : days < 30 ? 1 : 0
  return overlap * 3 + recency
}

// load the memories relevant to this turn: global scope always, session scope
// when a sessionId is given, nothing expired. Sorted by relevance to the
// user's words (tag match + recency), then trimmed to the char budget.
export async function relevantMemories(userText: string, sessionId?: string): Promise<RoyalRedMemoryView[]> {
  const now = new Date()
  const rows = await db.royalRedMemory.findMany({
    where: {
      OR: [{ scope: 'global' }, ...(sessionId ? [{ scope: 'session', scopeRef: sessionId }] : [])],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  const words = userText.toLowerCase().split(/\s+/).filter(Boolean)
  const scored = rows
    .map((r) => ({ row: r, score: scoreRelevance(r, words) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ROWS)
  const out: RoyalRedMemoryView[] = []
  let budget = MEMORY_CHAR_BUDGET
  for (const { row } of scored) {
    const cost = row.key.length + row.value.length + 12
    if (cost > budget) continue
    budget -= cost
    out.push(toView(row))
  }
  return out
}

export function memoryBlockForPrompt(memories: RoyalRedMemoryView[]): string | null {
  if (!memories.length) return null
  const lines = memories.map((m) => `- [${m.scope}] ${m.key}: ${m.value}`)
  return `PERSISTENT MEMORY (Royal Red remembers these across sessions; honor them):\n${lines.join('\n')}`
}

// one-call helper for the agent loop: returns the system-prompt block or null
export async function memoryInjection(userText: string, sessionId?: string): Promise<string | null> {
  try {
    const memories = await relevantMemories(userText, sessionId)
    return memoryBlockForPrompt(memories)
  } catch {
    return null // memory is never allowed to break a turn
  }
}

// ---------------------------------------------------------------- audit

// every memory mutation lands in the audit log as the Memory Keeper role
export async function auditMemory(action: string, detail: string): Promise<void> {
  try {
    await db.royalRedAudit.create({
      data: { action, detail, ok: true, agentRole: 'Memory Keeper' },
    })
  } catch {
    // audit must never crash the host operation; the memory row is the source
    // of truth and the panel re-reads from the DB
  }
}
