// AWON competitor benchmark (Phase 2.4).
//
// A category taxonomy + a FIXED feature matrix schema so results are
// comparable across runs and categories - never "10 random sites compared on
// vibes". Every check is deterministic (DOM probes, accessibility audit,
// performance API) and evaluated identically for AWON's artifact and every
// competitor URL. The report states scores, per-check wins/losses and honest
// "inaccessible" rows - it never inflates.
import { withScopedBrowser, settlePage } from './browser'

export const TAXONOMY = [
  { id: 'saas-landing', label: 'SaaS landing', hints: 'saas product landing page marketing site' },
  { id: 'ecommerce', label: 'E-commerce', hints: 'online shop product store' },
  { id: 'portfolio', label: 'Portfolio', hints: 'designer photographer portfolio site' },
  { id: 'blog', label: 'Blog / editorial', hints: 'blog magazine editorial site' },
  { id: 'restaurant', label: 'Restaurant', hints: 'restaurant cafe menu site' },
  { id: 'docs', label: 'Docs', hints: 'documentation developer docs site' },
  { id: 'dashboard', label: 'Dashboard / app', hints: 'web app dashboard interface' },
  { id: 'agency', label: 'Agency', hints: 'creative agency studio site' },
  { id: 'event', label: 'Event', hints: 'conference event site' },
  { id: 'nonprofit', label: 'Nonprofit', hints: 'nonprofit organization charity site' },
] as const

export type TaxonomyId = (typeof TAXONOMY)[number]['id']

export interface MatrixCheck {
  id: string
  label: string
  max: number
  layer: 'dom' | 'a11y' | 'perf'
  // dom checks: a JS expression evaluated in the live page, must return a
  // JSON-serializable truthy value or a number 0..max
  expr?: string
}

// THE MATRIX: 20 checks x 3 points = 60. Fixed schema; new checks append, they
// never mutate existing ids (comparability across runs is the whole point).
export const MATRIX: MatrixCheck[] = [
  { id: 'semantic-nav', label: 'semantic header/nav landmarks', max: 3, layer: 'dom', expr: '(() => { const h = document.querySelector("header,nav,[role=banner],[role=navigation]"); return h ? 3 : 0 })()' },
  { id: 'hero', label: 'hero section with headline', max: 3, layer: 'dom', expr: '(() => { const h1 = document.querySelector("h1"); const sect = document.querySelector("section,header,main"); return h1 && h1.textContent.trim().length > 3 && sect ? 3 : 0 })()' },
  { id: 'footer', label: 'real footer content', max: 3, layer: 'dom', expr: '(() => { const f = document.querySelector("footer,[role=contentinfo]"); return f && f.textContent.trim().length > 40 ? 3 : 0 })()' },
  { id: 'cta', label: 'prominent call-to-action buttons', max: 3, layer: 'dom', expr: '(() => { const els = [...document.querySelectorAll("a,button")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 36 }); return els.length >= 2 ? 3 : 0 })()' },
  { id: 'viewport-meta', label: 'responsive viewport meta', max: 3, layer: 'dom', expr: '(() => { const m = document.querySelector("meta[name=viewport]"); return m ? 3 : 0 })()' },
  { id: 'images-load', label: 'all images load successfully', max: 3, layer: 'dom', expr: '(() => { const imgs = [...document.images]; if (!imgs.length) return 3; const bad = imgs.filter(i => !i.complete || i.naturalWidth === 0).length; return bad === 0 ? 3 : (imgs.length - bad) / imgs.length * 3 })()' },
  { id: 'alt-text', label: 'image alt text coverage', max: 3, layer: 'dom', expr: '(() => { const imgs = [...document.images]; if (!imgs.length) return 3; const ok = imgs.filter(i => (i.alt || "").trim().length > 0).length; return ok / imgs.length * 3 })()' },
  { id: 'headings', label: 'sane heading hierarchy (one h1)', max: 3, layer: 'dom', expr: '(() => { const h1 = document.querySelectorAll("h1").length; const h2 = document.querySelectorAll("h2,h3").length; return h1 === 1 && h2 >= 1 ? 3 : h1 >= 1 ? 1.5 : 0 })()' },
  { id: 'contact', label: 'contact channel (form/mailto/tel)', max: 3, layer: 'dom', expr: '(() => { const hasForm = !!document.querySelector("form input,form textarea"); const hasLink = [...document.querySelectorAll("a")].some(a => /^(mailto:|tel:)/.test(a.getAttribute("href") || "")); return hasForm || hasLink ? 3 : 0 })()' },
  { id: 'social', label: 'social/external links', max: 3, layer: 'dom', expr: '(() => { const n = [...document.querySelectorAll("a[href^=https]")].filter(a => /twitter|x\.com|linkedin|instagram|github|facebook|youtube|dribbble|behance/i.test(a.href)).length; return n > 0 ? 3 : 0 })()' },
  { id: 'dark-mode', label: 'dark/light mode capability', max: 3, layer: 'dom', expr: '(() => { const t = document.documentElement.getAttribute("data-theme") || document.documentElement.className || ""; const btn = [...document.querySelectorAll("button,[role=button],a")].some(e => /theme|dark|light|moon|sun/i.test(e.textContent || "") || /theme|dark|light|moon|sun/i.test(e.className || "")); const css = [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.media && /prefers-color-scheme/.test(r.media.mediaText)) } catch { return false } }); return btn || css || /dark/.test(t) ? 3 : 0 })()' },
  { id: 'favicon', label: 'favicon defined', max: 3, layer: 'dom', expr: '(() => { return document.querySelector("link[rel*=icon]") ? 3 : 0 })()' },
  { id: 'og-tags', label: 'Open Graph / social meta', max: 3, layer: 'dom', expr: '(() => { const n = document.querySelectorAll("meta[property^=og:],meta[name^=twitter:]").length; return n >= 2 ? 3 : n === 1 ? 1.5 : 0 })()' },
  { id: 'lazy-img', label: 'lazy-loaded imagery', max: 3, layer: 'dom', expr: '(() => { const imgs = [...document.images]; if (!imgs.length) return 3; const lazy = imgs.filter(i => i.loading === "lazy").length; return lazy / imgs.length * 3 })()' },
  { id: 'custom-font', label: 'custom webfont identity', max: 3, layer: 'dom', expr: '(() => { const link = [...document.querySelectorAll("link[href*=fonts],link[href*=font]")].length; const loaded = document.fonts ? document.fonts.size >= 1 : false; return link > 0 || loaded ? 3 : 0 })()' },
  { id: 'motion', label: 'motion / micro-animations defined', max: 3, layer: 'dom', expr: '(() => { let anim = 0; for (const s of document.styleSheets) { try { for (const r of s.cssRules) { if (r.type === CSSRule.KEYFRAMES_RULE || (r.style && (r.style.transition || r.style.animation))) anim++ } } catch {} } return anim > 0 ? 3 : 0 })()' },
  { id: 'form-labels', label: 'labeled form controls', max: 3, layer: 'dom', expr: '(() => { const inputs = [...document.querySelectorAll("input,textarea,select")]; if (!inputs.length) return 3; const ok = inputs.filter(i => i.labels?.length || i.getAttribute("aria-label") || i.placeholder).length; return ok / inputs.length * 3 })()' },
  { id: 'no-console-errors', label: 'clean console (no page errors)', max: 3, layer: 'dom', expr: 'return 3 // evaluated separately via error capture' },
  { id: 'a11y-audit', label: 'axe accessibility violations (3:0-2, 2:<=5, 1:<=15, 0:more)', max: 3, layer: 'a11y' },
  { id: 'page-weight', label: 'page weight budget (<1.5MB:3, <3MB:2, <5MB:1)', max: 3, layer: 'perf' },
]

export interface SiteScore {
  url: string
  label: string
  accessible: boolean
  scores: Record<string, number> // checkId -> points
  total: number
  error?: string
}

export interface BenchmarkReport {
  category: TaxonomyId
  categoryLabel: string
  runId: string
  matrix: { id: string; label: string; max: number }[]
  awon: SiteScore | null
  competitors: SiteScore[]
  competitorAvg: number
  awonTotal: number
  verdict: { wins: string[]; losses: string[] }
  generatedAt: string
}

function scoreFromLayer(check: MatrixCheck, ctx: { dom: Record<string, string>; a11yViolations: number; transferBytes: number; consoleErrors: boolean }): number {
  if (check.layer === 'a11y') {
    const v = ctx.a11yViolations
    return v <= 2 ? 3 : v <= 5 ? 2 : v <= 15 ? 1 : 0
  }
  if (check.layer === 'perf') {
    const mb = ctx.transferBytes / 1048576
    return mb < 1.5 ? 3 : mb < 3 ? 2 : mb < 5 ? 1 : 0
  }
  if (check.id === 'no-console-errors') return ctx.consoleErrors ? 0 : 3
  const raw = ctx.dom[check.id]
  if (raw === undefined) return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(check.max, Math.round(n * 10) / 10))
}

const DOM_EXPRS = MATRIX.filter((m) => m.layer === 'dom' && m.expr && m.id !== 'no-console-errors')

async function auditSite(
  url: string,
  label: string,
  opts: { mobileProbe?: boolean } = {},
): Promise<SiteScore> {
  const scores: Record<string, number> = {}
  let a11yViolations = 999
  let transferBytes = 0
  let consoleHadErrors = false
  try {
    await withScopedBrowser(async (b) => {
      await b.setViewport(1440, 900)
      await b.setMedia('light', true)
      await b.open(url)
      await settlePage(b, 1400)
      for (const c of DOM_EXPRS) {
        try {
          scores[c.id] = await b.evalJs(c.expr!)
        } catch {
          scores[c.id] = '0'
        }
      }
      // page weight via performance API
      try {
        transferBytes = Number(await b.evalJs('performance.getEntriesByType("resource").concat(performance.getEntriesByType("navigation")).reduce((s,e) => s + (e.transferSize || 0), 0)')) || 0
      } catch {}
      // axe audit
      try {
        const ax = await b.a11yJson()
        const parsed = JSON.parse(ax) as { violations?: unknown[] }
        a11yViolations = parsed.violations?.length ?? 999
      } catch {
        a11yViolations = 999
      }
      const errs = await b.errors().catch(() => '')
      consoleHadErrors = errs.length > 0 && !/no (page )?errors/i.test(errs)
    })
  } catch (e) {
    return { url, label, accessible: false, scores: {}, total: 0, error: (e as Error).message.slice(0, 160) }
  }
  for (const c of MATRIX) {
    scores[c.id] = scoreFromLayer(c, { dom: scores, a11yViolations, transferBytes, consoleErrors: consoleHadErrors })
  }
  const total = MATRIX.reduce((s, c) => s + (scores[c.id] ?? 0), 0)
  return { url, label, accessible: true, scores, total: Math.round(total * 10) / 10 }
}

// competitor discovery: web search for strong examples of the category
export async function discoverCompetitors(category: TaxonomyId, num = 10): Promise<{ url: string; label: string }[]> {
  const cat = TAXONOMY.find((t) => t.id === category) ?? TAXONOMY[0]
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const results = (await zai.functions.invoke('web_search', {
      query: `best ${cat.hints} examples award winning websites`,
      num: num + 4,
    })) as { name: string; url: string }[]
    const seen = new Set<string>()
    const out: { url: string; label: string }[] = []
    for (const r of results) {
      try {
        const u = new URL(r.url)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
        const host = u.hostname.replace(/^www\./, '')
        if (seen.has(host)) continue
        // never scan our own origin, localhost, or metadata targets
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.startsWith('169.254.')) continue
        seen.add(host)
        out.push({ url: `${u.protocol}//${u.hostname}`, label: (r.name || host).slice(0, 80) })
        if (out.length >= num) break
      } catch {}
    }
    return out
  } catch {
    return []
  }
}

export async function runBenchmark(
  category: TaxonomyId,
  awonPreviewUrl: string,
  runId: string,
  competitorUrls?: { url: string; label: string }[],
): Promise<BenchmarkReport> {
  const cat = TAXONOMY.find((t) => t.id === category) ?? TAXONOMY[0]
  const sites = competitorUrls?.length ? competitorUrls : await discoverCompetitors(category)
  // bounded: at most 10 competitor audits, each under the scoped browser's
  // own hard timeouts
  const bounded = sites.slice(0, 10)

  const [awonScore, ...competitors] = await Promise.all([
    auditSite(awonPreviewUrl, 'AWON build'),
    ...bounded.map((s) => auditSite(s.url, s.label)),
  ])

  const accessible = competitors.filter((c) => c.accessible)
  const competitorAvg = accessible.length
    ? Math.round((accessible.reduce((s, c) => s + c.total, 0) / accessible.length) * 10) / 10
    : 0

  const wins: string[] = []
  const losses: string[] = []
  if (awonScore?.accessible && accessible.length) {
    for (const c of MATRIX) {
      const mine = awonScore.scores[c.id] ?? 0
      const avg = accessible.reduce((s, x) => s + (x.scores[c.id] ?? 0), 0) / accessible.length
      if (mine >= avg + 1) wins.push(`${c.label} (${Math.round(mine)} vs ${Math.round(avg)} avg)`)
      else if (mine <= avg - 1) losses.push(`${c.label} (${Math.round(mine)} vs ${Math.round(avg)} avg)`)
    }
  }

  return {
    category,
    categoryLabel: cat.label,
    runId,
    matrix: MATRIX.map((m) => ({ id: m.id, label: m.label, max: m.max })),
    awon: awonScore,
    competitors,
    competitorAvg,
    awonTotal: awonScore?.total ?? 0,
    verdict: { wins: wins.slice(0, 8), losses: losses.slice(0, 8) },
    generatedAt: new Date().toISOString(),
  }
}
