// ROYAL RED LLM seam (Royal Red Round 2, DeepSeek-harness port #3).
//
// SOURCE PATTERN (MIT, verified upstream 2026-10-07):
//   deepseek-harness `packages/llm/llm/src/index.ts:2` — "LLM service: adapter
//   registry with a waterfall-interceptable streaming call". `packages/llm/llm
//   /src/call-config.ts:1-5` — "Provider routing, model, reasoning effort, and
//   sampling values are request-header state ...; the loop logs changed
//   snapshots instead of allowing silent per-call drift." `call-config.ts:23-30`
//   — the `LlmCallConfig` header (provider, model, sampling scalars).
//
// PORT DISCIPLINE (direct pattern port, reimplemented natively):
//   ONE interface through which every model call in the kernel flows:
//   `seamComplete` (chat) and `seamVision` (vision). Behind it, in order:
//     - the call header (`llm/request-header` event, harness call-config
//       discipline: config is logged state, never silent drift)
//     - the cost-aware router (fallback chain, circuit breakers, mid-stream
//       rotation, cost ledger) when routing is requested or house fails
//     - the HOUSE provider (the platform's built-in model) as the always-
//       available seam member — also breaker-tracked and ledger-recorded
//   No kernel code may make a MODEL call directly anymore; the only model-
//   provider import in the kernel lives here, behind the seam. (Platform
//   function services — web_search, page_reader, image generation — are tool
//   providers, not LLM calls; they stay mediated by the tool layer, the
//   policy waterfall and the cost ledger.) Order is
//   house-first by default (behavior-preserving), router-first per call via
//   `routeFirst` — and the router path is ALWAYS the fallback when the house
//   provider errors, so a house outage degrades to the matrix, never to zero.
//   Every attempt lands as a typed `llm/attempt` event (port #1) and a cost
//   ledger row; every rotation lands as `llm/rotation`.

import { appendEvent } from '../event-log'
import { execute, decide, type ExecuteResult, type RotationEvent } from '../router/router'
import type { CanonicalMessage, CapabilityRequest, RoutingPolicy } from '../providers/types'
import { DEFAULT_POLICY } from '../providers/types'
import { recordFailure, recordSuccess } from '../providers/health'
import { recordCost } from '../router/ledger'
import { checkBudget, recordUsage, estimateTokens, type BudgetRole } from '../budget'

const HOUSE_PROVIDER_ID = 'house-zai'
const HOUSE_MODEL = 'house-default (platform built-in)'

// ---------- call header (harness call-config discipline) ----------

export interface SeamCallHeader {
  operation: string
  modality: 'chat' | 'vision'
  provider: string // 'house-first' | 'router-first'
  model: string // 'house-default' — the header names the REQUEST, adapters name the actual provider
  routed: boolean
  policy: RoutingPolicy
}

function buildHeader(operation: string, modality: 'chat' | 'vision', routeFirst: boolean, policy: RoutingPolicy): SeamCallHeader {
  return {
    operation,
    modality,
    provider: routeFirst ? 'router-first' : 'house-first',
    model: 'house-default',
    routed: routeFirst,
    policy,
  }
}

// ---------- result shape ----------

export interface SeamMeta {
  path: 'house' | 'router'
  provider: string
  model: string
  latencyMs: number
  costUsd: number
  attempts: number
  switches: RotationEvent[]
  error?: string
  budgetExhausted?: boolean
}

export interface SeamResult {
  ok: boolean
  text: string
  meta: SeamMeta
}

export interface SeamCompleteOpts {
  operation: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  sessionId?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** route through the provider matrix FIRST (BYO-key path) */
  routeFirst?: boolean
  policy?: Partial<RoutingPolicy>
  // Round 4 (Phase 5 slice 1): budget-attributed calls. When a runId is
  // present the seam (a) refuses the call if that run already burned its
  // ceiling (escalation rule 1: the NEXT call is refused, never the in-flight
  // one), (b) records usage against the run, and (c) stamps the cost-ledger
  // row + llm/* events with the runId so receipts are reconstructible per run.
  runId?: string
  role?: BudgetRole
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number | undefined, label: string): Promise<T> {
  if (!timeoutMs) return p
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs))])
}

// ---------- house provider (the only provider import in the kernel) ----------

async function houseChat(messages: SeamCompleteOpts['messages']): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  })
  return completion.choices[0]?.message?.content ?? ''
}

async function houseVision(messages: unknown[]): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = await (zai.chat.completions as any).createVision({
    messages,
    thinking: { type: 'disabled' },
  })
  return completion.choices?.[0]?.message?.content ?? ''
}

// ---------- the seam: chat ----------

export async function seamComplete(opts: SeamCompleteOpts): Promise<SeamResult> {
  const role: BudgetRole = opts.role ?? 'top'
  // BUDGET GATE (before anything): an exhausted run is refused its next call.
  // The refusal is a typed meta flag — the CALLER owns the budget/exhausted
  // event + audit row (it knows the sub-agent identity), the seam stays a
  // pure gate.
  if (opts.runId) {
    const budget = checkBudget(opts.runId, role)
    if (!budget.ok) {
      return {
        ok: false,
        text: '',
        meta: {
          path: 'house',
          provider: HOUSE_PROVIDER_ID,
          model: HOUSE_MODEL,
          latencyMs: 0,
          costUsd: 0,
          attempts: 0,
          switches: [],
          budgetExhausted: true,
          error: `budget: run refused its next model call (${budget.reason}) — used ${budget.used?.tokensIn ?? 0} in / ${budget.used?.tokensOut ?? 0} out of caps ${budget.caps?.tokensIn ?? '?'}/${budget.caps?.tokensOut ?? '?'}`,
        },
      }
    }
  }
  const policy: RoutingPolicy = { ...DEFAULT_POLICY, preferLocal: true, ...(opts.policy ?? {}) }
  const header = buildHeader(opts.operation, 'chat', opts.routeFirst ?? false, policy)
  if (opts.sessionId) {
    void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/request-header', payload: { ...header } })
  }

  const t0 = Date.now()
  const attempts: string[] = []
  const switches: RotationEvent[] = []

  // --- path A: router first (BYO-key) ---
  if (opts.routeFirst) {
    const req: CapabilityRequest = {
      operation: opts.operation,
      modality: 'chat',
      messages: opts.messages as CanonicalMessage[],
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      policy: policy,
    }
    const res = await execute(req)
    switches.push(...res.switches)
    for (const s of res.switches) {
      if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/rotation', payload: { ...s } })
    }
    if (res.ok && res.text) {
      await recordCost({ operation: opts.operation, modality: 'chat', providerId: res.decision.chosen?.providerId ?? 'router', model: res.decision.chosen?.model ?? '?', tokensIn: 0, tokensOut: 0, costUsd: res.totalCostUsd, latencyMs: Date.now() - t0, outcome: 'ok', attempt: 1, runId: opts.runId })
      if (opts.runId) recordUsage(opts.runId, role, opts.messages.reduce((a, m) => a + estimateTokens(m.content), 0), estimateTokens(res.text))
      if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/attempt', payload: { operation: opts.operation, path: 'router', provider: res.decision.chosen?.providerId, outcome: 'ok', latencyMs: Date.now() - t0, costUsd: res.totalCostUsd, switches: res.switches.length } })
      return { ok: true, text: res.text, meta: { path: 'router', provider: res.decision.chosen?.providerId ?? 'router', model: res.decision.chosen?.model ?? '?', latencyMs: Date.now() - t0, costUsd: res.totalCostUsd, attempts: res.attempts.length, switches: res.switches } }
    }
    attempts.push(`router: ${res.error ?? 'failed'}`)
    if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/attempt', payload: { operation: opts.operation, path: 'router', outcome: 'error', error: res.error, attempts: res.attempts.length } })
  }

  // --- path B: house provider ---
  try {
    const text = await withTimeout(houseChat(opts.messages), opts.timeoutMs, 'seam chat')
    if (!text.trim()) throw new Error('empty model response')
    const latency = Date.now() - t0
    recordSuccess(HOUSE_PROVIDER_ID)
    // token estimate honesty: the house provider reports no usage, so the
    // ledger row + budget carry the chars/4 estimate (documented, consistent
    // with the ceiling that enforces on the same estimate)
    const estIn = opts.messages.reduce((a, m) => a + estimateTokens(m.content), 0)
    const estOut = estimateTokens(text)
    await recordCost({ operation: opts.operation, modality: 'chat', providerId: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, tokensIn: estIn, tokensOut: estOut, costUsd: 0, latencyMs: latency, outcome: 'ok', attempt: 1, runId: opts.runId })
    if (opts.runId) recordUsage(opts.runId, role, estIn, estOut)
    if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/attempt', payload: { operation: opts.operation, path: 'house', provider: HOUSE_PROVIDER_ID, outcome: 'ok', latencyMs: latency, costUsd: 0, tokensInEstimate: estIn, tokensOutEstimate: estOut } })
    return { ok: true, text, meta: { path: 'house', provider: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, latencyMs: latency, costUsd: 0, attempts: 1, switches } }
  } catch (e) {
    const err = (e as Error).message
    recordFailure(HOUSE_PROVIDER_ID)
    await recordCost({ operation: opts.operation, modality: 'chat', providerId: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - t0, outcome: 'error', error: err, attempt: 1, runId: opts.runId })
    if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, runId: opts.runId ?? null, type: 'llm/attempt', payload: { operation: opts.operation, path: 'house', outcome: 'error', error: err.slice(0, 160) } })
    attempts.push(`house: ${err}`)

    // --- path C: house failed -> the matrix is the fallback, never zero ---
    if (!opts.routeFirst) {
      const req: CapabilityRequest = {
        operation: opts.operation,
        modality: 'chat',
        messages: opts.messages as CanonicalMessage[],
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        policy,
      }
      try {
        const res = await execute(req)
        switches.push(...res.switches)
        if (res.ok && res.text) {
          if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, type: 'llm/attempt', payload: { operation: opts.operation, path: 'router-fallback', provider: res.decision.chosen?.providerId, outcome: 'ok', switches: res.switches.length } })
          return { ok: true, text: res.text, meta: { path: 'router', provider: res.decision.chosen?.providerId ?? 'router', model: res.decision.chosen?.model ?? '?', latencyMs: Date.now() - t0, costUsd: res.totalCostUsd, attempts: res.attempts.length + 1, switches } }
        }
        attempts.push(`router-fallback: ${res.error ?? 'failed'}`)
      } catch (re) {
        attempts.push(`router-fallback: ${(re as Error).message}`)
      }
    }
    return { ok: false, text: '', meta: { path: opts.routeFirst ? 'router' : 'house', provider: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, latencyMs: Date.now() - t0, costUsd: 0, attempts: attempts.length, switches, error: attempts.join(' | ') } }
  }
}

// ---------- the seam: vision ----------

export interface SeamVisionOpts {
  operation: string
  /** house message shape (text + image_url content parts) */
  messages: unknown[]
  sessionId?: string
  timeoutMs?: number
  routeFirst?: boolean
}

export async function seamVision(opts: SeamVisionOpts): Promise<SeamResult> {
  const policy: RoutingPolicy = { ...DEFAULT_POLICY, preferLocal: true }
  const header = buildHeader(opts.operation, 'vision', opts.routeFirst ?? false, policy)
  if (opts.sessionId) {
    void appendEvent({ sessionId: opts.sessionId, type: 'llm/request-header', payload: { ...header } })
  }

  const t0 = Date.now()
  // routed path: extract the first text part + first image url for the canonical request
  let textPart = ''
  let imageUrl: string | undefined
  for (const m of opts.messages as { content?: unknown }[]) {
    const parts = (m?.content ?? []) as { type?: string; text?: string; image_url?: { url?: string } }[]
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.type === 'text' && part.text && !textPart) textPart = part.text
        if (part?.type === 'image_url' && part.image_url?.url && !imageUrl) imageUrl = part.image_url.url
      }
    }
    if (textPart && imageUrl) break
  }

  if (opts.routeFirst) {
    const req: CapabilityRequest = { operation: opts.operation, modality: 'vision', prompt: textPart, imageUrl, policy }
    const res = await execute(req)
    if (res.ok && res.text) {
      if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, type: 'llm/attempt', payload: { operation: opts.operation, path: 'router', provider: res.decision.chosen?.providerId, outcome: 'ok' } })
      return { ok: true, text: res.text, meta: { path: 'router', provider: res.decision.chosen?.providerId ?? 'router', model: res.decision.chosen?.model ?? '?', latencyMs: Date.now() - t0, costUsd: res.totalCostUsd, attempts: res.attempts.length, switches: res.switches } }
    }
  }

  try {
    const text = await withTimeout(houseVision(opts.messages), opts.timeoutMs, 'seam vision')
    if (!text.trim()) throw new Error('empty vision response')
    const latency = Date.now() - t0
    recordSuccess(HOUSE_PROVIDER_ID)
    await recordCost({ operation: opts.operation, modality: 'vision', providerId: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: latency, outcome: 'ok', attempt: 1 })
    if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, type: 'llm/attempt', payload: { operation: opts.operation, path: 'house', provider: HOUSE_PROVIDER_ID, outcome: 'ok', latencyMs: latency } })
    return { ok: true, text, meta: { path: 'house', provider: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, latencyMs: latency, costUsd: 0, attempts: 1, switches: [] } }
  } catch (e) {
    recordFailure(HOUSE_PROVIDER_ID)
    await recordCost({ operation: opts.operation, modality: 'vision', providerId: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - t0, outcome: 'error', error: (e as Error).message, attempt: 1 })
    if (opts.sessionId) void appendEvent({ sessionId: opts.sessionId, type: 'llm/attempt', payload: { operation: opts.operation, path: 'house', outcome: 'error', error: (e as Error).message.slice(0, 160) } })
    return { ok: false, text: '', meta: { path: 'house', provider: HOUSE_PROVIDER_ID, model: HOUSE_MODEL, latencyMs: Date.now() - t0, costUsd: 0, attempts: 1, switches: [], error: (e as Error).message } }
  }
}

// ---------- routed path for products (router behind the seam) ----------

/**
 * Products and any caller that wants the full matrix path go through here —
 * never to `router.execute` directly. The header + attempt events land in
 * the session log when a sessionId is given.
 */
export async function seamRouted(req: CapabilityRequest, opts: { sessionId?: string } = {}): Promise<ExecuteResult> {
  if (opts.sessionId) {
    void appendEvent({ sessionId: opts.sessionId, type: 'llm/request-header', payload: { operation: req.operation, modality: req.modality, provider: 'router-first', policy: { ...DEFAULT_POLICY, preferLocal: true, ...(req.policy ?? {}) } } })
  }
  const res = await execute(req)
  if (opts.sessionId) {
    void appendEvent({
      sessionId: opts.sessionId,
      type: 'llm/attempt',
      payload: { operation: req.operation, path: 'router', provider: res.decision.chosen?.providerId, outcome: res.ok ? 'ok' : 'error', switches: res.switches.length, costUsd: res.totalCostUsd },
    })
  }
  return res
}

/** dry-run decision preview through the seam (no provider call is made) */
export async function seamDryRun(req: CapabilityRequest): Promise<Awaited<ReturnType<typeof decide>>> {
  return decide(req, true)
}
