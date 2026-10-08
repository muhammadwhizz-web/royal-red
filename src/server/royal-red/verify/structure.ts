// ROYAL RED structure gate (Round 6, Section 5.11 + 5.12).
//
// Deterministic checks over the artifact's files and a live-browser overlap
// scan at all three viewports. The gate exists because Round 6 made these
// laws hard requirements:
//   - a shipped site is MULTI-PAGE (home + about + contact + what the prompt
//     implies); single-page demos are a build failure
//   - SEO surfaces exist: title, meta description, Open Graph, robots.txt,
//     sitemap.xml, JSON-LD structured data
//   - accessibility baseline: html lang, image alts, labeled inputs, one h1
//   - OVERLAP: no visible element covers another on any viewport. This is a
//     hard gate before the crown seal can appear.
//
// The module is verification-ONLY (same discipline as visual.ts): it never
// mutates the artifact, and every failure is an honest, named finding.

import { withScopedBrowser, settlePage } from './browser'
import { VIEWPORTS, type ViewportId } from './visual'

export interface StructureCheck {
  name: string
  pass: boolean
  detail?: string
}

export interface OverlapPair {
  a: string
  b: string
  overlapPct: number // overlap area / smaller box area
  viewport: ViewportId
}

export interface StructureReport {
  runId: string
  artifactId: string
  pages: { path: string; title: string | null; hasMetaDescription: boolean; hasOg: boolean; hasJsonLd: boolean }[]
  checks: StructureCheck[]
  overlaps: OverlapPair[]
  score: number // 0-10 honest score over the check list
  status: 'pass' | 'partial' | 'fail'
  summary: string
}

// the page set a premium build must ship (entry + at least two more pages)
const REQUIRED_PAGE_HINTS = [/^about\.html?$/i, /^(contact|contact-us)\.html?$/i, /^(services|products|menu|portfolio|pricing|team|blog)\.html?$/i]

function parseHead(html: string): { title: string | null; hasMetaDescription: boolean; hasOg: boolean; hasJsonLd: boolean } {
  return {
    title: html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null,
    hasMetaDescription: /<meta[^>]+name=["']description["']/i.test(html),
    hasOg: /<meta[^>]+property=["']og:(title|description|image)["']/i.test(html),
    hasJsonLd: /application\/ld\+json/i.test(html),
  }
}

// static file-level checks (multi-page, seo, a11y)
export function structureChecksFromFiles(filesJson: string): { pages: StructureReport['pages']; checks: StructureCheck[] } {
  const files = JSON.parse(filesJson) as { path: string; content: string }[]
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path))
  const pages = htmlFiles.map((f) => ({ path: f.path, ...parseHead(f.content) }))
  const checks: StructureCheck[] = []

  // 1. multi-page law
  const pageNames = htmlFiles.map((f) => f.path.toLowerCase())
  const hasIndex = pageNames.some((p) => /(^|\/)index\.html?$/.test(p))
  const extraPages = pageNames.filter((p) => !/(^|\/)index\.html?$/.test(p))
  checks.push({ name: 'multi-page structure (>= 3 pages)', pass: hasIndex && extraPages.length >= 2, detail: `${htmlFiles.length} html pages` })
  const hintHits = REQUIRED_PAGE_HINTS.filter((h) => pageNames.some((p) => h.test(p.split('/').pop() ?? p))).length
  checks.push({ name: 'standard pages present (about / contact / one more)', pass: hasIndex && hintHits >= 2, detail: `${hintHits}/3 hint groups matched` })

  // 2. seo law
  const allTitled = pages.every((p) => p.title && p.title.length > 0)
  checks.push({ name: 'every page has a <title>', pass: allTitled && pages.length > 0, detail: pages.filter((p) => !p.title).map((p) => p.path).slice(0, 3).join(', ') })
  const allDesc = pages.every((p) => p.hasMetaDescription)
  checks.push({ name: 'every page has meta description', pass: allDesc && pages.length > 0 })
  const allOg = pages.every((p) => p.hasOg)
  checks.push({ name: 'open graph tags present', pass: allOg && pages.length > 0 })
  checks.push({ name: 'robots.txt ships', pass: files.some((f) => /robots\.txt$/i.test(f.path)) })
  checks.push({ name: 'sitemap.xml ships', pass: files.some((f) => /sitemap\.xml$/i.test(f.path)) })
  checks.push({ name: 'json-ld structured data present', pass: pages.some((p) => p.hasJsonLd) })

  // 3. accessibility baseline (static)
  const joined = htmlFiles.map((f) => f.content).join('\n')
  const imgs = joined.match(/<img\b[^>]*>/gi) ?? []
  const alts = imgs.filter((t) => /\balt=/i.test(t))
  checks.push({ name: 'images carry alt attributes', pass: imgs.length === 0 || alts.length === imgs.length, detail: `${alts.length}/${imgs.length}` })
  const inputs = joined.match(/<(input|textarea|select)\b[^>]*>/gi) ?? []
  const labeled = inputs.filter((t) => /\bid=/i.test(t) || /aria-label/i.test(t) || /aria-labelledby/i.test(t) || /placeholder=/i.test(t))
  checks.push({ name: 'form fields are labeled or carry aria', pass: inputs.length === 0 || labeled.length >= inputs.length * 0.8, detail: `${labeled.length}/${inputs.length}` })
  const h1Count = (joined.match(/<h1\b/gi) ?? []).length
  checks.push({ name: 'heading hierarchy (at least one h1)', pass: h1Count >= 1, detail: `${h1Count} h1` })
  const hasLang = htmlFiles.every((f) => /<html[^>]*\blang=/i.test(f.content))
  checks.push({ name: 'html lang attribute set', pass: hasLang && htmlFiles.length > 0 })

  return { pages, checks }
}

// overlap scan: a deterministic JS probe runs in the scoped browser at each
// viewport. Two visible, text-bearing leaf boxes (or images/buttons) that
// intersect by more than 25% of the smaller box, without one containing the
// other, are flagged. Parent-child and inline-flow neighbors are ignored.
const OVERLAP_JS = `(() => {
  const bad = new Set(['SCRIPT','STYLE','NOSCRIPT','META','LINK','TITLE','BR','PATH','SVG','CIRCLE','RECT','G','DEFS'])
  const els = [...document.querySelectorAll('body *')].filter((el) => {
    if (bad.has(el.tagName)) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) return false
    const hasText = (el.innerText || '').trim().length > 0
    const isMedia = ['IMG','BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(el.tagName)
    if (!hasText && !isMedia) return false
    // leaf-ish: no element children that themselves carry text/boxes
    const elChildren = [...el.children].filter((c) => !bad.has(c.tagName))
    return elChildren.length === 0 || isMedia
  })
  const boxes = els.map((el) => ({ el, r: el.getBoundingClientRect() }))
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j]
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue
      const x = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left))
      const y = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top))
      if (x <= 0 || y <= 0) continue
      const inter = x * y
      const smaller = Math.min(A.r.width * A.r.height, B.r.width * B.r.height)
      const pct = inter / smaller
      if (pct > 0.25) {
        const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0,2).join('.') : '')
        overlaps.push({ a: name(A.el), b: name(B.el), overlapPct: Math.round(pct * 100) / 100 })
      }
      if (overlaps.length >= 12) break
    }
    if (overlaps.length >= 12) break
  }
  return JSON.stringify(overlaps)
})()`

export async function verifyStructure(sessionId: string, artifactId: string, runId: string, filesJson: string): Promise<StructureReport> {
  const { pages, checks } = structureChecksFromFiles(filesJson)

  // live overlap scan at all three viewports
  const overlaps: OverlapPair[] = []
  const previewUrl = `http://localhost:3000/api/royal-red/preview/${artifactId}/index.html`
  for (const vp of VIEWPORTS) {
    try {
      await withScopedBrowser(async (b) => {
        await b.setViewport(vp.w, vp.h)
        await b.open(previewUrl)
        await settlePage(b)
        const raw = await b.evalJs(OVERLAP_JS)
        const found = JSON.parse(String(raw || '[]')) as Omit<OverlapPair, 'viewport'>[]
        overlaps.push(...found.map((f) => ({ ...f, viewport: vp.id as ViewportId })))
      })
    } catch {
      // the browser layer failing is an honest partial, not a fake pass
      checks.push({ name: `overlap scan (${vp.id})`, pass: false, detail: 'browser probe unavailable' })
      continue
    }
  }
  checks.push({
    name: 'overlap gate: no element covers another',
    pass: overlaps.length === 0,
    detail: overlaps.length ? overlaps.slice(0, 4).map((o) => `${o.viewport}: ${o.a} vs ${o.b} (${Math.round(o.overlapPct * 100)}%)`).join(' ; ') : 'clean at 3 viewports',
  })

  const passed = checks.filter((c) => c.pass).length
  const score = Math.round((passed / checks.length) * 10)
  const status: StructureReport['status'] = passed === checks.length ? 'pass' : passed >= checks.length * 0.6 ? 'partial' : 'fail'
  const failedNames = checks.filter((c) => !c.pass).map((c) => c.name)
  const summary =
    status === 'pass'
      ? `structure gate ${passed}/${checks.length}: multi-page, seo, a11y, overlap clean`
      : `structure gate ${passed}/${checks.length}: failing: ${failedNames.slice(0, 3).join(' ; ')}`

  return { runId, artifactId, pages, checks, overlaps, score, status, summary }
}
