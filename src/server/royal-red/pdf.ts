// Dependency-free PDF writer (PDF 1.4, WinAnsi, static text layout).
// Powers the ROYAL RED transcript export: titles + monospace body, automatic
// pagination, footer page numbers. No external deps, same spirit as zip.ts.

const MARGIN = 54
const BODY_SIZE = 9
const BODY_LEAD = 11.5
export type PdfStyle = 'title' | 'heading' | 'body' | 'dim' | 'rule' | 'chart' | 'display' | 'sub'

// Round 6: named page sizes for the poster and document engines
export const PAGE_SIZES = {
  Letter: { w: 612, h: 792 },
  A4: { w: 595, h: 842 },
  A3: { w: 842, h: 1191 },
  Tabloid: { w: 792, h: 1224 },
} as const
export type PageSize = keyof typeof PAGE_SIZES

export interface BuildPdfOptions {
  pageSize?: PageSize
  footerNote?: string
  /** receives the page index of every title/heading line (two-pass TOC) */
  onPageMap?: (entries: { page: number; text: string }[]) => void
}

export interface PdfLine {
  text: string
  style: PdfStyle
}

interface LayoutLine {
  font: string
  size: number
  lead: number
  gray?: number
  text: string
}

// WinAnsi-safe text: fold common unicode punctuation to ASCII, drop the rest
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

function wrapText(text: string, cols: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    if (raw.length <= cols) {
      out.push(raw)
      continue
    }
    let line = ''
    for (const word of raw.split(' ')) {
      // hard-split pathological tokens longer than a full line
      let w = word
      while (w.length > cols) {
        if (line) {
          out.push(line)
          line = ''
        }
        out.push(w.slice(0, cols))
        w = w.slice(cols)
      }
      if (!line) line = w
      else if (line.length + 1 + w.length <= cols) line += ` ${w}`
      else {
        out.push(line)
        line = w
      }
    }
    out.push(line)
  }
  return out
}

const STYLE_LAYOUT: Record<Exclude<PdfStyle, 'rule' | 'chart'>, Omit<LayoutLine, 'text'>> = {
  display: { font: 'F1', size: 30, lead: 36 },
  title: { font: 'F1', size: 16, lead: 20 },
  sub: { font: 'F2', size: 12, lead: 16 },
  heading: { font: 'F1', size: 10.5, lead: 15 },
  body: { font: 'F3', size: BODY_SIZE, lead: BODY_LEAD },
  dim: { font: 'F2', size: 8, lead: 11, gray: 0.45 },
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

// build the complete PDF for a list of styled logical lines (each may wrap).
// Round 6 additions: named page sizes, vector rules + charts, an optional
// footer note, and a page-map hook the document engine uses for real TOCs.
export function buildPdf(lines: PdfLine[], opts: BuildPdfOptions = {}): Buffer {
  const size = PAGE_SIZES[opts.pageSize ?? 'Letter']
  const pageW = size.w
  const pageH = size.h
  const usable = pageH - MARGIN * 2

  // 1. layout: logical lines -> wrapped atomic lines (Courier keeps wrap math exact)
  const atomic: (LayoutLine & { rule?: boolean; chart?: ChartSpec })[] = []
  for (const l of lines) {
    if (l.style === 'rule') {
      atomic.push({ font: 'F2', size: 2, lead: 10, text: '' , rule: true })
      continue
    }
    if (l.style === 'chart') {
      // one atomic line that occupies its chart's computed height
      let spec: ChartSpec
      try {
        spec = parseChartSpec(l.text)
      } catch {
        atomic.push({ ...STYLE_LAYOUT.dim, text: '[chart spec invalid]' })
        continue
      }
      const h = chartHeight(spec)
      atomic.push({ font: 'F2', size: 2, lead: h, text: '', chart: spec })
      continue
    }
    const style = STYLE_LAYOUT[l.style]
    // per-style column count: Courier 0.6em advance keeps the math exact
    const cols = Math.floor((pageW - MARGIN * 2) / (style.size * 0.6))
    for (const t of wrapText(sanitizePdfText(l.text), cols)) {
      atomic.push({ ...style, text: t })
    }
  }

  // 2. paginate: content NEVER overlaps; a line that does not fit flows to
  // the next page whole (the Round 6 no-overlap rule)
  const pages: (LayoutLine & { rule?: boolean; chart?: ChartSpec })[][] = []
  let cur: (LayoutLine & { rule?: boolean; chart?: ChartSpec })[] = []
  let y = 0
  for (const line of atomic) {
    if (y + line.lead > usable && cur.length) {
      pages.push(cur)
      cur = []
      y = 0
    }
    cur.push(line)
    y += line.lead
  }
  if (cur.length) pages.push(cur)
  if (!pages.length) pages.push([])

  // 2b. heading page map for two-pass TOCs
  if (opts.onPageMap) {
    const entries: { page: number; text: string }[] = []
    for (let pi = 0; pi < pages.length; pi++) {
      for (const line of pages[pi]) {
        if ((line.font === 'F1' && line.size === 10.5 && line.text) || (line.font === 'F1' && line.size === 16 && line.text)) {
          entries.push({ page: pi + 1, text: line.text })
        }
      }
    }
    opts.onPageMap(entries)
  }

  // 3. emit content streams
  const footer = opts.footerNote ?? 'ROYAL RED TRANSCRIPT'
  const contentStrs = pages.map((pageLines, pi) => {
    const parts: string[] = ['BT']
    let ty = pageH - MARGIN
    for (const line of pageLines) {
      if (line.rule) {
        parts.push(`ET
0.65 0.52 0.13 RG 1.1 w ${MARGIN} ${(ty - line.lead / 2).toFixed(1)} m ${(pageW - MARGIN).toFixed(1)} ${(ty - line.lead / 2).toFixed(1)} l S
BT`)
        ty -= line.lead
        continue
      }
      if (line.chart) {
        parts.push(chartOps(line.chart, MARGIN, ty, pageW - MARGIN, line.lead))
        ty -= line.lead
        continue
      }
      const gray = line.gray !== undefined ? ` ${line.gray.toFixed(2)} G` : ''
      parts.push(
        `${gray} /${line.font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${ty.toFixed(1)} Tm (${esc(line.text)}) Tj`,
      )
      ty -= line.lead
    }
    parts.push(
      ` 0.45 G /F2 7.5 Tf 1 0 0 1 ${MARGIN} 34 Tm (${esc(sanitizePdfText(footer))} / PAGE ${pi + 1} OF ${pages.length} / ROYAL RED V1.8) Tj`,
    )
    parts.push('ET')
    return parts.join('\n')
  })

  // 4. assemble objects: 1 catalog, 2 pages, 3-5 fonts, then 2 objs per page
  const firstPageObj = 6
  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ')
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
  // page dicts and content streams MUST interleave: page i occupies objects
  // (firstPageObj + i*2) and (firstPageObj + i*2 + 1) to match the refs above
  pages.forEach((_, i) => {
    const contentObj = firstPageObj + i * 2 + 1
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`,
    )
    objects.push(`<< /Length ${Buffer.byteLength(contentStrs[i], 'latin1')} >>\nstream\n${contentStrs[i]}\nendstream`)
  })

  // 5. serialize with xref offsets
  const head = '%PDF-1.4\n%\xB5\xB5\xB5\xB5\n'
  const chunks: Buffer[] = [Buffer.from(head, 'latin1')]
  const offsets: number[] = []
  let pos = Buffer.byteLength(head, 'latin1')
  objects.forEach((body, i) => {
    const objBuf = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    offsets.push(pos)
    chunks.push(objBuf)
    pos += objBuf.length
  })
  const xrefStart = pos
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  chunks.push(Buffer.from(xref + trailer, 'latin1'))
  return Buffer.concat(chunks)
}

// ---- vector chart helpers (PDF path ops; vector, never raster) ----

const CHART_LABEL_H = 18

function chartHeight(_spec: ChartSpec): number {
  return 120 + CHART_LABEL_H + 14
}

// draw a bar or line chart into the box (x, yTop) with the given width/height
function chartOps(spec: ChartSpec, x: number, yTop: number, w: number, h: number): string {
  const inner = h - CHART_LABEL_H
  const max = Math.max(...spec.data.map((d) => d.value), 1)
  const pad = 8
  const axisY = yTop - inner
  const out: string[] = ['ET']
  // axis
  out.push(`0.45 G 0.8 w ${x} ${axisY.toFixed(1)} m ${(x + w).toFixed(1)} ${axisY.toFixed(1)} l S`)
  const n = Math.max(spec.data.length, 1)
  const slot = (w - pad * 2) / n
  if (spec.kind === 'bar') {
    spec.data.forEach((d, i) => {
      const bh = Math.max(2, ((d.value / max) * (inner - 14)) | 0)
      const bx = x + pad + i * slot + slot * 0.18
      const bw = slot * 0.64
      out.push(`0.72 0.11 0.11 RG ${bx.toFixed(1)} ${axisY.toFixed(1)} ${bw.toFixed(1)} ${bh.toFixed(1)} re B`)
      const label = esc(sanitizePdfText(d.label.slice(0, Math.max(4, (slot / 4.4) | 0))))
      out.push(`BT 0.35 G /F2 6.5 Tf 1 0 0 1 ${bx.toFixed(1)} ${(axisY - 8).toFixed(1)} Tm (${label}) Tj ET`)
    })
  } else {
    const pts = spec.data.map((d, i) => {
      const px = x + pad + i * slot + slot / 2
      const py = axisY + Math.max(2, ((d.value / max) * (inner - 14)) | 0)
      return `${px.toFixed(1)} ${py.toFixed(1)}`
    })
    out.push(`0.72 0.11 0.11 RG 1.3 w ${pts.join(' m ')}${pts.length > 1 ? ' l S' : ''}`)
    spec.data.forEach((d, i) => {
      const px = x + pad + i * slot + slot / 2
      const label = esc(sanitizePdfText(d.label.slice(0, Math.max(4, (slot / 4.4) | 0))))
      out.push(`BT 0.35 G /F2 6.5 Tf 1 0 0 1 ${px.toFixed(1)} ${(axisY - 8).toFixed(1)} Tm (${label}) Tj ET`)
    })
  }
  const title = esc(sanitizePdfText(spec.title))
  out.push(`BT 0.2 G /F1 8.5 Tf 1 0 0 1 ${x} ${(yTop - 8).toFixed(1)} Tm (${title}) Tj ET`)
  out.push('BT')
  return out.join('\n')
}
