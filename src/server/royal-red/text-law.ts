// ROYAL RED text law (Round 6, Sections 0 + 9): the kernel-level enforcement
// that no emoji and no em dash or en dash ever reaches a ROYAL RED surface:
// boot lines, receipts, agent messages, PDFs, documents, posters, website copy.
//
// Mechanical rewrite rules (deterministic, never silently destructive):
//   "X — Y" and "X - Y" em/en dash between spaces  ->  "X, Y"
//   "X-Y" en dash inside a word or range            ->  "X-Y" (plain hyphen)
//   emoji (Extended_Pictographic)                   ->  removed
// Content the user explicitly requested (a flashcard's artwork glyph, a quote
// they pasted) is NOT kernel output and is exempt; call sites decide.

const EMOJI_RE = /\p{Extended_Pictographic}/gu

export interface TextLawResult {
  text: string
  changed: boolean
  violations: string[] // human-readable list of what was rewritten
}

export function enforceTextLaw(input: string): TextLawResult {
  const violations: string[] = []
  let text = input

  // em dash with spaces, em dash without spaces
  if (/\s*[—]\s*/.test(text)) {
    text = text.replace(/\s+—\s+/g, ', ').replace(/\s*—\s*/g, ', ')
    violations.push('em dash rewritten to comma')
  }
  // en dash: between spaces becomes comma; tight ranges become a hyphen
  if (/\s+[–]\s+/.test(text)) {
    text = text.replace(/\s+[–]\s+/g, ', ')
    violations.push('spaced en dash rewritten to comma')
  }
  if (/–/.test(text)) {
    text = text.replace(/–/g, '-')
    violations.push('en dash rewritten to hyphen')
  }
  // emoji: strip (kernel surfaces never carry them)
  if (EMOJI_RE.test(text)) {
    text = text.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ')
    violations.push('emoji removed')
    EMOJI_RE.lastIndex = 0
  }
  // tidy comma/period spacing artifacts the rewrites can leave
  text = text.replace(/, ?,/g, ',').replace(/,\s*\./g, '.').replace(/,\s*;/g, ';')

  return { text, changed: violations.length > 0, violations }
}

// assert-style helper for write gates: a PDF/document/poster writer calls this
// and REFUSES the write if the law cannot be satisfied mechanically
export function assertTextLaw(input: string): string {
  const r = enforceTextLaw(input)
  return r.text
}
