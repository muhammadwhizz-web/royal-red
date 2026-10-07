// Dependency-free PDF writer (PDF 1.4, WinAnsi, static text layout).
// Powers the ROYAL RED transcript export: titles + monospace body, automatic
// pagination, footer page numbers. No external deps, same spirit as zip.ts.

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const BODY_SIZE = 9
const BODY_LEAD = 11.5
// Courier advance width is exactly 0.6em: 9pt * 0.6 = 5.4pt per char
const BODY_COLS = 92 // 92 * 5.4 = 496.8pt <= 504pt usable width

export type PdfStyle = 'title' | 'heading' | 'body' | 'dim'

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

const STYLE_LAYOUT: Record<PdfStyle, Omit<LayoutLine, 'text'>> = {
  title: { font: 'F1', size: 16, lead: 20 },
  heading: { font: 'F1', size: 10.5, lead: 15 },
  body: { font: 'F3', size: BODY_SIZE, lead: BODY_LEAD },
  dim: { font: 'F2', size: 8, lead: 11, gray: 0.45 },
}

// build the complete PDF for a list of styled logical lines (each may wrap)
export function buildPdf(lines: PdfLine[]): Buffer {
  // 1. layout: logical lines -> wrapped atomic lines (Courier keeps wrap math exact)
  const atomic: LayoutLine[] = []
  for (const l of lines) {
    const style = STYLE_LAYOUT[l.style]
    for (const t of wrapText(sanitizePdfText(l.text), BODY_COLS)) {
      atomic.push({ ...style, text: t })
    }
  }

  // 2. paginate
  const usable = PAGE_H - MARGIN * 2
  const pages: LayoutLine[][] = []
  let cur: LayoutLine[] = []
  let y = 0
  for (const line of atomic) {
    if (y + line.lead > usable) {
      pages.push(cur)
      cur = []
      y = 0
    }
    cur.push(line)
    y += line.lead
  }
  if (cur.length) pages.push(cur)
  if (!pages.length) pages.push([])

  // 3. emit content streams (with deterministic page footers).
  // sanitize guarantees every char is latin1-range, so single-byte encoding
  // is exact all the way through Buffer.from(..., 'latin1').
  const contentStrs: string[] = pages.map((pageLines, pi) => {
    const parts: string[] = ['BT']
    let ty = PAGE_H - MARGIN
    for (const line of pageLines) {
      const gray = line.gray !== undefined ? ` ${line.gray.toFixed(2)} G` : ''
      parts.push(
        `${gray} /${line.font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${ty.toFixed(1)} Tm (${esc(line.text)}) Tj`,
      )
      ty -= line.lead
    }
    parts.push(
      ` 0.45 G /F2 7.5 Tf 1 0 0 1 ${MARGIN} 34 Tm (ROYAL RED TRANSCRIPT / PAGE ${pi + 1} OF ${pages.length} / ROYAL RED V1.0) Tj`,
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`,
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
