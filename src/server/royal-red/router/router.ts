// ROYAL RED cost-aware router with state-preserving rotation.
//
// The router is the product. Every operation is a capability request:
//   modality + quality floor + policy → cheapest capable provider wins,
// with fallback chains, circuit breakers, a cost ledger, dry-run previews,
// and MID-FLIGHT ROTATION: if a provider fails or a stream drops mid-response,
// the turn resumes on the next candidate with the partial output preserved —
// same session, same memory, same artifacts. The switch is logged, not felt.

import type {
  Adapter,
  AdapterResult,
  CapabilityRequest,
  RouteCandidate,
  RouteDecision,
  RoutingPolicy,
} from '../providers/types'
import { DEFAULT_POLICY } from '../providers/types'
import { PROVIDERS, providerById } from '../providers/registry'
import { LIVE_ADAPTERS } from '../providers/adapters'
import { resolveApiKey } from '../providers/creds'
import { breakerOpen, recordFailure, recordSuccess, audit } from '../providers/health'
import { recordCost } from './ledger'

const TIER_ORDER = { small: 0, mid: 1, frontier: 2 } as const

export interface RotationEvent {
  at: number
  fromProvider: string
  toProvider: string
  cause: string
  partialCharsPreserved: number
}

export interface ExecuteResult {
  ok: boolean
  text?: string
  decision: RouteDecision
  attempts: AdapterResult[]
  switches: RotationEvent[]
  totalCostUsd: number
  error?: string
}

// ---------- decision ----------

function estimateRequestCost(req: CapabilityRequest, providerId: string): number {
  const p = providerById(providerId)
  if (!p) return Infinity
  if (req.modality === 'image') return p.cost.image ?? 0
  if (req.modality === 'search') return p.cost.search ?? 0
  if (req.modality === 'audio') return p.cost.audio ?? 0
  if (req.modality === 'video') return p.cost.video ?? 0
  if (req.modality === 'embedding') return p.cost.embedding ?? 0
  const chars = (req.messages ?? []).reduce((a, m) => a + (m.content?.length ?? 0), 0)
  const inTok = Math.ceil(chars / 4)
  const outTok = req.maxTokens ?? 512
  return ((inTok / 1e6) * (p.cost.chatIn ?? 0)) + ((outTok / 1e6) * (p.cost.chatOut ?? 0))
}

export async function decide(req: CapabilityRequest, dryRun: boolean): Promise<RouteDecision> {
  const policy: RoutingPolicy = { ...DEFAULT_POLICY, ...(req.policy ?? {}) }
  const notes: string[] = []
  const minTier = TIER_ORDER[req.minTier ?? 'small']

  const pool = PROVIDERS.filter((p) => p.modalities.includes(req.modality))
  if (!pool.length) notes.push(`no provider serves modality ${req.modality}`)

  const candidates: RouteCandidate[] = []
  for (const p of pool) {
    const blocked: string | undefined =
      p.protocol === 'none'
        ? 'no execution adapter yet (fail closed)'
        : TIER_ORDER[p.tier] < minTier
          ? `below quality floor (${p.tier} < ${req.minTier})`
          : !policy.allowPaid && !p.local
            ? 'policy: paid providers not allowed'
            : p.local && !policy.allowPaid
              ? undefined
              : (p.cost.chatIn ?? 0) > 0 && !policy.allowPaid
                ? 'policy: paid providers not allowed'
                : policy.deniedProviders?.includes(p.id)
                  ? 'policy: provider denied'
                  : policy.allowedProviders && !policy.allowedProviders.includes(p.id)
                    ? 'policy: not in allowed list'
                    : breakerOpen(p.id)
                      ? 'circuit breaker open'
                      : undefined

    const est = estimateRequestCost(req, p.id)
    const overBudget = est > policy.maxCostUsd && !p.local
    const keyNeeded = p.requiresKey
    const key = keyNeeded ? await resolveApiKey(p) : null

    const blockedFull =
      blocked ??
      (overBudget ? `estimated $${est.toFixed(4)} over policy cap $${policy.maxCostUsd.toFixed(2)}` : undefined) ??
      (keyNeeded && !key && !dryRun ? 'no API key configured' : undefined)

    candidates.push({
      providerId: p.id,
      model: p.model,
      estimatedCostUsd: p.local ? 0 : est,
      tier: p.tier,
      local: p.local,
      reason: p.local ? 'local = $0 tokens' : `est $${est.toFixed(4)} · ${p.tier}`,
      blocked: blockedFull,
    })
  }

  const runnable = candidates.filter((c) => !c.blocked)
  // preferLocal → local first; then cost; then (stable) registry order
  const byCost = (a: RouteCandidate, b: RouteCandidate) => {
    if (policy.preferLocal && a.local !== b.local) return a.local ? -1 : 1
    if (a.estimatedCostUsd !== b.estimatedCostUsd) return a.estimatedCostUsd - b.estimatedCostUsd
    return 0
  }
  const runnableSorted = [...runnable].sort(byCost)
  const blockedSorted = candidates.filter((c) => c.blocked).sort(byCost)
  // FULL list (runnable first, blocked after with reasons) — dry-run transparency
  const sorted = [...runnableSorted, ...blockedSorted]
  if (dryRun && runnable.some((c) => { const p = providerById(c.providerId); return p?.requiresKey })) {
    notes.push('dry-run includes providers whose key is configured; unkeyed ones are marked')
  }
  if (!sorted.length) notes.push('no candidate passed policy/capability filters — fail closed')

  const chosen = runnableSorted[0] ?? null
  if (dryRun) {
    await audit('router.decide.dry-run', `${req.operation}: would route to ${chosen?.providerId ?? 'NOTHING'}`, !!chosen)
    return { operation: req.operation, modality: req.modality, chosen, candidates: sorted, dryRun: true, policy, notes }
  }
  return { operation: req.operation, modality: req.modality, chosen, candidates: sorted, dryRun: false, policy, notes }
}

// ---------- execution with fallback + rotation ----------

function continuationMessages(messages: CanonicalMessage[], partial: string): CanonicalMessage[] {
  // the partial assistant output becomes context on the next provider —
  // the turn is preserved, never restarted from scratch
  return [
    ...messages,
    { role: 'assistant', content: partial },
    {
      role: 'user',
      content:
        'Your response was interrupted mid-stream. The partial text above is what was already delivered. Continue EXACTLY from where it stops — do not repeat, do not re-introduce. Complete the response.',
    },
  ]
}

export async function execute(req: CapabilityRequest): Promise<ExecuteResult> {
  const decision = await decide(req, false)
  const attempts: AdapterResult[] = []
  const switches: RotationEvent[] = []
  let totalCost = 0
  const baseMessages = req.messages ?? []
  let messages = baseMessages
  let partialCarry = '' // every char already produced by dropped providers — never lost

  if (!decision.chosen) {
    return { ok: false, decision, attempts, switches, totalCostUsd: 0, error: decision.notes.join('; ') || 'no routable provider' }
  }

  const adapters = req.adaptersOverride ?? LIVE_ADAPTERS

  for (let i = 0; i < decision.candidates.length; i++) {
    const cand = decision.candidates[i]
    if (cand.blocked) continue // never attempt a candidate the router blocked
    const p = providerById(cand.providerId)
    if (!p) continue
    const adapter: Adapter | undefined = adapters[p.protocol]
    if (!adapter) {
      attempts.push({ ok: false, error: `no adapter for protocol ${p.protocol}`, latencyMs: 0, providerId: p.id, model: p.model })
      continue
    }
    const apiKey = p.requiresKey ? await resolveApiKey(p) : null
    if (p.requiresKey && !apiKey) {
      attempts.push({ ok: false, error: 'no API key configured', latencyMs: 0, providerId: p.id, model: p.model })
      continue
    }

    const effReq: CapabilityRequest = { ...req, messages }
    const res = await adapter.call(effReq, p, apiKey)
    attempts.push(res)

    // ---- mid-stream rotation: stream dropped but partial text was captured ----
    if (!res.ok && res.partial) {
      const partial = res.text ?? ''
      partialCarry += partial // accumulate across MULTIPLE consecutive drops
      const next = decision.candidates[i + 1]
      if (next) {
        switches.push({ at: Date.now(), fromProvider: p.id, toProvider: next.providerId, cause: res.error?.slice(0, 120) ?? 'stream dropped', partialCharsPreserved: partial.length })
        messages = continuationMessages(baseMessages, partialCarry)
        await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: res.usage?.tokensIn ?? 0, tokensOut: res.usage?.tokensOut ?? 0, costUsd: res.usage?.costUsd ?? 0, latencyMs: res.latencyMs, outcome: 'switched', error: res.error, attempt: i + 1 })
        totalCost += res.usage?.costUsd ?? 0
        recordFailure(p.id)
        continue
      }
    }

    if (res.ok) {
      recordSuccess(p.id)
      const finalText = partialCarry ? partialCarry + (res.text ?? '') : res.text
      await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: res.usage?.tokensIn ?? 0, tokensOut: res.usage?.tokensOut ?? 0, costUsd: res.usage?.costUsd ?? 0, latencyMs: res.latencyMs, outcome: 'ok', attempt: i + 1 })
      totalCost += res.usage?.costUsd ?? 0
      return { ok: true, text: finalText, toolCalls: res.toolCalls, decision, attempts, switches, totalCostUsd: totalCost }
    }

    // hard failure → breaker + ledger + next candidate
    recordFailure(p.id)
    await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: res.usage?.tokensIn ?? 0, tokensOut: res.usage?.tokensOut ?? 0, costUsd: res.usage?.costUsd ?? 0, latencyMs: res.latencyMs, outcome: 'error', error: res.error, attempt: i + 1 })
    totalCost += res.usage?.costUsd ?? 0
  }

  return { ok: false, decision, attempts, switches, totalCostUsd: totalCost, error: `all ${attempts.length} candidates failed — fail closed` }
}

// ---------- streaming with rotation ----------

export interface StreamEvents {
  onDelta(text: string): void
  onSwitch?(ev: RotationEvent): void
  onAttempt?(providerId: string): void
}

export async function executeStream(req: CapabilityRequest, events: StreamEvents): Promise<ExecuteResult> {
  const decision = await decide(req, false)
  const attempts: AdapterResult[] = []
  const switches: RotationEvent[] = []
  let totalCost = 0
  let messages = req.messages ?? []
  let delivered = ''

  if (!decision.chosen) {
    return { ok: false, decision, attempts, switches, totalCostUsd: 0, error: decision.notes.join('; ') || 'no routable provider' }
  }
  const adapters = req.adaptersOverride ?? LIVE_ADAPTERS

  for (let i = 0; i < decision.candidates.length; i++) {
    const cand = decision.candidates[i]
    if (cand.blocked) continue // never attempt a candidate the router blocked
    const p = providerById(cand.providerId)
    if (!p) continue
    const adapter = adapters[p.protocol]
    if (!adapter?.stream) {
      attempts.push({ ok: false, error: `no streaming adapter for protocol ${p.protocol}`, latencyMs: 0, providerId: p.id, model: p.model })
      continue
    }
    const apiKey = p.requiresKey ? await resolveApiKey(p) : null
    if (p.requiresKey && !apiKey) continue

    events.onAttempt?.(p.id)
    const before = delivered.length
    try {
      const res = await adapter.stream({ ...req, messages }, p, apiKey, (t) => {
        delivered += t
        events.onDelta(t)
      })
      attempts.push(res)
      recordSuccess(p.id)
      await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: res.usage?.tokensIn ?? 0, tokensOut: res.usage?.tokensOut ?? 0, costUsd: res.usage?.costUsd ?? 0, latencyMs: res.latencyMs, outcome: 'ok', attempt: i + 1 })
      totalCost += res.usage?.costUsd ?? 0
      return { ok: true, text: delivered, decision, attempts, switches, totalCostUsd: totalCost }
    } catch (e) {
      if (e instanceof import('../providers/types').MidStreamDrop) {
        const partial = delivered.slice(before)
        const next = decision.candidates[i + 1]
        await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, outcome: 'switched', error: e.message, attempt: i + 1 })
        if (next) {
          const ev: RotationEvent = { at: Date.now(), fromProvider: p.id, toProvider: next.providerId, cause: 'mid-stream drop', partialCharsPreserved: partial.length }
          switches.push(ev)
          events.onSwitch?.(ev)
          recordFailure(p.id)
          messages = continuationMessages(messages, delivered)
          continue
        }
      }
      const res: AdapterResult = { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: 0, providerId: p.id, model: p.model }
      attempts.push(res)
      recordFailure(p.id)
      await recordCost({ operation: req.operation, modality: req.modality, providerId: p.id, model: p.model, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0, outcome: 'error', error: res.error, attempt: i + 1 })
    }
  }
  return { ok: false, text: delivered || undefined, decision, attempts, switches, totalCostUsd: totalCost, error: `stream failed on all ${attempts.length} candidates` }
}
