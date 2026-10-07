// ROYAL RED adversarial critic (Phase 2.2).
//
// A critique score from the builder's own context is theater: the critic will
// agree with the builder ~90% of the time when it shares context. So the
// critic here is deliberately CONTEXT-INDEPENDENT: it receives only the user
// request, the constraint ledger, the artifact files and screenshots - never
// the builder's score, review, or conversation.
//
// Second model: when the user configured a critique provider (BYO key, stored
// AES-256-GCM encrypted), the critique runs on that genuinely independent
// endpoint. Without one, the local model runs the same adversarial protocol
// from a fresh context, and every report HONESTLY labels which mode ran.
// Fail closed: a failed critique is reported as "unverified", never faked.
import { db } from '@/lib/db'
import { decryptSecret } from './crypto'
import { callLlmJson, type ConstraintVerdict, type LedgerItem } from './ledger'

export interface CritiqueInput {
  userPrompt: string
  constraints: LedgerItem[]
  files: { path: string; content: string }[]
  entry: string
  screenshotDescriptions?: string[] // vision-derived notes, if taken
}

export interface CritiqueResult {
  status: 'ok' | 'unverified'
  mode: 'independent-provider' | 'same-family-fresh-context'
  provider: string
  model: string
  score: number // 0-10
  perConstraint: { cid: string; verdict: 'pass' | 'fail' | 'unclear'; evidence: string }[]
  deductions: string[]
  summary: string
  raw?: string
}

const CRITIC_SYSTEM = `You are the ROYAL RED ADVERSARIAL CRITIC. You did not build this artifact; you have no loyalty to it. Your job is to find every real flaw.
You receive: the user's request, the constraint ledger, and the artifact's files. You do NOT see the builder's self-score - do not assume one.
Grade:
1. "score": your honest 0-10 for the artifact as a fulfillment of the request (a working, complete, polished build is 10; deductions must name concrete flaws).
2. "perConstraint": for EVERY constraint id, a verdict "pass"|"fail"|"unclear" with one-line evidence FROM THE FILES.
3. "deductions": every concrete flaw worth fixing, each one line, or [] if genuinely none.
4. "summary": two sentences max.
Reply with EXACTLY ONE JSON object:
{"score":7,"perConstraint":[{"cid":"C1","verdict":"pass","evidence":"..."}],"deductions":["..."],"summary":"..."}
No markdown, no commentary. JSON only.`

interface ProviderRow {
  id: string
  provider: string
  label: string
  baseUrl: string
  model: string
  apiKeyEnc: string | null
  active: boolean
}

async function getActiveCritiqueProvider(): Promise<ProviderRow | null> {
  const rows = await db.royalRedProviderConfig.findMany({ where: { purpose: 'critique' } })
  return rows.find((r) => r.active) ?? rows[0] ?? null
}

// unified chat call across openai-compatible + anthropic wire formats.
// hard timeout; no retries (a critic must be fast and honest, not stubborn).
async function providerChat(
  p: ProviderRow,
  system: string,
  user: string,
  timeoutMs = 60_000,
): Promise<string> {
  const key = p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : null
  const base = p.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (p.provider === 'anthropic') {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: p.model,
          max_tokens: 2000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
      if (!res.ok) throw new Error(`provider HTTP ${res.status}`)
      const data = (await res.json()) as { content?: { type: string; text?: string }[] }
      const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
      if (!text.trim()) throw new Error('provider returned empty critique')
      return text
    }
    // openai-compatible (openai, custom gateways, ollama, lm studio...)
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('provider returned empty critique')
    return text
  } finally {
    clearTimeout(timer)
  }
}

function parseCritique(raw: string): Pick<CritiqueResult, 'score' | 'perConstraint' | 'deductions' | 'summary'> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const score = Number(o.score)
    if (!Number.isFinite(score) || score < 0 || score > 10) return null
    const per = Array.isArray(o.perConstraint)
      ? (o.perConstraint as Record<string, unknown>[])
          .map((c) => ({
            cid: String(c.cid ?? ''),
            verdict: (['pass', 'fail', 'unclear'].includes(String(c.verdict)) ? String(c.verdict) : 'unclear') as 'pass' | 'fail' | 'unclear',
            evidence: String(c.evidence ?? '').slice(0, 300),
          }))
          .filter((c) => c.cid)
      : []
    const ded = Array.isArray(o.deductions) ? (o.deductions as unknown[]).map((d) => String(d).slice(0, 300)).filter(Boolean).slice(0, 12) : []
    return {
      score: Math.round(score * 10) / 10,
      perConstraint: per,
      deductions: ded,
      summary: String(o.summary ?? '').slice(0, 500),
    }
  } catch {
    // salvage: the critic model sometimes wraps JSON in prose or breaks a
    // field; extracting the score alone keeps the receipt honest instead of
    // discarding the whole critique
    const m = text.match(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (!m) return null
    const score = Math.max(0, Math.min(10, Number(m[1])))
    const ded: string[] = []
    const dedBlock = text.match(/"deductions"\s*:\s*\[([\s\S]*?)\]/)
    if (dedBlock) {
      for (const mm of dedBlock[1].matchAll(/"([^"]{6,280})"/g)) ded.push(mm[1])
    }
    return {
      score: Math.round(score * 10) / 10,
      perConstraint: [],
      deductions: ded.slice(0, 12),
      summary: 'critique output was partially malformed; score and deductions salvaged by the kernel',
    }
  }
}

export async function runCritique(input: CritiqueInput): Promise<CritiqueResult> {
  const provider = await getActiveCritiqueProvider()
  const ledgerBlock = input.constraints.length
    ? input.constraints.map((c) => `- [${c.cid}] (${c.category}) ${c.text} :: check: ${c.assertion}`).join('\n')
    : '(no ledger for this session)'
  const filesBlock = input.files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content.slice(0, 9000)}`)
    .join('\n\n')
    .slice(0, 60_000)
  const userBlock = [
    `USER REQUEST: ${input.userPrompt.slice(0, 2500)}`,
    `\nCONSTRAINT LEDGER:\n${ledgerBlock}`,
    input.screenshotDescriptions?.length ? `\nSCREENSHOT NOTES:\n${input.screenshotDescriptions.join('\n').slice(0, 2500)}` : '',
    `\nARTIFACT (entry: ${input.entry}):\n${filesBlock}`,
  ].join('\n')

  if (provider) {
    try {
      let raw = await providerChat(provider, CRITIC_SYSTEM, userBlock)
      let parsed = parseCritique(raw)
      if (!parsed) {
        // one bounded retry with a harder format instruction
        raw = await providerChat(provider, CRITIC_SYSTEM, userBlock + '\n\nSTRICT FORMAT REMINDER: reply with EXACTLY ONE valid JSON object and nothing else. No prose before or after.')
        parsed = parseCritique(raw)
      }
      if (!parsed) throw new Error('critique output was not valid JSON')
      return {
        status: 'ok',
        mode: 'independent-provider',
        provider: provider.label,
        model: provider.model,
        ...parsed,
      }
    } catch (e) {
      // fail closed: report unverified, do NOT silently fall back and pretend
      return {
        status: 'unverified',
        mode: 'independent-provider',
        provider: provider.label,
        model: provider.model,
        score: 0,
        perConstraint: [],
        deductions: [],
        summary: `critique failed: ${(e as Error).message.slice(0, 160)}`,
      }
    }
  }

  // no provider configured: local model, FRESH context (no builder conversation),
  // honestly labeled as same-family. This is still far better than no critique:
  // the adversarial protocol + zero shared context removes the agreement bias.
  try {
    let raw = await callLlmJson(CRITIC_SYSTEM, userBlock, 75_000)
    let parsed = parseCritique(raw)
    if (!parsed) {
      raw = await callLlmJson(CRITIC_SYSTEM, userBlock + '\n\nSTRICT FORMAT REMINDER: reply with EXACTLY ONE valid JSON object and nothing else. No prose before or after.', 75_000)
      parsed = parseCritique(raw)
    }
    if (!parsed) throw new Error('critique output was not valid JSON')
    return {
      status: 'ok',
      mode: 'same-family-fresh-context',
      provider: 'royalred-local',
      model: 'royalred-core',
      ...parsed,
    }
  } catch (e) {
    return {
      status: 'unverified',
      mode: 'same-family-fresh-context',
      provider: 'royalred-local',
      model: 'royalred-core',
      score: 0,
      perConstraint: [],
      deductions: [],
      summary: `critique failed: ${(e as Error).message.slice(0, 160)}`,
    }
  }
}

// disagreement policy: |builder - critic| >= 2 means the two models genuinely
// disagree; the critic's deductions then feed a bounded regeneration request
export function disagreement(builderScore: number | null, critique: CritiqueResult | null): { disagree: boolean; delta: number } {
  if (builderScore === null || !critique || critique.status !== 'ok') return { disagree: false, delta: 0 }
  const delta = Math.abs(builderScore - critique.score)
  return { disagree: delta >= 2, delta: Math.round(delta * 10) / 10 }
}

// merge critic constraint verdicts into the ledger report (labeled method)
export function mergeCriticVerdicts(
  verdicts: ConstraintVerdict[],
  critique: CritiqueResult | null,
): ConstraintVerdict[] {
  if (!critique || critique.status !== 'ok') return verdicts
  const byCid = new Map(critique.perConstraint.map((c) => [c.cid, c]))
  return verdicts.map((v) => {
    if (v.method === 'deterministic' && v.verdict !== 'unclear') return v // kernel wins
    const c = byCid.get(v.cid)
    if (!c) return v
    return { cid: v.cid, verdict: c.verdict, method: 'critic', evidence: `${v.evidence} | critic: ${c.evidence}` }
  })
}
