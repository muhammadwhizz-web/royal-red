// ROYAL RED PDF writer (Phase A): dependency-free PDF 1.4 with embedded
// TrueType subsets. Every font is parsed, subsetted, and shipped inside the
// file (CIDFontType2 + Identity-H + ToUnicode), so documents render
// identically in every viewer with zero missing-font warnings. Text layout
// uses real glyph advance widths, never an average-char approximation.
//
// Powers transcripts, posters, documents, and the generated installation
// guide. No external deps, same spirit as zip.ts and pdf-fonts.ts.
//
// Design law kept from Round 6: content NEVER overlaps; a line that does not
// fit flows to the next page whole.

import fs from 'fs'
import path from 'path'
import { loadFont, buildSubset, type EmbeddedFont } from './pdf-fonts'

const MARGIN = 54
export const PAGE_SIZES = {
  Letter: { w: 612, h: 792 },
  A4: { w: 595, h: 842 },
  A3: { w: 842, h: 1191 },
  Tabloid: { w: 792, h: 1224 },
} as const
export type PageSize = keyof typeof PAGE_SIZES

// brand palette (Phase A): warm ivory page, deep royal red headings,
// charcoal body, gold accents
const IVORY = [0.98, 0.961, 0.941]
const RED = [0.498, 0.114, 0.114] // #7f1d1d deep royal red
const CHARCOAL = [0.165, 0.137, 0.125] // #2a2320
const GRAY = [0.42, 0.384, 0.349]
const GOLD = [0.631, 0.384, 0.027] // #a16207
const GOLD_SOFT = [0.85, 0.72, 0.45]
const CODE_BG = [0.937, 0.906, 0.859] // warm code panel

type FontKey = 'displayBold' | 'displaySemi' | 'sans' | 'sansSemi' | 'mono' | 'monoMed'

const FONT_FILES: Record<FontKey, string> = {
  displayBold: 'CormorantGaramond-Bold.ttf',
  displaySemi: 'CormorantGaramond-SemiBold.ttf',
  sans: 'Inter-Regular.ttf',
  sansSemi: 'Inter-SemiBold.ttf',
  mono: 'JetBrainsMono-Regular.ttf',
  monoMed: 'JetBrainsMono-Medium.ttf',
}

export type PdfStyle =
  | 'display'
  | 'title'
  | 'sub'
  | 'heading'
  | 'body'
  | 'dim'
  | 'rule'
  | 'chart'
  | 'code'
  | 'toc'
  | 'goldlabel'

interface StyleSpec {
  font: FontKey
  size: number
  lead: number
  color: number[]
}

const STYLE_MAP: Record<Exclude<PdfStyle, 'rule' | 'chart'>, StyleSpec> = {
  display: { font: 'displayBold', size: 34, lead: 40, color: RED },
  title: { font: 'displaySemi', size: 16, lead: 20, color: RED },
  sub: { font: 'sansSemi', size: 12, lead: 17, color: CHARCOAL },
  heading: { font: 'displaySemi', size: 12, lead: 17, color: RED },
  body: { font: 'sans', size: 9.5, lead: 13.5, color: CHARCOAL },
  dim: { font: 'sans', size: 8.5, lead: 11.5, color: GRAY },
  code: { font: 'mono', size: 8.5, lead: 12.5, color: CHARCOAL },
  toc: { font: 'sans', size: 10, lead: 14.5, color: CHARCOAL },
  goldlabel: { font: 'monoMed', size: 7, lead: 10, color: GOLD },
}

export interface BuildPdfOptions {
  pageSize?: PageSize
  footerNote?: string
  /** receives the page index of every title/heading line (two-pass TOC) */
  onPageMap?: (entries: { page: number; text: string }[]) => void
  /** PDF metadata dictionary */
  info?: { title?: string; author?: string; subject?: string; keywords?: string }
  /** running header: fallback text for the left side (right side is ROYAL RED) */
  headerTitle?: string
  /** vector crown drawn on the first page; cx = center x, yTop = crown top y */
  crown?: { cx: number; yTop: number; scale: number }
  /** no header/footer on page 1 (cover pages) */
  suppressChromeOnFirstPage?: boolean
}

export interface PdfLine {
  text: string
  style: PdfStyle
  /** heading lines declare the active section for the running header */
  section?: string
  /** toc style: the right-aligned page number */
  tocPage?: number
  /** cover alignment */
  align?: 'left' | 'center' | 'right'
  /** start a fresh page before this line (cover, TOC, major breaks) */
  pageBreakBefore?: boolean
}

interface LayoutLine {
  fontKey: FontKey
  style: PdfStyle
  size: number
  lead: number
  color: number[]
  text: string
  section?: string
  tocPage?: number
  align?: 'left' | 'center' | 'right'
  rule?: boolean
  chart?: ChartSpec
}

// WinAnsi-safe text: fold common unicode punctuation to ASCII, drop the rest.
// Embedded fonts cover everything this function lets through.
export function sanitizePdfText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014\u2012\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '*')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[^\n\x20-\x7E\u00A1-\u00FF]/g, '?')
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function escPdfStr(s: string): string {
  return esc(sanitizePdfText(s))
}

// ---- font registry (loaded once per process) ----

function fontsDir(): string {
  return process.env.ROYAL_RED_FONTS || path.join(process.cwd(), 'fonts', 'pdf')
}

let fontInstances: Record<FontKey, EmbeddedFont> | null = null

function getFonts(): Record<FontKey, EmbeddedFont> {
  if (fontInstances) return fontInstances
  const dir = fontsDir()
  const inst = {} as Record<FontKey, EmbeddedFont>
  for (const key of Object.keys(FONT_FILES) as FontKey[]) {
    const file = path.join(dir, FONT_FILES[key])
    if (!fs.existsSync(file)) {
      throw new Error(`ROYAL RED pdf engine: font file missing: ${file} (set ROYAL_RED_FONTS to the fonts/pdf directory)`)
    }
    inst[key] = loadFont(file)
  }
  fontInstances = inst
  return inst
}

// measured wrap: exact advance widths per glyph, hard-split for tokens that
// can never fit a whole line
function wrapMeasured(text: string, maxWidth: number, size: number, font: EmbeddedFont): string[] {
  const out: string[] = []
  const measure = (s: string) => font.measure(s, size)
  for (const raw of text.split('\n')) {
    if (raw === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of raw.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) {
        out.push(line)
        line = ''
      }
      if (measure(word) <= maxWidth) {
        line = word
        continue
      }
      // pathological token: split by characters
      let chunk = ''
      for (const ch of word) {
        if (measure(chunk + ch) <= maxWidth) {
          chunk += ch
        } else {
          out.push(chunk)
          chunk = ch
        }
      }
      line = chunk
    }
    out.push(line)
  }
  return out
}

/** exact wrapped line count for a logical line in a style (poster layout math) */
export function wrappedLineCount(text: string, style: PdfStyle, pageSize: PageSize): number {
  if (style === 'rule' || style === 'chart') return 1
  const spec = STYLE_MAP[style as Exclude<PdfStyle, 'rule' | 'chart'>]
  const fonts = getFonts()
  const size = PAGE_SIZES[pageSize]
  const maxWidth = size.w - MARGIN * 2
  return wrapMeasured(sanitizePdfText(text), maxWidth, spec.size, fonts[spec.font]).length
}

// vector chart spec carried on a chart-style line: "Label:value, Label:value"
export interface ChartSpec {
  title: string
  data: { label: string; value: number }[]
  kind: 'bar' | 'line'
}

export function parseChartSpec(json: string): ChartSpec {
  return JSON.parse(json) as ChartSpec
}

const CHART_LABEL_H = 18

function chartHeight(_spec: ChartSpec): number {
  return 120 + CHART_LABEL_H + 14
}

export function buildPdf(lines: PdfLine[], opts: BuildPdfOptions = {}): Buffer {
  const fonts = getFonts()
  const size = PAGE_SIZES[opts.pageSize ?? 'Letter']
  const pageW = size.w
  const pageH = size.h
  const usable = pageH - MARGIN * 2
  const maxWidth = pageW - MARGIN * 2

  // 1. layout: logical lines -> wrapped atomic lines with real measurements
  const atomic: LayoutLine[] = []
  for (const l of lines) {
    if (l.style === 'rule') {
      atomic.push({ fontKey: 'monoMed', style: 'rule', size: 2, lead: 10, color: GOLD_SOFT, text: '', rule: true })
      continue
    }
    if (l.style === 'chart') {
      let spec: ChartSpec
      try {
        spec = parseChartSpec(l.text)
      } catch {
        atomic.push({ ...STYLE_MAP.dim, style: 'dim', text: '[chart spec invalid]' })
        continue
      }
      const h = chartHeight(spec)
      atomic.push({ fontKey: 'monoMed', style: 'chart', size: 2, lead: h, color: CHARCOAL, text: '', chart: spec })
      continue
    }
    const spec = STYLE_MAP[l.style as Exclude<PdfStyle, 'rule' | 'chart'>]
    const wrapped = wrapMeasured(sanitizePdfText(l.text), maxWidth, spec.size, fonts[spec.font])
    wrapped.forEach((t, wi) => {
      atomic.push({
        fontKey: spec.font,
        style: l.style,
        size: spec.size,
        lead: spec.lead,
        color: spec.color,
        text: t,
        section: l.section,
        // only the LAST wrapped fragment of a toc line carries the page number
        tocPage: wi === wrapped.length - 1 ? l.tocPage : undefined,
        align: l.align,
        // only the FIRST wrapped fragment triggers the page break
        pageBreakBefore: wi === 0 ? l.pageBreakBefore : undefined,
      })
    })
  }

  // 2. paginate: content NEVER overlaps; a line that does not fit flows to
  // the next page whole
  const pages: LayoutLine[][] = []
  const pageSections: (string | undefined)[] = []
  let cur: LayoutLine[] = []
  let y = 0
  let currentSection: string | undefined
  for (const line of atomic) {
    if (line.section) currentSection = line.section
    if (
      cur.length &&
      (line.pageBreakBefore || y + line.lead > usable)
    ) {
      pages.push(cur)
      pageSections.push(currentSection)
      cur = []
      y = 0
    }
    cur.push(line)
    y += line.lead
  }
  if (cur.length) {
    pages.push(cur)
    pageSections.push(currentSection)
  }
  if (!pages.length) {
    pages.push([])
    pageSections.push(currentSection)
  }
  // a page that OPENS with a section heading carries that section in its
  // running header; otherwise the section carries over from the previous page
  for (let pi = 0; pi < pages.length; pi++) {
    const first = pages[pi][0]
    if (first?.section) pageSections[pi] = first.section
  }

  // 2b. heading page map for two-pass TOCs (title + heading styles)
  if (opts.onPageMap) {
    const entries: { page: number; text: string }[] = []
    for (let pi = 0; pi < pages.length; pi++) {
      for (const line of pages[pi]) {
        if ((line.style === 'title' || line.style === 'heading') && line.text) {
          entries.push({ page: pi + 1, text: line.text })
        }
      }
    }
    opts.onPageMap(entries)
  }

  // 2c. outline entries (bookmarks): every title and heading with its page
  const outlineEntries: { page: number; text: string }[] = []
  for (let pi = 0; pi < pages.length; pi++) {
    for (const line of pages[pi]) {
      if ((line.style === 'title' || line.style === 'heading') && line.text) {
        outlineEntries.push({ page: pi + 1, text: line.text })
      }
    }
  }

  // 2d. collect used fonts + per-font used chars (for the subsets)
  const usedKeys = new Set<FontKey>()
  const charsPerFont = new Map<FontKey, Set<number>>()
  const collect = (key: FontKey, s: string) => {
    usedKeys.add(key)
    let set = charsPerFont.get(key)
    if (!set) {
      set = new Set<number>()
      charsPerFont.set(key, set)
    }
    for (const ch of s) set.add(ch.codePointAt(0) ?? 0)
  }
  for (const line of atomic) {
    if (line.style === 'chart' && line.chart) {
      // chart labels live in the sans font, the chart title in the display font
      for (const d of line.chart.data) collect('sans', d.label)
      collect('displaySemi', line.chart.title)
      continue
    }
    if (line.style === 'rule') continue
    collect(line.fontKey, line.text)
    if (line.style === 'toc' && line.tocPage !== undefined) collect(line.fontKey, String(line.tocPage))
  }
  const headerRight = 'ROYAL RED'
  if (opts.headerTitle) collect('monoMed', opts.headerTitle.toUpperCase())
  for (const s of pageSections) if (s) collect('monoMed', s.toUpperCase())
  collect('monoMed', headerRight)
  // punctuation the chrome and section names can carry (digits, dots, slashes)
  collect('monoMed', '0123456789 .,:/-()')
  collect('monoMed', opts.footerNote ?? '')

  // freeze subsets
  const usedOrdered = (Object.keys(FONT_FILES) as FontKey[]).filter((k) => usedKeys.has(k))
  const slotName = new Map<FontKey, string>()
  usedOrdered.forEach((k, i) => slotName.set(k, `F${i + 1}`))
  const subsets = new Map<FontKey, ReturnType<typeof buildSubset>>()
  for (const k of usedOrdered) {
    subsets.set(k, buildSubset(readFontBuffer(k), fonts[k].parsed, charsPerFont.get(k) ?? new Set([32])))
  }

  // 3. emit content streams
  const footerNote = opts.footerNote
  const contentStrs = pages.map((pageLines, pi) => {
    const parts: string[] = []
    // warm ivory page background
    parts.push(`${IVORY[0]} ${IVORY[1]} ${IVORY[2]} rg 0 0 ${pageW.toFixed(1)} ${pageH.toFixed(1)} re f`)
    const chrome = !(opts.suppressChromeOnFirstPage && pi === 0)
    // the crown is cover art: it renders on page 1 even when chrome (header,
    // footer) is suppressed for a clean cover
    if (opts.crown && pi === 0) {
      parts.push(crownOps(opts.crown.cx, opts.crown.yTop, opts.crown.scale))
    }
    if (chrome) {
      // running header: section name left, ROYAL RED right, small gold mono
      const left = (pageSections[pi] || opts.headerTitle || '').toUpperCase()
      if (left || headerRight) {
        parts.push('BT')
        if (left) {
          parts.push(
            `${GOLD[0]} ${GOLD[1]} ${GOLD[2]} rg /${slotName.get('monoMed')} 6.5 Tf 1 0 0 1 ${MARGIN} ${(pageH - 30).toFixed(1)} Tm <${cidHexStr('monoMed', left, subsets, fonts)}> Tj`,
          )
        }
        const rw = fonts.monoMed.measure(headerRight, 6.5)
        parts.push(
          `${GOLD[0]} ${GOLD[1]} ${GOLD[2]} rg /${slotName.get('monoMed')} 6.5 Tf 1 0 0 1 ${(pageW - MARGIN - rw).toFixed(1)} ${(pageH - 30).toFixed(1)} Tm <${cidHexStr('monoMed', headerRight, subsets, fonts)}> Tj`,
        )
        parts.push('ET')
        parts.push(
          `${GOLD_SOFT[0]} ${GOLD_SOFT[1]} ${GOLD_SOFT[2]} RG 0.6 w ${MARGIN} ${(pageH - 36).toFixed(1)} m ${(pageW - MARGIN).toFixed(1)} ${(pageH - 36).toFixed(1)} l S`,
        )
      }
    }
    parts.push('BT')
    let ty = pageH - MARGIN
    for (const line of pageLines) {
      if (line.rule) {
        parts.push('ET')
        parts.push(
          `${GOLD_SOFT[0]} ${GOLD_SOFT[1]} ${GOLD_SOFT[2]} RG 1.1 w ${MARGIN} ${(ty - line.lead / 2).toFixed(1)} m ${(pageW - MARGIN).toFixed(1)} ${(ty - line.lead / 2).toFixed(1)} l S`,
        )
        parts.push('BT')
        ty -= line.lead
        continue
      }
      if (line.chart) {
        parts.push('ET')
        parts.push(
          chartOps(
            line.chart,
            MARGIN,
            ty,
            pageW - MARGIN,
            line.lead,
            'sans',
            'displaySemi',
            slotName,
            fonts,
            subsets,
          ),
        )
        ty -= line.lead
        parts.push('BT')
        continue
      }
      const f = slotName.get(line.fontKey)!
      let x = MARGIN
      if (line.align === 'center') x = (pageW - fonts[line.fontKey].measure(line.text, line.size)) / 2
      if (line.align === 'right') x = pageW - MARGIN - fonts[line.fontKey].measure(line.text, line.size)
      if (line.style === 'code' && line.text) {
        parts.push('ET')
        parts.push(
          `${CODE_BG[0]} ${CODE_BG[1]} ${CODE_BG[2]} rg ${(MARGIN - 4).toFixed(1)} ${(ty - line.lead + 2.5).toFixed(1)} ${(maxWidth + 8).toFixed(1)} ${line.lead.toFixed(1)} re f`,
        )
        parts.push('BT')
      }
      const c = line.color
      const colorOp = `${c[0]} ${c[1]} ${c[2]} rg `
      if (line.style === 'toc' && line.tocPage !== undefined && line.text) {
        // leader dots + right-aligned page number
        const textW = fonts[line.fontKey].measure(line.text, line.size)
        const numStr = String(line.tocPage)
        const numW = fonts[line.fontKey].measure(numStr, line.size)
        const xNum = pageW - MARGIN - numW
        const dotStart = Math.min(x + textW + 8, xNum - 8)
        const dotW = fonts[line.fontKey].measure('.', line.size)
        const dotCount = Math.max(0, Math.floor((xNum - 8 - dotStart) / dotW))
        if (line.text) {
          parts.push(`${colorOp}/${f} ${line.size} Tf 1 0 0 1 ${x.toFixed(1)} ${ty.toFixed(1)} Tm <${cidHex(line, subsets, fonts)}> Tj`)
        }
        if (dotCount >= 2) {
          const dots = '.'.repeat(dotCount)
          parts.push(
            `${GRAY[0]} ${GRAY[1]} ${GRAY[2]} rg /${f} ${line.size} Tf 1 0 0 1 ${dotStart.toFixed(1)} ${ty.toFixed(1)} Tm <${cidHexStr(line.fontKey, dots, subsets, fonts)}> Tj`,
          )
        }
        parts.push(
          `${colorOp}/${f} ${line.size} Tf 1 0 0 1 ${xNum.toFixed(1)} ${ty.toFixed(1)} Tm <${cidHexStr(line.fontKey, numStr, subsets, fonts)}> Tj`,
        )
        ty -= line.lead
        continue
      }
      if (line.text) {
        parts.push(`${colorOp}/${f} ${line.size} Tf 1 0 0 1 ${x.toFixed(1)} ${ty.toFixed(1)} Tm <${cidHex(line, subsets, fonts)}> Tj`)
      }
      ty -= line.lead
    }
    parts.push('ET')
    if (chrome) {
      const footer = `${footerNote ? `${footerNote}  /  ` : ''}PAGE ${pi + 1} OF ${pages.length}`
      const fw = fonts.monoMed.measure(footer, 7)
      parts.push('BT')
      parts.push(
        `${GRAY[0]} ${GRAY[1]} ${GRAY[2]} rg /${slotName.get('monoMed')} 7 Tf 1 0 0 1 ${((pageW - fw) / 2).toFixed(1)} 34 Tm <${cidHexStr('monoMed', sanitizePdfText(footer), subsets, fonts)}> Tj`,
      )
      parts.push('ET')
    }
    return parts.join('\n')
  })

  // 4. assemble objects
  //   1 catalog, 2 pages tree, 3 info, 4 outlines,
  //   5.. 5 per used font (Type0, CIDFont, Descriptor, FontFile2, ToUnicode),
  //   then 2 per page (page dict, content), then outline items
  const fontObjBase = 5
  const perFont = 5
  const firstPageObj = fontObjBase + usedOrdered.length * perFont
  const firstItemObj = firstPageObj + pages.length * 2
  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ')

  const objects: string[] = []
  objects.push(
    `<< /Type /Catalog /Pages 2 0 R ${outlineEntries.length ? `/Outlines 4 0 R /PageMode /UseOutlines` : ''}>>`,
  )
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  objects.push(infoDict(opts.info))
  if (outlineEntries.length) {
    const items = outlineEntries
      .map(
        (e, i) =>
          `<< /Title (${escPdfStr(e.text.slice(0, 90))}) /Parent 4 0 R ${i > 0 ? `/Prev ${firstItemObj + i - 1} 0 R ` : ''}${i < outlineEntries.length - 1 ? `/Next ${firstItemObj + i + 1} 0 R ` : ''}/Dest [${firstPageObj + (e.page - 1) * 2} 0 R /Fit] >>`,
      )
      .join('\n')
    objects.push(
      `<< /Type /Outlines /First ${firstItemObj} 0 R /Last ${firstItemObj + outlineEntries.length - 1} 0 R /Count ${outlineEntries.length} >>\n${items}`,
    )
  } else {
    objects.push('<< /Type /Outlines /Count 0 >>')
  }

  // font objects
  const fontResEntries = usedOrdered
    .map((k, i) => {
      const base = fontObjBase + i * perFont
      return `/${slotName.get(k)} ${base} 0 R`
    })
    .join(' ')
  usedOrdered.forEach((k, i) => {
    const base = fontObjBase + i * perFont
    const sub = subsets.get(k)!
    const postscript = fontPostScriptName(k)
    objects.push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${postscript} /Encoding /Identity-H /DescendantFonts [${base + 1} 0 R] /ToUnicode ${base + 4} 0 R >>`,
    )
    objects.push(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${postscript} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${base + 2} 0 R /DW 1000 /W [${sub.widths.map((w, cid) => `${cid} ${cid} ${w}`).join(' ')}] /CIDToGIDMap /Identity >>`,
    )
    objects.push(
      `<< /Type /FontDescriptor /FontName /${postscript} /Flags 4 /FontBBox [${sub.descriptor.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${sub.descriptor.ascent} /Descent ${sub.descriptor.descent} /CapHeight ${sub.descriptor.capHeight} /StemV 80 /FontFile2 ${base + 3} 0 R >>`,
    )
    // FontFile2 stream (binary): registered for the serializer, referenced here
    binaryStreams.set(base + 3, sub.fontFile)
    objects.push(`__STREAM__${base + 3}`)
    objects.push(toUnicodeCMap(sub))
  })

  // page dicts + content streams
  pages.forEach((_, i) => {
    const contentObj = firstPageObj + i * 2 + 1
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentObj} 0 R /Resources << /Font << ${fontResEntries} >> >> >>`,
    )
    const stream = contentStrs[i]
    const objIdx = objects.length // index of the content stream object (0-based in objects[])
    const objNum = objIdx + 1
    if (objNum !== contentObj) throw new Error('object numbering desync')
    binaryStreams.set(objNum, Buffer.from(stream, 'latin1'))
    objects.push(`__STREAM__${objNum}`)
  })

  // outline item objects (after pages; firstItemObj was computed for them)
  outlineEntries.forEach((e, i) => {
    objects.push(
      `<< /Title (${escPdfStr(e.text.slice(0, 90))}) /Parent 4 0 R ${i > 0 ? `/Prev ${firstItemObj + i - 1} 0 R ` : ''}${i < outlineEntries.length - 1 ? `/Next ${firstItemObj + i + 1} 0 R ` : ''}/Dest [${firstPageObj + (e.page - 1) * 2} 0 R /Fit] >>`,
    )
  })

  // 5. serialize with xref offsets
  const head = '%PDF-1.4\n%\xB5\xB5\xB5\xB5\n'
  const chunks: Buffer[] = [Buffer.from(head, 'latin1')]
  const offsets: number[] = []
  let pos = Buffer.byteLength(head, 'latin1')
  objects.forEach((body, i) => {
    const objNum = i + 1
    const bin = binaryStreams.get(objNum)
    let objBuf: Buffer
    if (body === `__STREAM__${objNum}` && bin) {
      objBuf = Buffer.concat([
        Buffer.from(`${objNum} 0 obj\n<< /Length ${bin.length} >>\nstream\n`, 'latin1'),
        bin,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ])
    } else {
      objBuf = Buffer.from(`${objNum} 0 obj\n${body}\nendobj\n`, 'latin1')
    }
    offsets.push(pos)
    chunks.push(objBuf)
    pos += objBuf.length
  })
  const xrefStart = pos
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  chunks.push(Buffer.from(xref + trailer, 'latin1'))
  const out = Buffer.concat(chunks)
  binaryStreams.clear()
  return out
}

// per-invocation binary stream scratch (set during assembly, consumed by the serializer)
const binaryStreams = new Map<number, Buffer>()

const fontFileBuffers = new Map<FontKey, Buffer>()
function readFontBuffer(key: FontKey): Buffer {
  let buf = fontFileBuffers.get(key)
  if (!buf) {
    buf = fs.readFileSync(path.join(fontsDir(), FONT_FILES[key]))
    fontFileBuffers.set(key, buf)
  }
  return buf
}

// standard subset tag: six uppercase letters + '+' so every viewer flags the
// font as embedded subset (pdffonts 'sub yes', no missing-font warnings)
function fontPostScriptName(key: FontKey): string {
  const tag = 'RR' + key.replace(/[^a-z]/g, '').slice(0, 4).toUpperCase() + 'D'
  return `${tag}+${key.charAt(0).toUpperCase() + key.slice(1)}-RoyalRed`
}

// map a layout line's text to CID hex using its font's subset
function cidHex(
  line: LayoutLine,
  subsets: Map<FontKey, ReturnType<typeof buildSubset>>,
  fonts: Record<FontKey, EmbeddedFont>,
): string {
  return cidHexStr(line.fontKey, line.text, subsets, fonts)
}

function cidHexStr(
  fontKey: FontKey,
  text: string,
  subsets: Map<FontKey, ReturnType<typeof buildSubset>>,
  fonts: Record<FontKey, EmbeddedFont>,
): string {
  const sub = subsets.get(fontKey)!
  let out = ''
  for (const ch of text) {
    const gid = fonts[fontKey].parsed.charToGid.get(ch.codePointAt(0) ?? 0) ?? 0
    const cid = sub.oldToCid[gid] >= 0 ? sub.oldToCid[gid] : 0
    out += cid.toString(16).padStart(4, '0')
  }
  return out
}

function toUnicodeCMap(sub: ReturnType<typeof buildSubset>): string {
  // CIDs are sequential (== new gids); map each to its first unicode char
  const lines: string[] = []
  const entries: string[] = []
  for (let cid = 0; cid < sub.cidUnicode.length; cid++) {
    const u = sub.cidUnicode[cid]
    if (u === null) continue
    entries.push(`<${cid.toString(16).padStart(4, '0')}> <${u.toString(16).padStart(4, '0')}>`)
  }
  for (let i = 0; i < entries.length; i += 100) {
    lines.push(`${Math.min(100, entries.length - i)} beginbfchar`)
    lines.push(...entries.slice(i, i + 100))
    lines.push('endbfchar')
  }
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${lines.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`
  return `<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`
}

function infoDict(info?: BuildPdfOptions['info']): string {
  if (!info) return '<< >>'
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `D:${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}+00'00'`
  const parts = [
    info.title ? `/Title (${escPdfStr(info.title)})` : '',
    info.author ? `/Author (${escPdfStr(info.author)})` : '',
    info.subject ? `/Subject (${escPdfStr(info.subject)})` : '',
    info.keywords ? `/Keywords (${escPdfStr(info.keywords)})` : '',
    `/Creator (ROYAL RED document engine)`,
    `/Producer (ROYAL RED pdf engine, dependency-free)`,
    `/CreationDate (${date})`,
  ].filter(Boolean)
  return `<< ${parts.join(' ')} >>`
}

// ---- vector chart helpers (PDF path ops; vector, never raster) ----

function chartOps(
  spec: ChartSpec,
  x: number,
  yTop: number,
  w: number,
  h: number,
  labelKey: FontKey,
  titleKey: FontKey,
  slots: Map<FontKey, string>,
  fonts: Record<FontKey, EmbeddedFont>,
  subsets: Map<FontKey, ReturnType<typeof buildSubset>>,
): string {
  const inner = h - CHART_LABEL_H
  const max = Math.max(...spec.data.map((d) => d.value), 1)
  const pad = 8
  const axisY = yTop - inner
  const out: string[] = []
  out.push(`${GRAY[0]} ${GRAY[1]} ${GRAY[2]} RG 0.8 w ${x} ${axisY.toFixed(1)} m ${(x + w).toFixed(1)} ${axisY.toFixed(1)} l S`)
  const n = Math.max(spec.data.length, 1)
  const slot = (w - pad * 2) / n
  if (spec.kind === 'bar') {
    spec.data.forEach((d, i) => {
      const bh = Math.max(2, ((d.value / max) * (inner - 14)) | 0)
      const bx = x + pad + i * slot + slot * 0.18
      const bw = slot * 0.64
      out.push(`0.725 0.11 0.11 RG ${bx.toFixed(1)} ${axisY.toFixed(1)} ${bw.toFixed(1)} ${bh.toFixed(1)} re B`)
      const label = sanitizePdfText(d.label.slice(0, Math.max(4, (slot / 4.4) | 0)))
      out.push(`BT ${GRAY[0]} ${GRAY[1]} ${GRAY[2]} rg /${slots.get(labelKey)} 6.5 Tf 1 0 0 1 ${bx.toFixed(1)} ${(axisY - 8).toFixed(1)} Tm <${cidHexStr(labelKey, label, subsets, fonts)}> Tj ET`)
    })
  } else {
    const pts = spec.data.map((d, i) => {
      const px = x + pad + i * slot + slot / 2
      const py = axisY + Math.max(2, ((d.value / max) * (inner - 14)) | 0)
      return `${px.toFixed(1)} ${py.toFixed(1)}`
    })
    out.push(`0.725 0.11 0.11 RG 1.3 w ${pts.join(' m ')}${pts.length > 1 ? ' l S' : ''}`)
    spec.data.forEach((d, i) => {
      const px = x + pad + i * slot + slot / 2
      const label = sanitizePdfText(d.label.slice(0, Math.max(4, (slot / 4.4) | 0)))
      out.push(`BT ${GRAY[0]} ${GRAY[1]} ${GRAY[2]} rg /${slots.get(labelKey)} 6.5 Tf 1 0 0 1 ${px.toFixed(1)} ${(axisY - 8).toFixed(1)} Tm <${cidHexStr(labelKey, label, subsets, fonts)}> Tj ET`)
    })
  }
  const title = sanitizePdfText(spec.title)
  out.push(`BT ${RED[0]} ${RED[1]} ${RED[2]} rg /${slots.get(titleKey)} 8.5 Tf 1 0 0 1 ${x} ${(yTop - 8).toFixed(1)} Tm <${cidHexStr(titleKey, title, subsets, fonts)}> Tj ET`)
  return out.join('\n')
}

// ---- the Royal Crown, as pure vector ops (Phase A cover art) ----
// Same geometry as the RoyalCrown SVG component (48 x 40 viewBox):
// five points, five jewels, base band, center gem, ribbon tails.

function crownOps(cx: number, yTop: number, scale: number): string {
  const X = (x: number) => (cx + (x - 24) * scale).toFixed(2)
  const Y = (y: number) => (yTop - y * scale).toFixed(2)
  const body = [7.5, 29.5, 4.8, 11.5, 13.4, 19.5, 15, 7.2, 21, 17.6, 24, 4.2, 27, 17.6, 33, 7.2, 34.6, 19.5, 43.2, 11.5, 40.5, 29.5]
  const bodyPath =
    `${X(body[0])} ${Y(body[1])} m ` +
    Array.from({ length: 10 }, (_, i) => `${X(body[2 + i * 2])} ${Y(body[3 + i * 2])} l `).join('') +
    'h'
  const GOLD_BODY = '0.831 0.643 0.216'
  const GOLD_BAND = '0.722 0.525 0.043'
  const GOLD_EDGE = '0.486 0.318 0.012'
  const GEM_RED = '0.725 0.11 0.11'
  const JEWEL_RED = '0.937 0.267 0.267'
  const ops: string[] = []
  const strokedFill = (fill: string, edge: string, lw: number, path: string) =>
    `${fill} rg ${edge} RG ${lw} w ${path} B`
  // crown body
  ops.push(strokedFill(GOLD_BODY, GOLD_EDGE, 1.2 * scale, bodyPath))
  // base band (rounded rect x6.2 y29.5 w35.6 h4.6 r1.6)
  ops.push(strokedFill(GOLD_BAND, GOLD_EDGE, 0.8 * scale, roundedRect(6.2, 29.5, 35.6, 4.6, 1.6, X, Y)))
  // center gem on the band
  ops.push(strokedFill(GEM_RED, GOLD_EDGE, 0.5 * scale, roundedRect(21.6, 30.6, 4.8, 2.4, 1.2, X, Y)))
  // jewels: four gold orbs + the red center orb
  const jewels: [number, number, number, string][] = [
    [4.8, 10, 1.7, GOLD_BAND],
    [15, 5.8, 1.9, GOLD_BAND],
    [24, 3, 2.1, JEWEL_RED],
    [33, 5.8, 1.9, GOLD_BAND],
    [43.2, 10, 1.7, GOLD_BAND],
  ]
  for (const [jx, jy, r, fill] of jewels) {
    ops.push(strokedFill(fill, GOLD_EDGE, 0.6 * scale, circle(jx, jy, r, X, Y)))
  }
  // ribbon tails
  const ribbons = [
    [18, 34.1, 15.4, 38.4, 19.4, 37.2, 21, 34.1],
    [30, 34.1, 32.6, 38.4, 28.6, 37.2, 27, 34.1],
  ]
  for (const rb of ribbons) {
    const p = `${X(rb[0])} ${Y(rb[1])} m ${X(rb[2])} ${Y(rb[3])} l ${X(rb[4])} ${Y(rb[5])} l ${X(rb[6])} ${Y(rb[7])} l h`
    ops.push(`${GOLD_BODY} rg ${GOLD_EDGE} RG ${0.5 * scale} w ${p} B`)
  }
  return ops.join('\n')
}

function roundedRect(x: number, y: number, w: number, h: number, r: number, X: (n: number) => string, Y: (n: number) => string): string {
  const k = 0.5522847498
  return [
    `${X(x + r)} ${Y(y)} m`,
    `${X(x + w - r)} ${Y(y)} l`,
    `${X(x + w - r + r * k)} ${Y(y)} ${X(x + w)} ${Y(y + r - r * k)} ${X(x + w)} ${Y(y + r)} c`,
    `${X(x + w)} ${Y(y + h - r)} l`,
    `${X(x + w)} ${Y(y + h - r + r * k)} ${X(x + w - r + r * k)} ${Y(y + h)} ${X(x + w - r)} ${Y(y + h)} c`,
    `${X(x + r)} ${Y(y + h)} l`,
    `${X(x + r - r * k)} ${Y(y + h)} ${X(x)} ${Y(y + h - r + r * k)} ${X(x)} ${Y(y + h - r)} c`,
    `${X(x)} ${Y(y + r)} l`,
    `${X(x)} ${Y(y + r - r * k)} ${X(x + r - r * k)} ${Y(y)} ${X(x + r)} ${Y(y)} c`,
    `h`,
  ].join('\n')
}

function circle(cx: number, cy: number, r: number, X: (n: number) => string, Y: (n: number) => string): string {
  const k = 0.5522847498 * r
  return [
    `${X(cx + r)} ${Y(cy)} m`,
    `${X(cx + r)} ${Y(cy + k)} ${X(cx + k)} ${Y(cy + r)} ${X(cx)} ${Y(cy + r)} c`,
    `${X(cx - k)} ${Y(cy + r)} ${X(cx - r)} ${Y(cy + k)} ${X(cx - r)} ${Y(cy)} c`,
    `${X(cx - r)} ${Y(cy - k)} ${X(cx - k)} ${Y(cy - r)} ${X(cx)} ${Y(cy - r)} c`,
    `${X(cx + k)} ${Y(cy - r)} ${X(cx + r)} ${Y(cy - k)} ${X(cx + r)} ${Y(cy)} c`,
    `h`,
  ].join('\n')
}
