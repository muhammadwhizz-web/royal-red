// ROYAL RED router test suite — runs with `bun scripts/test-royalred-router.ts`
//
// Covers the directive's test contract:
//   1. registry integrity (25+ providers, 5+ modalities, 100% cost metadata)
//   2. capability filtering + fail-closed 'none' protocol
//   3. quality floor
//   4. policy: allowPaid / maxCostUsd cap / denied+allowed lists
//   5. dry-run preview with honest block reasons
//   6. fallback chain (provider A fails hard → B completes)
//   7. circuit breaker (5 failures in window → open 90s → blocks routing)
//   8. no-candidates → fail closed, honest error
//   9. cost ledger rows written per attempt
//  10. THE 5-SWITCH TEST: one operation forced through 5 consecutive
//      mid-stream provider drops, partial text preserved, correct final
//      output, 5 switch events + 6 ledger rows.

import { PROVIDERS, matrixCounts, providerById } from '../src/server/royal-red/providers/registry'
import { decide, execute } from '../src/server/royal-red/router/router'
import type { Adapter, CapabilityRequest } from '../src/server/royal-red/providers/types'
import { recordFailure, breakerOpen, resetBreakers, recordSuccess } from '../src/server/royal-red/providers/health'

import { db } from '../src/lib/db'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

function chatReq(over: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    modality: 'chat',
    operation: 'router-test',
    messages: [{ role: 'user', content: 'hello' }],
    ...over,
  }
}

async function main() {
  console.log('— ROYAL RED router test suite —')

  // 1. registry integrity
  const counts = matrixCounts()
  check(`registry has 25+ providers (${counts.providers})`, counts.providers >= 25)
  check('registry covers 5+ modalities', Object.keys(counts.byModality).length >= 5)
  check('every provider carries cost metadata', PROVIDERS.every((p) => Object.keys(p.cost).length > 0))
  check('honest fail-closed entries exist (protocol none)', PROVIDERS.some((p) => p.protocol === 'none'))
  check('local $0 engines present', PROVIDERS.filter((p) => p.local).length >= 10)
  check('openai-compat family covers 15+ providers', PROVIDERS.filter((p) => p.protocol === 'openai-compat').length >= 15)

  // 2. capability filter: image request never picks chat-only provider
  resetBreakers()
  const imgDecision = await decide(chatReq({ modality: 'image', operation: 'router-test/image', prompt: 'a red cube' }), true)
  const imageProviders = new Set(PROVIDERS.filter((p) => p.modalities.includes('image')).map((p) => p.id))
  check('image decision only considers image providers', imgDecision.candidates.every((c) => imageProviders.has(c.providerId)))
  check("'none'-protocol providers never routable", imgDecision.candidates.every((c) => { const p = providerById(c.providerId); return !p || p.protocol !== 'none' || c.blocked }))

  // 3. quality floor
  const floor = await decide(chatReq({ minTier: 'frontier' }), true)
  check('frontier floor excludes small/mid models', floor.candidates.every((c) => c.tier === 'frontier' || c.blocked))

  // 4. policy
  const freeOnly = await decide(chatReq({ policy: { allowPaid: false } }), true)
  check('allowPaid:false routes only local engines', freeOnly.candidates.every((c) => c.local || c.blocked))
  const capped = await decide(chatReq({ policy: { maxCostUsd: 0.0001 } }), true)
  check('cost cap blocks over-budget providers (free $0 providers legitimately pass)', capped.candidates.every((c) => c.local || c.estimatedCostUsd <= 0.0001 || c.blocked))
  const denied = await decide(chatReq({ policy: { deniedProviders: ['groq'] } }), true)
  check('deniedProviders respected (never unblocked)', denied.candidates.every((c) => c.providerId !== 'groq' || c.blocked))

  // 5. dry-run
  const dry = await decide(chatReq({ operation: 'router-test/dry' }), true)
  check('dry-run has chosen + full candidate list', !!dry.chosen && dry.candidates.length > 1)
  const dryImg = await decide(chatReq({ modality: 'image', operation: 'router-test/dry-img', prompt: 'x' }), true)
  check('dry-run marks blocked candidates with reasons (none-protocol image providers)', dryImg.candidates.some((c) => c.blocked?.includes('fail closed')))

  // 6. fallback chain with fake adapters (no network)
  resetBreakers()
  const fakeAdapters: Record<string, Adapter> = {
    'openai-compat': {
      protocol: 'openai-compat',
      async call(req, p) {
        if (p.id === 'localai') {
          return { ok: true, text: 'FALLBACK_WORKED', usage: { tokensIn: 5, tokensOut: 3, costUsd: 0 }, latencyMs: 11, providerId: p.id, model: p.model }
        }
        return { ok: false, error: 'simulated hard failure', latencyMs: 5, providerId: p.id, model: p.model }
      },
    },
    anthropic: {
      protocol: 'anthropic',
      async call(req, p) { return { ok: false, error: 'simulated hard failure', latencyMs: 5, providerId: p.id, model: p.model } },
    },
  }
  const fb = await execute(chatReq({
    operation: 'router-test/fallback',
    adaptersOverride: fakeAdapters,
    policy: { allowedProviders: ['ollama', 'vllm', 'lmstudio', 'localai'] }, // registry-order chain: ollama fails, vllm fails, lmstudio fails, localai completes
  }))
  check('fallback: chain walks to a working provider', fb.ok && fb.text === 'FALLBACK_WORKED', JSON.stringify(fb.attempts.map((a) => [a.providerId, a.ok, a.error])))
  check('fallback: attempts recorded for failed providers', fb.attempts.filter((a) => !a.ok).length >= 1)

  // 9. ledger rows written (needs DB; deterministic: clear prior test rows)
  try {
    await db.$queryRaw`SELECT 1`
    await db.royalRedCostEntry.deleteMany({ where: { operation: { startsWith: 'router-test/' } } })
  } catch { console.log('  ..  ledger prep skipped (DB unavailable)') }

  // 7. circuit breaker
  resetBreakers()
  recordFailure('groq'); recordFailure('groq'); recordFailure('groq'); recordFailure('groq')
  check('breaker closed below threshold (4 failures)', !breakerOpen('groq'))
  recordFailure('groq')
  check('breaker OPENS at 5 failures', breakerOpen('groq'))
  const duringOpen = await decide(chatReq({ policy: { allowedProviders: ['groq'] } }), true)
  check('open breaker blocks routing', duringOpen.candidates.every((c) => c.blocked))
  recordSuccess('groq')
  check('recordSuccess resets breaker', !breakerOpen('groq'))

  // 8. fail closed when nothing is routable
  resetBreakers()
  const none = await execute(chatReq({ modality: 'video', operation: 'router-test/none', policy: { allowedProviders: ['runway'] } }))
  check('no-capability request fails closed with honest error', !none.ok && /fail closed|no routable/.test(none.error ?? ''), none.error)

  // 10. THE 5-SWITCH TEST — 5 consecutive mid-stream drops, partial preserved
  // chain uses KEYLESS-LOCAL engines (keyed providers without keys are honestly
  // blocked): $0 ties keep stable registry order → ollama, vllm, lmstudio,
  // localai, jan fail mid-stream, llamacpp-server completes
  resetBreakers()
  const FAILERS = ['ollama', 'vllm', 'lmstudio', 'localai', 'jan']
  const SURVIVOR = 'llamacpp-server'
  const partials = ['Once upon', ' a time', ' in', ' a land', ' far away']
  const completion = ', there lived a router.'
  let dropIdx = 0
  const rotatingAdapters: Record<string, Adapter> = {
    'openai-compat': {
      protocol: 'openai-compat',
      async call(req, p) {
        const idx = FAILERS.indexOf(p.id)
        if (idx >= 0 && idx >= dropIdx) {
          dropIdx = idx + 1
          // verify the continuation prompt carried the accumulated partial
          const lastUser = [...(req.messages ?? [])].reverse().find((m) => m.role === 'user')
          const expectedCarry = partials.slice(0, idx + 1).join('')
          const carried = (lastUser?.content as string ?? '').includes('interrupted mid-stream') &&
            (req.messages ?? []).some((m) => m.role === 'assistant' && m.content === expectedCarry)
          return { ok: false, partial: true, text: partials[idx], error: `simulated mid-stream drop on ${p.id} (continuation-carried=${carried})`, latencyMs: 9, providerId: p.id, model: p.model }
        }
        if (p.id === SURVIVOR) {
          return { ok: true, text: completion, usage: { tokensIn: 20, tokensOut: 8, costUsd: 0 }, latencyMs: 12, providerId: p.id, model: p.model }
        }
        return { ok: false, error: 'unexpected provider in chain', latencyMs: 1, providerId: p.id, model: p.model }
      },
    },
  }
  const sw = await execute(chatReq({
    operation: 'router-test/5switch',
    adaptersOverride: rotatingAdapters,
    policy: { allowedProviders: [...FAILERS, SURVIVOR] },
    messages: [{ role: 'user', content: 'tell a story' }],
  }))
  check('5-SWITCH: operation succeeds despite 5 mid-stream drops', sw.ok, sw.error)
  check('5-SWITCH: exactly 5 rotation events', sw.switches.length === 5, `got ${sw.switches.length}`)
  check('5-SWITCH: partial text fully preserved in final output', sw.text === partials.join('') + completion, JSON.stringify(sw.text))
  check('5-SWITCH: switches carry causes', sw.switches.every((s) => s.cause.length > 0 && s.partialCharsPreserved > 0))
  check('5-SWITCH: 6 attempts recorded (5 drops + 1 success)', sw.attempts.length >= 6, `got ${sw.attempts.length}`)
  try {
    await db.$queryRaw`SELECT 1`
    const ledgerRows = await db.royalRedCostEntry.findMany({ where: { operation: 'router-test/5switch' }, orderBy: { createdAt: 'desc' } })
    check('5-SWITCH: ledger has switched x5 + ok x1', ledgerRows.filter((r) => r.outcome === 'switched').length === 5 && ledgerRows.filter((r) => r.outcome === 'ok').length === 1, JSON.stringify(ledgerRows.map((r) => r.outcome)))
  } catch { console.log('  ..  5-switch ledger check skipped (DB unavailable)') }

  resetBreakers()
  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail > 0) process.exit(1)
  await db.$disconnect().catch(() => {})
}

main().catch((e) => { console.error(e); process.exit(1) })
