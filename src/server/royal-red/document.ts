// ROYAL RED document engine (Round 6, Section 7.3).
//
// Reports, proposals, contracts, letters: a real typographic hierarchy
// (display title, subtitle, section headings, body, footnote), an
// AUTO-GENERATED table of contents with REAL page numbers (two-pass layout:
// pass one places the TOC with placeholder numbers and records where every
// heading lands; pass two re-renders with the true numbers; because the TOC
// line count is identical across passes, pagination is deterministic), and
// page-number footers.
//
// All text passes the text law before it reaches the PDF.

import { buildPdf, type PdfLine } from './pdf'
import { enforceTextLaw } from './text-law'

export interface DocumentSpec {
  title: string
  subtitle?: string
  author?: string
  date?: string
  sections: { heading: string; body: string }[]
  footerNote?: string
}

export interface DocumentResult {
  pdf: Buffer
  pages: number
  toc: { heading: string; page: number }[]
  textLawRewrites: number
}

export function buildDocument(spec: DocumentSpec): DocumentResult {
  const lawHits: string[] = []
  const law = (s: string) => {
    const r = enforceTextLaw(s)
    if (r.changed) lawHits.push(...r.violations)
    return r.text
  }

  const title = law(spec.title)
  const subtitle = spec.subtitle ? law(spec.subtitle) : null
  const sections = spec.sections.map((s) => ({ heading: law(s.heading), body: law(s.body) }))

  // front matter lines (title block + TOC skeleton) are fixed across passes
  const frontMatter = (): PdfLine[] => {
    const out: PdfLine[] = []
    out.push({ text: title, style: 'display' })
    if (subtitle) out.push({ text: subtitle, style: 'sub' })
    out.push({ text: '', style: 'rule' })
    const meta = [spec.author, spec.date].filter(Boolean).join(' / ')
    if (meta) out.push({ text: meta, style: 'dim' })
    out.push({ text: '', style: 'body' })
    out.push({ text: 'CONTENTS', style: 'heading' })
    return out
  }

  const tocLines = (numbers: number[] | null): PdfLine[] =>
    sections.map((s, i) => ({
      text: s.heading,
      style: 'toc' as const,
      tocPage: numbers ? numbers[i] : undefined,
    }))

  const bodyLines = (): PdfLine[] => {
    const out: PdfLine[] = []
    for (const s of sections) {
      out.push({ text: s.heading, style: 'heading' })
      out.push({ text: s.body, style: 'body' })
      out.push({ text: '', style: 'body' })
    }
    return out
  }

  // PASS 1: TOC present with placeholder numbers, so pagination matches pass 2
  let headingPages: { page: number; text: string }[] = []
  buildPdf([...frontMatter(), ...tocLines(null), { text: '', style: 'body' }, ...bodyLines()], {
    pageSize: 'Letter',
    footerNote: spec.footerNote ?? 'ROYAL RED DOCUMENT',
    headerTitle: 'ROYAL RED DOCUMENT',
    info: {
      title: spec.title,
      author: spec.author ?? 'Royal Red',
      subject: 'Royal Red document',
      keywords: 'royal red, document, verified',
    },
    onPageMap: (entries) => {
      headingPages = entries
    },
  })

  // resolve each section heading's REAL page (first pass counted title/heading
  // lines; match by text so TOC entries carry true page numbers)
  const toc = sections.map((s) => {
    const hit = headingPages.find((e) => e.text === s.heading)
    return { heading: s.heading, page: hit?.page ?? 1 }
  })

  // PASS 2: same layout, real numbers
  const pdf = buildPdf([...frontMatter(), ...tocLines(toc.map((t) => t.page)), { text: '', style: 'body' }, ...bodyLines()], {
    pageSize: 'Letter',
    footerNote: spec.footerNote ?? 'ROYAL RED DOCUMENT',
    headerTitle: 'ROYAL RED DOCUMENT',
    info: {
      title: spec.title,
      author: spec.author ?? 'Royal Red',
      subject: 'Royal Red document',
      keywords: 'royal red, document, verified',
    },
  })

  // honest page count: read it from the emitted /Count
  const countMatch = pdf.toString('latin1').match(/\/Count (\d+)/)
  return { pdf, pages: countMatch ? Number(countMatch[1]) : 1, toc, textLawRewrites: lawHits.length }
}
