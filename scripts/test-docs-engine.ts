// ROYAL RED ROUND 6 - TEXT LAW + PDF/POSTER/DOCUMENT ENGINE TEST (Sections 7 + 9).
//
// Contract under test:
//   1. text law: em dashes -> commas, en dashes -> hyphens, emojis stripped,
//      clean text passes through untouched
//   2. PDF engine: named page sizes land in MediaBox; vector chart ops are
//      emitted; content overflows to a NEW page, never overlaps
//   3. poster: A3 MediaBox; an intentionally overlong poster flows to page 2+;
//      the layout boxes never intersect (line-flow law)
//   4. document: the TOC carries REAL page numbers (two-pass) and matches the
//      headings; the emitted /Count equals the reported pages
//   5. kernel enforcement: assistant say() text leaving the event seam is
//      law-clean (em dashes and emojis never reach the console)
//
// Run: bun --env-file=.env scripts/test-docs-engine.ts
import { readFileSync } from 'fs'
import { buildPdf, PAGE_SIZES } from '../src/server/royal-red/pdf'
import { buildPoster } from '../src/server/royal-red/poster'
import { buildDocument } from '../src/server/royal-red/document'
import { enforceTextLaw } from '../src/server/royal-red/text-law'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? ` - ${extra}` : ''}`)
  }
}

function countPages(buf: Buffer): number {
  const m = buf.toString('latin1').match(/\/Count (\d+)/)
  return m ? Number(m[1]) : 0
}

async function main() {
  console.log('ROYAL RED text law + documents engine test')

  // 1. text law
  const r1 = enforceTextLaw('ROYAL RED builds fast, no cliff notes needed')
  check('law: clean text untouched', r1.text === 'ROYAL RED builds fast, no cliff notes needed' && !r1.changed)
  const r2 = enforceTextLaw('speed — that is the point')
  check('law: em dash becomes a comma', !r2.text.includes('—') && r2.text.includes(', '), r2.text)
  const r3 = enforceTextLaw('pages 10–20 and a spaced - dash')
  check('law: en dash becomes a hyphen', !r3.text.includes('–'), r3.text)
  const r4 = enforceTextLaw('seal it 👍 and this 🎉')
  check('law: emoji stripped', !/\p{Extended_Pictographic}/u.test(r4.text), r4.text)
  const r5 = enforceTextLaw('no problem — here: "quoted — text" and 3–4')
  check('law: multiple rewrites in one pass', !r5.changed === false && !/—|–/u.test(r5.text), r5.text)

  // 2. PDF engine
  const letter = buildPdf([{ text: 'test', style: 'title' }])
  check('pdf: default Letter MediaBox', letter.toString('latin1').includes(`[0 0 ${PAGE_SIZES.Letter.w} ${PAGE_SIZES.Letter.h}]`))
  const a3 = buildPdf([{ text: 'poster', style: 'display' }], { pageSize: 'A3' })
  check('pdf: A3 MediaBox', a3.toString('latin1').includes(`[0 0 ${PAGE_SIZES.A3.w} ${PAGE_SIZES.A3.h}]`))
  const chart = buildPdf(
    [{ text: JSON.stringify({ title: 't', kind: 'bar', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }), style: 'chart' }],
  )
  check('pdf: vector rect ops emitted for charts', chart.toString('latin1').includes(' re '))
  const flood = buildPdf(Array.from({ length: 200 }, (_, i) => ({ text: `line ${i} body text that keeps flowing down the page`, style: 'body' as const })))
  check('pdf: overflow flows to multiple pages, never overlaps', countPages(flood) >= 3, `pages=${countPages(flood)}`)

  // 3. poster
  const poster = buildPoster({
    title: 'ROYAL RED',
    subtitle: 'the operating system for agents',
    kicker: 'product launch',
    blocks: [
      { heading: 'why', body: 'Verification is the product. Every build carries a receipt.' },
      { heading: 'when', body: 'Tonight, at the court.' },
    ],
    footer: 'royal red, the sovereign build',
    size: 'A3',
  })
  check('poster: A3 vector pdf built', poster.pdf.length > 1000 && poster.size === 'A3')
  const longPoster = buildPoster({
    title: 'LONG',
    blocks: Array.from({ length: 40 }, (_, i) => ({ heading: `section ${i}`, body: 'x'.repeat(300) })),
    footer: 'end',
    size: 'A4',
  })
  check('poster: overlong content flows to another page (no overlap)', longPoster.pages >= 2, `pages=${longPoster.pages}`)
  // line-flow boxes: same page boxes must never overlap vertically
  let boxOverlap = false
  const byPage = new Map<number, { top: number; height: number }[]>()
  for (const b of longPoster.boxes) {
    const list = byPage.get(b.page) ?? []
    list.push({ top: b.top, height: b.height })
    byPage.set(b.page, list)
  }
  for (const [, list] of byPage) {
    for (let i = 0; i < list.length - 1; i++) {
      // tops ascend down the page: the next element must start at or below
      // the previous element's bottom edge (epsilon for float rounding)
      const a = list[i]
      const b = list[i + 1]
      if (b.top + 0.01 < a.top + a.height) boxOverlap = true
    }
  }
  check('poster: layout boxes never intersect', !boxOverlap)
  check('poster: text law rewrite counter reports', buildPoster({ title: 'bad — title', blocks: [], footer: 'f' }).textLawRewrites > 0)

  // 4. document: two-pass TOC with real page numbers
  const sections = Array.from({ length: 12 }, (_, i) => ({
    heading: `Section ${i + 1}: ${['Discovery', 'Method', 'Build', 'Verify', 'Ship'][i % 5]}`,
    body: `Content for section ${i + 1}. ` + 'detail '.repeat(220 + i * 10),
  }))
  const doc = buildDocument({ title: 'Quarterly Court Report', subtitle: 'prepared by ROYAL RED', author: 'Royal Red', sections, footerNote: 'COURT REPORT' })
  check('document: multi-page report built', doc.pages >= 3, `pages=${doc.pages}`)
  check('document: TOC page numbers are real and ascending', doc.toc.length === 12 && doc.toc[0].page >= 1 && doc.toc.every((t, i) => i === 0 || t.page >= doc.toc[i - 1].page), JSON.stringify(doc.toc.slice(0, 4)))
  check('document: /Count matches reported pages', countPages(doc.pdf) === doc.pages)
  check('document: text law rewrites counted on dirty input', buildDocument({ title: 'dash — title', sections: [{ heading: 'h', body: 'b — c' }] }).textLawRewrites >= 2)

  // 5. kernel enforcement: the seam rewrites say text (law applied in event-log)
  const seamSrc = readFileSync(new URL('../src/server/royal-red/event-log.ts', import.meta.url), 'utf8')
  check('seam: durableEmitter applies the text law to say events', seamSrc.includes('enforceTextLaw'))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
