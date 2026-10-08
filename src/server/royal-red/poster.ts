// ROYAL RED poster engine (Round 6, Section 7.2).
//
// Print-ready vector posters on A4, A3, Letter, Tabloid, or custom size.
// The layout engine is line-flow based: every element occupies computed,
// non-overlapping vertical boxes; content that does not fit flows to the
// next page whole. Two elements can never share space, which is the Round 6
// overlap law, and a test generates an intentionally overlong poster to
// prove the flow instead of an overlap.
//
// All text passes the text law before it reaches the PDF.

import { buildPdf, PAGE_SIZES, type PageSize, type PdfLine } from './pdf'
import { enforceTextLaw } from './text-law'

export interface PosterSpec {
  title: string
  subtitle?: string
  kicker?: string // small line above the title
  blocks: { heading: string; body: string }[]
  footer: string
  size?: PageSize
  accentWord?: string // a word highlighted by the gold rule treatment
}

export interface PosterResult {
  pdf: Buffer
  pages: number
  boxes: { page: number; element: string; top: number; height: number }[]
  size: PageSize
  textLawRewrites: number
}

export function buildPoster(spec: PosterSpec): PosterResult {
  const lawHits: string[] = []
  const law = (s: string) => {
    const r = enforceTextLaw(s)
    if (r.changed) lawHits.push(...r.violations)
    return r.text
  }

  const size = spec.size ?? 'A3'
  const dims = PAGE_SIZES[size]
  const lines: PdfLine[] = []
  const boxes: PosterResult['boxes'] = []

  // the layout estimate: page usable height / lead of each element, so the
  // engine knows which page each element lands on BEFORE emission
  const pageH = dims.h
  const margin = 54
  let page = 1
  let y = margin

  const place = (element: string, lead: number, push: () => void) => {
    if (y + lead > pageH - margin * 2) {
      page++
      y = margin
    }
    // screen-space top (from the page's top edge), matching buildPdf geometry:
    // the emitter starts at pageH - MARGIN and walks DOWN by each lead.
    // float precision on purpose: rounding here creates phantom 0.5pt overlaps
    boxes.push({ page, element, top: margin + y, height: lead })
    y += lead
    push()
  }

  if (spec.kicker) {
    const t = law(spec.kicker.toUpperCase())
    place('kicker', 14, () => lines.push({ text: t, style: 'sub' }))
    lines.push({ text: '', style: 'rule' })
  }
  {
    const title = law(spec.title)
    const lead = 36 + 6
    place('title', lead, () => lines.push({ text: title, style: 'display' }))
  }
  if (spec.subtitle) {
    const s = law(spec.subtitle)
    place('subtitle', 32, () => lines.push({ text: s, style: 'sub' }))
    place('gold rule', 12, () => lines.push({ text: '', style: 'rule' }))
  }
  for (const b of spec.blocks) {
    const h = law(b.heading)
    const body = law(b.body)
    place(`block: ${h.slice(0, 24)}`, 15 + 12 + Math.ceil(body.length / 44) * 11.5, () => {
      lines.push({ text: h, style: 'heading' })
      lines.push({ text: body, style: 'body' })
      lines.push({ text: '', style: 'rule' })
    })
  }
  {
    const f = law(spec.footer)
    place('footer', 22, () => lines.push({ text: f, style: 'dim' }))
  }

  const pdf = buildPdf(lines, {
    pageSize: size,
    footerNote: 'ROYAL RED POSTER',
  })

  return { pdf, pages: page, boxes, size, textLawRewrites: lawHits.length }
}
