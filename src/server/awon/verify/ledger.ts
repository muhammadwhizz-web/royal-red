// AWON constraint ledger (Phase 2.1). The kernel extracts a structured,
// testable constraint list from the user prompt BEFORE the build starts.
// Each constraint gets a stable id (C1..), a category, a testable assertion
// and an evaluation strategy. At verification time every constraint is graded
// INDIVIDUALLY with receipts - never collapsed into a single vibe score.
//
// Deterministic checks always run in the kernel (the LLM never decides
// security-adjacent facts); only explicitly semantic constraints are graded
// by the critic model, and their verdicts are labeled as such.
import { db } from '@/lib/db'

export type LedgerCategory = 'feature' | 'style' | 'content' | 'technical' | 'exclusion'

export interface LedgerItem {
  cid: string
  category: LedgerCategory
  text: string
  assertion: string
  weight: 1 | 2
  eval: 'auto' | 'semantic'
}

export interface ConstraintVerdict {
  cid: string
  verdict: 'pass' | 'fail' | 'unclear'
  evidence: string
  method: 'deterministic' | 'critic' | 'builder'
}

export interface LedgerReport {
  items: LedgerItem[]
  verdicts: ConstraintVerdict[]
  passed: number
  failed: number
  unclear: number
}

const EXTRACTION_SYSTEM = `You extract a constraint ledger from a user's product request for the AWON verification system. Reply with EXACTLY ONE JSON object:
{"constraints":[{"category":"feature|style|content|technical|exclusion","text":"requirement in the user's words","assertion":"a concrete testable assertion","weight":1}]}
Rules:
- category "exclusion" is for things the user explicitly banned ("no lorem ipsum", "never use purple"); everything else uses its natural category.
- "assertion" must be objectively checkable against the finished site: name the observable fact, e.g. "entry html contains a nav with links to all pages", not "looks nice".
- weight 2 ONLY when the user emphasizes a requirement ("must", "has to be", ALL CAPS, "IMPORTANT").
- Include 3-8 constraints. Never invent requirements the user did not state. Every spoken requirement maps to one constraint; merge near-duplicates.
- If the user specified nothing beyond "build a site", extract their few implicit basics only (a complete multi-section site, responsive, no filler text). Never pad.
- No markdown, no commentary. JSON only.`

function parseLedgerJson(raw: string): LedgerItem[] {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { constraints?: unknown }
    if (!Array.isArray(parsed.constraints)) return []
    const out: LedgerItem[] = []
    const cats = new Set(['feature', 'style', 'content', 'technical', 'exclusion'])
    let n = 0
    for (const c of parsed.constraints) {
      if (!c || typeof c !== 'object') continue
      const o = c as Record<string, unknown>
      const text2 = String(o.text ?? '').trim().slice(0, 400)
      const assertion = String(o.assertion ?? '').trim().slice(0, 400)
      const category = String(o.category ?? 'feature')
      if (!text2 || !assertion || !cats.has(category)) continue
      n++
      out.push({
        cid: `C${n}`,
        category: category as LedgerCategory,
        text: text2,
        assertion,
        weight: Number(o.weight) === 2 ? 2 : 1,
        eval: 'auto',
      })
    }
    return out.slice(0, 10)
  } catch {
    return []
  }
}

export async function callLlmJson(system: string, user: string, timeoutMs = 45_000): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const completion = (await Promise.race([
    zai.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('ledger extraction timed out')), timeoutMs)),
  ])) as { choices?: { message?: { content?: string } }[] }
  return completion.choices?.[0]?.message?.content ?? ''
}

// ---- deterministic evaluators (kernel decides; the model never does) ----

export interface ArtifactSnapshot {
  entry: string
  files: { path: string; content: string }[]
  html: string // entry html concatenated text (all text-ish files joined)
}

export function artifactSnapshot(files: { path: string; content: string }[], entry: string): ArtifactSnapshot {
  const htmlFiles = files.filter((f) => /\.(html?|css|js|md|json|txt)$/i.test(f.path))
  const entryFile = files.find((f) => f.path === entry) ?? files.find((f) => /\.html?$/i.test(f.path))
  return {
    entry,
    files,
    html: [entryFile?.content ?? '', ...htmlFiles.map((f) => f.content)].join('\n'),
  }
}

export type AutoCheck = (a: ArtifactSnapshot) => { pass: boolean; evidence: string }

// the deterministic checker registry: every check maps a phrase family from
// assertions onto an exact scan of the artifact. Bounded and auditable.
export const AUTO_CHECKS: { id: string; test: RegExp; check: AutoCheck; label: string }[] = [
  {
    id: 'no-em-dash',
    label: 'no em dashes in copy',
    test: /em[- ]?dash|no em dashes?/i,
    check: (a) => {
      const hits = [...a.html.matchAll(/[—–]/g)].length
      return { pass: hits === 0, evidence: hits === 0 ? '0 em/en dashes across delivered files' : `${hits} em/en dash characters found` }
    },
  },
  {
    id: 'no-lorem',
    label: 'no lorem ipsum filler',
    test: /lorem ipsum|no filler|no placeholder text/i,
    check: (a) => {
      const hits = /lorem ipsum/i.test(a.html)
      return { pass: !hits, evidence: hits ? 'lorem ipsum text found' : 'no lorem ipsum present' }
    },
  },
  {
    id: 'dark-mode',
    label: 'dark + light mode toggle',
    test: /dark (and|\/|or) light|dark mode|light mode|theme toggle/i,
    check: (a) => {
      const t = a.html
      const hasToggle = /data-theme|classlist.*dark|\.dark\b|toggle.*theme|theme.*toggle|moon|sun/i.test(t)
      const hasScheme = /prefers-color-scheme/.test(t)
      const hasPersist = /localstorage/i.test(t)
      const pass = hasToggle && (hasScheme || hasPersist)
      return {
        pass,
        evidence: `toggle-code=${hasToggle}, scheme-or-persist=${hasScheme || hasPersist}`,
      }
    },
  },
  {
    id: 'cms-page',
    label: 'admin CMS panel page present',
    test: /cms|admin (panel|page|dashboard)|management (panel|view)/i,
    check: (a) => {
      const cmsFile = a.files.find((f) => /cms\.html?$/i.test(f.path))
      const linked = /cms\.html/i.test(a.html)
      const hasCrud = cmsFile ? /localstorage|fetch|create|edit|delete/i.test(cmsFile.content) : false
      return { pass: !!cmsFile, evidence: cmsFile ? `cms file present, crud code=${hasCrud}, linked from site=${linked}` : 'no cms.html in artifact' }
    },
  },
  {
    id: 'responsive-meta',
    label: 'responsive viewport setup',
    test: /responsive|mobile/i,
    check: (a) => {
      const hasMeta = /<meta[^>]+viewport/i.test(a.html)
      const hasMedia = /@media/.test(a.html)
      return { pass: hasMeta && hasMedia, evidence: `viewport-meta=${hasMeta}, media-queries=${hasMedia}` }
    },
  },
  {
    id: 'seo-og',
    label: 'SEO meta + Open Graph tags',
    test: /seo|open graph|og:|meta description/i,
    check: (a) => {
      const hasDesc = /<meta[^>]+name=["']description/i.test(a.html)
      const hasOg = /<meta[^>]+property=["']og:/i.test(a.html)
      const hasTitle = /<title>[\s\S]{2,}<\/title>/i.test(a.html)
      return { pass: hasDesc && hasOg && hasTitle, evidence: `description=${hasDesc}, og=${hasOg}, title=${hasTitle}` }
    },
  },
  {
    id: 'favicon',
    label: 'favicon present',
    test: /favicon/i,
    check: (a) => {
      const has = /<link[^>]+icon/i.test(a.html)
      return { pass: has, evidence: has ? 'icon link tag found in entry html' : 'no icon link tag' }
    },
  },
  {
    id: 'google-fonts',
    label: 'google fonts pairing loaded',
    test: /google fonts|font pairing|display font/i,
    check: (a) => {
      const has = /fonts\.googleapis\.com/i.test(a.html)
      const fallback = /font-family[^;]+serif|sans-serif/i.test(a.html)
      return { pass: has && fallback, evidence: `fonts-link=${has}, fallbacks=${fallback}` }
    },
  },
  {
    id: 'custom-palette',
    label: 'custom css-variable palette (no default blue/purple)',
    test: /custom (palette|colors?)|css variables?|not (default )?(blue|purple)|distinctive colou?rs?/i,
    check: (a) => {
      const hasVars = /--[\w-]+:\s*#?[0-9a-z]/i.test(a.html)
      const defaultBlue = /#3b82f6|#6366f1|#8b5cf6/i.test(a.html)
      return { pass: hasVars && !defaultBlue, evidence: `css-vars=${hasVars}, default-blue/purple-classes=${defaultBlue}` }
    },
  },
  {
    id: 'no-external-js',
    label: 'no external JS beyond fonts (works from disk)',
    test: /works? from disk|relative paths?|no external/i,
    check: (a) => {
      const scripts = [...a.html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
      const bad = scripts.filter((s) => /^https?:\/\//i.test(s))
      return { pass: bad.length === 0, evidence: bad.length ? `external scripts: ${bad.slice(0, 3).join(', ')}` : `${scripts.length} script refs, all relative/inline` }
    },
  },
  {
    id: 'multi-page',
    label: 'multiple pages linked together',
    test: /multi(ple|-)? ?page|pages linked|nav(igation)? between/i,
    check: (a) => {
      const pages = a.files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path)
      const linked = pages.filter((p) => a.html.includes(p)).length
      return { pass: pages.length >= 2 && linked >= 2, evidence: `${pages.length} html pages (${pages.slice(0, 5).join(', ')}), ${linked} referenced from entry` }
    },
  },
  {
    id: 'contact-form',
    label: 'contact form present',
    test: /contact (form|page)|form/i,
    check: (a) => {
      const has = /<form[\s>]/i.test(a.html)
      const inputs = (a.html.match(/<input/gi) ?? []).length + (a.html.match(/<textarea/gi) ?? []).length
      return { pass: has && inputs >= 2, evidence: `form-tag=${has}, input-count=${inputs}` }
    },
  },
  {
    id: 'pricing-table',
    label: 'pricing section/table present',
    test: /pricing|plans? (table|section)/i,
    check: (a) => {
      const has = /pricing|plans?/i.test(a.html)
      return { pass: has, evidence: has ? 'pricing/plans section found in copy' : 'no pricing section' }
    },
  },
  {
    id: 'a11y-alt',
    label: 'all images carry alt text',
    test: /alt text|alt attributes|accessib/i,
    check: (a) => {
      const imgs = [...a.html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
      const noAlt = imgs.filter((t) => !/\balt=/i.test(t))
      return { pass: imgs.length === 0 || noAlt.length === 0, evidence: `${imgs.length} img tags, ${noAlt.length} missing alt` }
    },
  },
  {
    id: 'aria-labels',
    label: 'aria labels / focus states',
    test: /aria|focus states?/i,
    check: (a) => {
      const has = /aria-|:focus/i.test(a.html)
      return { pass: has, evidence: has ? 'aria attributes or focus styles present' : 'no aria/focus styles found' }
    },
  },
]

// grade the auto-evaluable constraints deterministically; anything that does
// not map onto a checker is returned for semantic (critic) evaluation instead
// of being silently guessed
export function autoGrade(item: LedgerItem, a: ArtifactSnapshot): { done: boolean; verdict: ConstraintVerdict } {
  if (item.category === 'exclusion' && !AUTO_CHECKS.some((c) => c.test.test(item.assertion))) {
    // generic exclusion: the assertion itself names the banned thing; scan for it
    const banned = item.assertion.replace(/^(the )?(site|page|copy) (must|should) (not )?(contain|use|include)\s*/i, '').replace(/["']/g, '').trim()
    if (banned.length >= 3) {
      const re = new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      const hit = re.test(a.html)
      return { done: true, verdict: { cid: item.cid, verdict: hit ? 'fail' : 'pass', method: 'deterministic', evidence: hit ? `banned phrase "${banned}" found in artifact text` : `"${banned}" absent from all delivered files` } }
    }
  }
  const matcher = AUTO_CHECKS.find((c) => c.test.test(item.assertion) || c.test.test(item.text))
  if (!matcher) return { done: false, verdict: { cid: item.cid, verdict: 'unclear', method: 'deterministic', evidence: 'no deterministic checker maps to this assertion' } }
  const r = matcher.check(a)
  return { done: true, verdict: { cid: item.cid, verdict: r.pass ? 'pass' : 'fail', method: 'deterministic', evidence: `${matcher.label}: ${r.evidence}` } }
}

// ---- persistence ----

export async function saveLedger(sessionId: string, items: LedgerItem[]): Promise<void> {
  await db.awonConstraint.deleteMany({ where: { sessionId, source: 'extracted' } })
  if (!items.length) return
  await db.awonConstraint.createMany({
    data: items.map((i) => ({
      sessionId,
      cid: i.cid,
      category: i.category,
      text: i.text,
      assertion: i.assertion,
      weight: i.weight,
      source: 'extracted',
    })),
  })
}

export async function loadLedger(sessionId: string): Promise<LedgerItem[]> {
  const rows = await db.awonConstraint.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({
    cid: r.cid,
    category: r.category as LedgerCategory,
    text: r.text,
    assertion: r.assertion,
    weight: r.weight === 2 ? 2 : 1,
    eval: 'auto' as const,
  }))
}

// extract constraints from a (possibly follow-up) build command and MERGE
// them into the session ledger: existing entries survive, near-duplicates are
// dropped by normalized text, cid numbering continues (C4... after C3)
export async function extractAndSaveLedger(sessionId: string, userPrompt: string): Promise<LedgerItem[]> {
  try {
    const existing = await loadLedger(sessionId)
    const raw = await callLlmJson(
      EXTRACTION_SYSTEM,
      `USER REQUEST: ${userPrompt.slice(0, 3000)}`,
    )
    const fresh = parseLedgerJson(raw)
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const seen = new Set(existing.map((e) => norm(e.text)))
    const merged = [...existing]
    for (const f of fresh) {
      if (seen.has(norm(f.text))) continue
      seen.add(norm(f.text))
      merged.push({ ...f, cid: `C${merged.length + 1}` })
    }
    // renumber to be stable + contiguous after any cleanup
    const renumbered = merged.map((m, i) => ({ ...m, cid: `C${i + 1}` }))
    await saveLedger(sessionId, renumbered)
    return renumbered
  } catch {
    return []
  }
}

// render the ledger for injection into the builder system context so the
// builder knows exactly what it will be graded on
export function ledgerForBuilder(items: LedgerItem[]): string {
  if (!items.length) return ''
  return [
    'CONSTRAINT LEDGER (the verification engine will grade the finished artifact per constraint; report per-constraint receipts):',
    ...items.map((i) => `- [${i.cid}] (${i.category}${i.weight === 2 ? ', MUST' : ''}) ${i.text} :: check: ${i.assertion}`),
    'Build exactly like the normal build loop: one file or one 60-80 line chunk per turn. Never attempt a whole page in one response.',
  ].join('\n')
}
