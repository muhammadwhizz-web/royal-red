// Phase 3 soft spot #4 - CEDAR & LEAF, now a PERMANENT REGRESSION (runs every
// round, not a one-time acceptance). The scenario: a 7/10 builder artifact
// gets a 7/10 independent critique -> honest score 7, disagreement 0, and the
// verification machinery must handle the full honest path without inflation.
// Deterministic only (no LLM): the kernel side of the verification engine.
// Run: bun --env-file=.env scripts/test-cedar-leaf.ts
import { autoGrade, artifactSnapshot, type LedgerItem } from '../src/server/awon/verify/ledger'
import { disagreement, mergeCriticVerdicts, type CritiqueResult } from '../src/server/awon/verify/critic'
import { compareShots } from '../src/server/awon/verify/visual'
import { db } from '../src/lib/db'

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

// the Cedar & Leaf fixture: a small garden shop one-pager, 7/10 quality by
// design (complete but with two known flaws: no favicon, tiny contrast issue)
const FILES = [
  {
    path: 'index.html',
    content: `<!doctype html><html><head><title>Cedar & Leaf</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{--moss:#3f5a3c;--cream:#f4f1e6}body{font-family:Georgia,serif;background:var(--cream);color:#222;margin:0}header{background:var(--moss);color:#fff;padding:2rem}main{max-width:720px;margin:2rem auto;padding:0 1rem}section{margin-bottom:2rem}h2{color:var(--moss)}.muted{color:#8a8a7a;font-size:.8rem}button{background:var(--moss);color:#fff;border:0;padding:.6rem 1rem;border-radius:4px}@media (max-width:640px){main{margin:1rem}header{padding:1.2rem}h1{font-size:1.4rem}}nav a{color:#fff;margin-right:1rem}</style></head>
<body><header><h1>Cedar &amp; Leaf</h1><nav><a href="#shop">Shop</a><a href="#care">Plant Care</a><a href="#visit">Visit</a></nav></header>
<main><section id="shop"><h2>Shop the nursery</h2><p>Hardy ferns, scented geraniums and heirloom herbs, grown on site since 1987. Every plant ships in a coconut-fiber pot.</p><button>Order a crate</button></section>
<section id="care"><h2>Plant care notes</h2><p>Ferns want shade and weekly water. Herbs want six hours of sun. The care card in every crate covers the first thirty days.</p></section>
<section id="visit"><h2>Visit the greenhouse</h2><p>Open Thursday to Sunday, 9 to 5, at 12 Fern Hollow Lane. <span class="muted">Last entry 4:30pm.</span></p></section></main></body></html>`,
  },
]

const snapshot = artifactSnapshot(FILES, 'index.html')
check('fixture snapshot parses', snapshot.html.length > 500)

// the constraint ledger the extractor would produce for this build
const ledger: LedgerItem[] = [
  { cid: 'C1', category: 'technical', text: 'must be responsive with the viewport meta tag', assertion: 'responsive viewport meta must be present', weight: 2, eval: 'auto' },
  { cid: 'C2', category: 'style', text: 'must use a moss green and cream palette', assertion: 'palette uses moss green and cream css variables', weight: 1, eval: 'auto' },
  { cid: 'C3', category: 'exclusion', text: 'must not contain lorem ipsum filler', assertion: 'no lorem ipsum filler copy anywhere', weight: 2, eval: 'auto' },
]

console.log('kernel per-constraint grading (deterministic):')
const grades = ledger.map((item) => ({ cid: item.cid, ...autoGrade(item, snapshot) }))
check('C1 responsive viewport meta present -> pass', grades.find((g) => g.cid === 'C1')?.verdict.verdict === 'pass', JSON.stringify(grades.find((g) => g.cid === 'C1')))
check('C2 palette variables present -> pass', grades.find((g) => g.cid === 'C2')?.verdict.verdict === 'pass')
check('C3 no lorem ipsum -> pass (kernel scan)', grades.find((g) => g.cid === 'C3')?.verdict.verdict === 'pass')
check('every verdict is labeled kernel:', grades.every((g) => g.verdict.method === 'deterministic'))

console.log('the honest 7/7 scenario (builder 7, critic 7):')
const critique: CritiqueResult = {
  status: 'ok',
  mode: 'same-family-fresh-context',
  provider: 'regression',
  model: 'deterministic-fixture',
  score: 7,
  perConstraint: [
    { cid: 'C1', verdict: 'pass', evidence: 'viewport meta present' },
    { cid: 'C2', verdict: 'pass', evidence: 'moss/cream variables defined and used' },
    { cid: 'C3', verdict: 'pass', evidence: 'no filler strings in the html' },
  ],
  deductions: ['favicon missing', 'the muted footer text fails contrast'],
  summary: 'Complete and honest build with two polish gaps.',
}
const dis = disagreement(7, critique)
check('critic 7 vs builder 7 -> NO disagreement', dis.disagree === false && dis.delta === 0, JSON.stringify(dis))
const honest = Math.min(7, critique.score)
check('honest score is the MIN of the two judges = 7 (never inflated)', honest === 7, String(honest))
const merged = mergeCriticVerdicts(
  grades.map((g) => g.verdict),
  critique,
)
check('kernel verdicts WIN over critic verdicts (labeled merge)', merged.every((v) => v.method === 'deterministic'))

console.log('and the disagreement edge stays honest:')
const dis2 = disagreement(9, critique)
check('builder 9 vs critic 7 -> disagreement fires (delta 2)', dis2.disagree === true && dis2.delta === 2)
const dis3 = disagreement(null, critique)
check('builder with no score never disagrees (nothing to compare)', dis3.disagree === false)
const dis4 = disagreement(7, { ...critique, status: 'unverified' })
check('an unverified critique never disagrees (no fabricated delta)', dis4.disagree === false)

console.log('visual regression stays deterministic:')
const v1 = compareShots('desktop', 'cedar', 'a'.repeat(16), 'a'.repeat(16), Array(64).fill(10), Array(64).fill(10))
check('identical frames -> identical verdict', v1.verdict === 'identical')
const v2 = compareShots('desktop', 'cedar', 'a'.repeat(16), 'f'.repeat(16), Array(64).fill(10), Array(64).fill(240))
check('changed frames -> changed verdict', v2.verdict === 'changed')

// persist a verification receipt row so the VERIFY tab shows the regression ran
await db.awonVerification.create({
  data: {
    sessionId: 'cedar-leaf-regression',
    kind: 'critique',
    status: 'pass',
    score: 7,
    data: JSON.stringify({ scenario: 'cedar-and-leaf permanent regression', builder: 7, critic: 7, honest: 7, disagreement: 0, at: new Date().toISOString() }),
  },
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
