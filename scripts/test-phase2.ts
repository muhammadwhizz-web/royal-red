// Phase 2 unit tests: OSWorld loader, perceptual hash, benchmark matrix, auto checks
import { loadOsworldIndex, formatOsworldReport, createDeferredRunner } from '../src/server/awon/osworld/harness'
import { perceptualHash, hammingHex, compareShots, verifyRelPath } from '../src/server/awon/verify/visual'
import { MATRIX, TAXONOMY } from '../src/server/awon/verify/benchmark'
import { autoGrade, artifactSnapshot, type LedgerItem } from '../src/server/awon/verify/ledger'
import { assertVerifiableUrl, BrowserDeniedError } from '../src/server/awon/verify/browser'
import sharp from 'sharp'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` - ${extra}` : ''}`) }
}
const vOf = (r: ReturnType<typeof autoGrade>) => r.verdict.verdict

// --- OSWorld loader ---
console.log('OSWorld harness:')
const idx = loadOsworldIndex()
check('index available', idx.available, idx.reason)
check('tasks indexed > 100', idx.tasks.length > 100, `got ${idx.tasks.length}`)
check('official category index >= 5', Object.keys(idx.categoryIndexCounts).length >= 5, JSON.stringify(idx.categoryIndexCounts))
check('apps parsed >= 3', Object.keys(idx.apps).length >= 3, JSON.stringify(idx.apps))
const report = formatOsworldReport(idx, [])
check('report renders scaffold line', report.includes('scaffold phase'))
check('report lists SOTA', report.includes('20.6%'))
const runner = createDeferredRunner('test')
try { await runner.runTask(idx.tasks[0]); check('runner deferred', false) }
catch (e) { check('runner deferred to Phase 3', String((e as Error).message).includes('Phase 3')) }

// --- perceptual hash (structured images, not solid colors) ---
console.log('visual:')
const svg = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">${inner}</svg>`)
const imgA = await sharp(svg(`<rect width="240" height="240" fill="#c2415d"/><rect x="30" y="30" width="80" height="180" fill="#f5e9dc"/><circle cx="170" cy="90" r="40" fill="#2d2a26"/><text x="40" y="120" fill="#2d2a26" font-size="28">AWON</text>`)).png().toBuffer()
const imgA2 = await sharp(svg(`<rect width="240" height="240" fill="#c2415d"/><rect x="30" y="30" width="80" height="180" fill="#f5e9dc"/><circle cx="178" cy="90" r="40" fill="#2d2a26"/><text x="40" y="120" fill="#2d2a26" font-size="28">AWON</text>`)).png().toBuffer()
const imgB = await sharp(svg(`<rect width="240" height="240" fill="#e9dfd0"/><rect x="10" y="120" width="220" height="60" fill="#1f4d3f"/><circle cx="60" cy="60" r="26" fill="#8f2d3a"/><text x="100" y="60" fill="#1f1f1f" font-size="20">studio</text>`)).png().toBuffer()
const hA = await perceptualHash(imgA)
const hA2 = await perceptualHash(imgA2)
const hB = await perceptualHash(imgB)
check('hash is 16 hex chars', /^[0-9a-f]{16}$/.test(hA), hA)
check('hash nonzero', hA !== '0000000000000000', hA)
check('identical image hamming 0', hammingHex(hA, hA) === 0)
check('near image low hamming', hammingHex(hA, hA2) <= 8, `got ${hammingHex(hA, hA2)}`)
check('far image higher hamming', hammingHex(hA, hB) > hammingHex(hA, hA2), `${hammingHex(hA, hB)} vs ${hammingHex(hA, hA2)}`)
const cmp = compareShots('desktop', 'run-x', hA, hB, Array(64).fill(10), Array(64).fill(200))
check('region diff marks all changed', cmp.changedPct === 100 && cmp.verdict === 'changed', `${cmp.changedPct}% ${cmp.verdict}`)
const cmp2 = compareShots('desktop', 'run-x', hA, hA, Array(64).fill(10), Array(64).fill(10))
check('identical shots verdict', cmp2.verdict === 'identical', cmp2.verdict)
const cmp3 = compareShots('desktop', 'run-x', hA, hA2, Array(64).fill(10), Array(64).fill(14))
check('small change -> minor', cmp3.verdict === 'minor' || cmp3.verdict === 'identical', cmp3.verdict)
check('rel path guard ok', verifyRelPath('run-abc-123', 'desktop.png') === 'verify/run-abc-123/desktop.png')
let threw = false
try { verifyRelPath('run-x', '../../etc/passwd') } catch { threw = true }
check('rel path guard blocks traversal', threw)

// --- benchmark matrix ---
console.log('benchmark:')
check('matrix has 20 checks', MATRIX.length === 20, `got ${MATRIX.length}`)
check('matrix max totals 60', MATRIX.reduce((s, c) => s + c.max, 0) === 60)
check('taxonomy has 10 categories', TAXONOMY.length === 10)
check('matrix ids unique', new Set(MATRIX.map(m => m.id)).size === MATRIX.length)

// --- ledger auto checks ---
console.log('ledger:')
const siteHtml = `<!DOCTYPE html><html><head><title>T</title><meta name="viewport" content="width=device-width"><meta property="og:title" content="x"><meta name="description" content="d"><link rel="icon" href="x.svg"><link href="fonts.googleapis.com" rel="stylesheet"><style>:root{--brand:#a83f5d}@media(max-width:600px){.x{}}section{}</style></head><body><header><nav><a href="about.html">About</a></nav></header><h1>Hi</h1><img src="a.png" alt="A"><form><input type="text" placeholder="p" aria-label="q"></form><footer>Contact us today ok</footer><a href="cms.html">Admin</a></body></html>`
const files = [
  { path: 'index.html', content: siteHtml },
  { path: 'cms.html', content: 'localStorage CRUD admin panel' },
  { path: 'about.html', content: '<h1>about</h1>' },
]
const snap = artifactSnapshot(files, 'index.html')
const mkItem = (assertion: string, category: LedgerItem['category'] = 'technical'): LedgerItem => ({ cid: 'C1', category, text: assertion, assertion, weight: 1, eval: 'auto' })
check('dark mode fails on empty', vOf(autoGrade(mkItem('site has dark mode toggle'), artifactSnapshot([{ path: 'index.html', content: '<h1>x</h1>' }], 'index.html'))) === 'fail')
check('cms check passes', vOf(autoGrade(mkItem('admin CMS panel page present'), snap)) === 'pass')
check('no-em-dash passes', vOf(autoGrade(mkItem('no em dashes anywhere', 'exclusion'), snap)) === 'pass')
const dashSnap = artifactSnapshot([{ path: 'index.html', content: '<p>hello — world</p>' }], 'index.html')
check('no-em-dash fails on em dash', vOf(autoGrade(mkItem('no em dashes anywhere', 'exclusion'), dashSnap)) === 'fail')
check('seo check passes', vOf(autoGrade(mkItem('SEO meta and Open Graph tags'), snap)) === 'pass')
check('favicon check passes', vOf(autoGrade(mkItem('favicon present'), snap)) === 'pass')
check('multi-page passes', vOf(autoGrade(mkItem('multiple pages linked together'), snap)) === 'pass')
check('responsive passes', vOf(autoGrade(mkItem('responsive on mobile'), snap)) === 'pass')
check('unmapped -> semantic path', autoGrade(mkItem('copy is persuasive and specific')).done === false)

// --- browser URL guard ---
console.log('browser guard:')
check('allows preview origin', assertVerifiableUrl('http://localhost:3000/api/awon/preview/x/', { allowLocalPreview: true }) === 'http://localhost:3000/api/awon/preview/x/')
check('allows external https', !!assertVerifiableUrl('https://example.com/page'))
let blocked = 0
for (const bad of ['file:///etc/passwd', 'http://localhost:8080/', 'https://169.254.169.254/latest/meta-data/', 'javascript:alert(1)', 'http://127.0.0.1:22/']) {
  try { assertVerifiableUrl(bad, { allowLocalPreview: true }) } catch (e) { if (e instanceof BrowserDeniedError) blocked++ }
}
check('blocks dangerous urls (5/5)', blocked === 5, `blocked ${blocked}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
