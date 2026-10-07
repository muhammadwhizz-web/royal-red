// ROYAL RED products — the demonstration that the router is the product.
//
// Three products ship end-to-end this round, each with: a prompt contract,
// a routing policy, a template set (pure HTML, zero-token rendering), a
// verification plan (structured constraint checks → receipt), and a real
// run path through the cost-aware router.
//
// Honesty rules:
// - when the router has no executable provider (no keys configured, no local
//   engine), the run falls back to Royal Red's BUILT-IN model and the receipt
//   says exactly which path produced the artifact ("router" vs "builtin-fallback").
// - a product whose output fails verification is reported as failed — never faked.

import { seamRouted } from '../llm/seam'
import type { CapabilityRequest, CanonicalMessage } from '../providers/types'

export interface ProductRunReceipt {
  product: string
  operation: string
  routingPath: 'router' | 'builtin-fallback'
  providerChain: string[]
  switches: number
  costUsd: number
  verification: {
    ok: boolean
    score: number
    checks: { name: string; pass: boolean; detail?: string }[]
  }
  artifactHtml: string
}

interface ProductDef {
  id: string
  label: string
  defaultPolicy: CapabilityRequest['policy']
  systemPrompt: string
  userPrompt(input: Record<string, unknown>): string
  /** validate + render; honest failures allowed */
  verifyAndRender(input: Record<string, unknown>, raw: string): { checks: ProductRunReceipt['verification']['checks']; html: string; score: number }
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = fenced ? fenced[1] : raw
  const start = text.search(/[[{]/)
  if (start < 0) throw new Error('no JSON in model output')
  return JSON.parse(text.slice(start))
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------------------------------------------------------------- flashcards

const flashcards: ProductDef = {
  id: 'flashcards',
  label: 'Alphabet Flashcards',
  defaultPolicy: { allowPaid: true, maxCostUsd: 0.05, preferLocal: false },
  systemPrompt:
    'You generate printable alphabet flashcards. Reply with ONLY a JSON array, no prose. Each item: {"term": string (starts with the given letter), "definition": string (max 12 words), "emoji": string (one emoji)}.',
  userPrompt: (input) => {
    const letter = String(input.letter ?? 'A').toUpperCase().slice(0, 1)
    const count = Math.min(12, Math.max(3, Number(input.count) || 6))
    return `Generate ${count} flashcard words that start with the letter "${letter}". Theme: ${String(input.theme ?? 'everyday objects')}.`
  },
  verifyAndRender: (input, raw) => {
    const letter = String(input.letter ?? 'A').toUpperCase().slice(0, 1)
    const count = Math.min(12, Math.max(3, Number(input.count) || 6))
    const checks: ProductRunReceipt['verification']['checks'] = []
    let cards: Array<{ term?: string; definition?: string; emoji?: string }> = []
    try {
      cards = extractJson(raw) as typeof cards
      checks.push({ name: 'output parses as JSON', pass: true })
    } catch (e) {
      checks.push({ name: 'output parses as JSON', pass: false, detail: e instanceof Error ? e.message : 'parse failed' })
      return { checks, html: '', score: 0 }
    }
    checks.push({ name: `card count >= ${count}`, pass: cards.length >= count, detail: `got ${cards.length}` })
    const allFilled = cards.every((c) => c.term && c.definition)
    checks.push({ name: 'every card has term + definition', pass: allFilled })
    const letterOk = cards.filter((c) => (c.term ?? '').toUpperCase().startsWith(letter)).length >= Math.ceil(count * 0.8)
    checks.push({ name: `>=80% of terms start with "${letter}"`, pass: letterOk })
    const passed = checks.filter((c) => c.pass).length
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ROYAL RED · ${esc(letter)} Flashcards</title><style>
body{font-family:ui-rounded,system-ui,sans-serif;margin:0;padding:24px;background:#faf7f5}
h1{color:#b91c1c;font-size:20px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card{border:2px solid #b91c1c;border-radius:14px;padding:18px;text-align:center;background:#fff;page-break-inside:avoid}
.emoji{font-size:44px}.term{font-size:24px;font-weight:800;color:#7f1d1d}.def{font-size:12px;color:#57534e}
@media print{body{padding:0}.card{border-color:#7f1d1d}}</style></head><body>
<h1>ROYAL RED · Letter ${esc(letter)} Flashcards</h1><div class="grid">
${cards.map((c) => `<div class="card"><div class="emoji">${esc(c.emoji || '⭐')}</div><div class="term">${esc(c.term)}</div><div class="def">${esc(c.definition)}</div></div>`).join('')}
</div></body></html>`
    return { checks, html, score: Math.round((passed / checks.length) * 10) }
  },
}

// ---------------------------------------------------------------- deck

const deck: ProductDef = {
  id: 'deck',
  label: 'Presentation Deck',
  defaultPolicy: { allowPaid: true, maxCostUsd: 0.05, preferLocal: false },
  systemPrompt:
    'You write presentation decks. Reply with ONLY a JSON object: {"slides":[{"title":string,"bullets":[string,... 2-4 items],"note":string}]}. Markdown-deck style: concrete, skimmable bullets.',
  userPrompt: (input) => {
    const slides = Math.min(12, Math.max(3, Number(input.slides) || 5))
    return `Create a ${slides}-slide deck about: ${String(input.topic ?? 'Royal Red')}. Audience: ${String(input.audience ?? 'general')}.`
  },
  verifyAndRender: (input, raw) => {
    const want = Math.min(12, Math.max(3, Number(input.slides) || 5))
    const checks: ProductRunReceipt['verification']['checks'] = []
    let data: { slides?: Array<{ title?: string; bullets?: string[]; note?: string }> } = {}
    try {
      data = extractJson(raw) as typeof data
      checks.push({ name: 'output parses as JSON', pass: true })
    } catch (e) {
      checks.push({ name: 'output parses as JSON', pass: false, detail: e instanceof Error ? e.message : 'parse failed' })
      return { checks, html: '', score: 0 }
    }
    const slides = data.slides ?? []
    checks.push({ name: `slide count >= ${want}`, pass: slides.length >= want, detail: `got ${slides.length}` })
    checks.push({ name: 'every slide has a title', pass: slides.every((s) => s.title) })
    checks.push({ name: 'every slide has >=1 bullet', pass: slides.every((s) => (s.bullets ?? []).length >= 1) })
    const passed = checks.filter((c) => c.pass).length
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ROYAL RED · ${esc(input.topic ?? 'Deck')}</title><style>
body{margin:0;font-family:system-ui,sans-serif;background:#1a0505}
.slide{width:100vw;height:100vh;box-sizing:border-box;padding:60px;display:flex;flex-direction:column;justify-content:center;page-break-after:always;background:linear-gradient(135deg,#1a0505,#2d0a0a);color:#fee2e2}
.slide h2{font-size:44px;color:#f87171;margin:0 0 24px}.slide li{font-size:22px;margin:8px 0;color:#fecaca}
.slide .note{margin-top:28px;font-size:14px;color:#a8a29e}.brand{position:fixed;bottom:12px;right:18px;color:#7f1d1d;font-size:11px}
@media print{.slide{width:100%;height:100vh}}</style></head><body>
${slides.map((s) => `<section class="slide"><h2>${esc(s.title)}</h2><ul>${(s.bullets ?? []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</section>`).join('')}
<div class="brand">ROYAL RED</div></body></html>`
    return { checks, html, score: Math.round((passed / checks.length) * 10) }
  },
}

// ---------------------------------------------------------------- resume

const resume: ProductDef = {
  id: 'resume',
  label: 'Resume Templates',
  defaultPolicy: { allowPaid: true, maxCostUsd: 0.05, preferLocal: false },
  systemPrompt:
    'You tailor resumes. Reply with ONLY JSON: {"summary":string(max 40 words),"headline":string,"skills":[string],"experience":[{"role":string,"company":string,"period":string,"highlights":[string]}],"education":[string]}. Keep facts from the input; improve wording only.',
  userPrompt: (input) =>
    `Tailor this resume for the target role "${String(input.role ?? 'Software Engineer')}". Candidate data: ${JSON.stringify(input).slice(0, 2000)}`,
  verifyAndRender: (input, raw) => {
    const checks: ProductRunReceipt['verification']['checks'] = []
    let r: {
      summary?: string; headline?: string; skills?: string[]
      experience?: Array<{ role?: string; company?: string; period?: string; highlights?: string[] }>
      education?: string[]
    } = {}
    try {
      r = extractJson(raw) as typeof r
      checks.push({ name: 'output parses as JSON', pass: true })
    } catch (e) {
      checks.push({ name: 'output parses as JSON', pass: false, detail: e instanceof Error ? e.message : 'parse failed' })
      return { checks, html: '', score: 0 }
    }
    checks.push({ name: 'summary present (<=60 words)', pass: !!r.summary && r.summary.split(/\s+/).length <= 60 })
    checks.push({ name: '>=2 skills listed', pass: (r.skills ?? []).length >= 2 })
    checks.push({ name: 'experience entries have role+company', pass: (r.experience ?? []).every((x) => x.role && x.company) })
    checks.push({ name: 'experience present', pass: (r.experience ?? []).length > 0 })
    const passed = checks.filter((c) => c.pass).length
    const name = String(input.name ?? 'Your Name')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ROYAL RED · Resume ${esc(name)}</title><style>
body{font-family:Georgia,serif;color:#1c1917;max-width:820px;margin:0 auto;padding:40px;background:#fff}
h1{margin:0;font-size:30px;color:#7f1d1d}.headline{color:#57534e;margin:4px 0 2px}.rule{border:none;border-top:3px solid #b91c1c;margin:14px 0}
h3{color:#b91c1c;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin:20px 0 6px}
.job{margin:10px 0}.job b{font-size:15px}.period{color:#78716c;font-size:12px;float:right}
ul{margin:6px 0}li{font-size:13px;margin:3px 0}.skills span{display:inline-block;border:1px solid #e7e5e4;border-radius:4px;padding:2px 8px;margin:2px;font-size:12px}
@media print{body{padding:0}}</style></head><body>
<h1>${esc(name)}</h1><div class="headline">${esc(r.headline ?? String(input.role ?? ''))}</div>
<div class="headline">${esc(String(input.email ?? ''))} ${esc(String(input.phone ?? ''))}</div><hr class="rule"/>
<h3>Summary</h3><p style="font-size:13px">${esc(r.summary)}</p>
<h3>Skills</h3><div class="skills">${(r.skills ?? []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>
<h3>Experience</h3>${(r.experience ?? []).map((x) => `<div class="job"><b>${esc(x.role)}</b> — ${esc(x.company)}<span class="period">${esc(x.period)}</span><ul>${(x.highlights ?? []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>`).join('')}
${(r.education ?? []).length ? `<h3>Education</h3><ul>${(r.education ?? []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
</body></html>`
    return { checks, html, score: Math.round((passed / checks.length) * 10) }
  },
}

export const PRODUCTS: Record<string, ProductDef> = { flashcards, deck, resume }

// ---------------------------------------------------------------- runner

async function builtinFallback(def: ProductDef, input: Record<string, unknown>): Promise<string> {
  const { callLlmJson } = await import('../verify/ledger')
  return callLlmJson(def.systemPrompt, def.userPrompt(input), 60_000)
}

export async function runProduct(productId: string, input: Record<string, unknown>): Promise<ProductRunReceipt> {
  const def = PRODUCTS[productId]
  if (!def) throw new Error(`unknown product ${productId}`)

  const messages: CanonicalMessage[] = [
    { role: 'system', content: def.systemPrompt },
    { role: 'user', content: def.userPrompt(input) },
  ]
  const req: CapabilityRequest = {
    modality: 'chat',
    operation: `product.${def.id}`,
    messages,
    maxTokens: 1600,
    temperature: 0.6,
    policy: def.defaultPolicy,
  }

  let raw: string | null = null
  let routingPath: ProductRunReceipt['routingPath'] = 'router'
  let providerChain: string[] = []
  let switches = 0
  let costUsd = 0

  try {
    const res = await seamRouted(req)
    if (res.ok && res.text) {
      raw = res.text
      providerChain = res.attempts.map((a) => a.providerId)
      switches = res.switches.length
      costUsd = res.totalCostUsd
    }
  } catch { /* fall through to builtin */ }

  if (raw === null) {
    routingPath = 'builtin-fallback'
    raw = await builtinFallback(def, input)
    providerChain = ['royalred-builtin']
  }

  const { checks, html, score } = def.verifyAndRender(input, raw)
  return {
    product: def.id,
    operation: `product.${def.id}`,
    routingPath,
    providerChain,
    switches,
    costUsd,
    verification: { ok: checks.every((c) => c.pass), score, checks },
    artifactHtml: html,
  }
}
