// ROYAL RED ROUND 3 — BUILD-OUTPUT INTEGRITY TEST (directive 2b/2c).
//
// WHY THIS EXISTS (the Tailwind catastrophe, postmortem RR3):
//   postcss.config.mjs vanished from the working tree during the sandbox
//   checkpoint-restore event (same event class that wiped .git; last commit
//   containing it was the initial scaffold, re-appeared at 3d542b5). From the
//   v1.3 pre-rebrand checkpoint (2eec862, 2026-10-07 05:53Z) to the fix
//   (3d542b5, 09:15Z) the served CSS was fonts-only garbage: ZERO Tailwind
//   utilities, ZERO theme tokens. The UI was unstyled for 3 rounds — rebrand,
//   Round 1 engine, and half of Round 2 — while EVERY functional suite stayed
//   green, because no test asserted that the stylesheet actually contained
//   styles. Only a visual screenshot caught it.
//
// WHAT THIS TEST ASSERTS (every asset class that can silently fail to emit):
//   1. the served HTML is the ROYAL RED console (not an error page)
//   2. every <link rel=stylesheet> resolves and contains REAL Tailwind
//      utilities (.flex, .bg-red-500) and theme tokens (--primary:) — a
//      fonts-only or empty stylesheet fails loudly here
//   3. NO unprocessed directives (@tailwind / @apply / @import "tailwindcss")
//      leak into served CSS — that is the exact signature of a dead PostCSS
//      pipeline
//   4. fonts: @font-face rules exist and every referenced font file resolves
//      (the ../media/*.woff2 sibling of the CSS file)
//   5. every <script src> resolves and is non-trivial
//   6. icons render (inline SVG present in the SSR HTML; favicon resolves)
//   7. every <img src> referenced by the page resolves
//
// This is a LIVE test: it checks what the server ACTUALLY SERVES, not what
// the build config claims. Run it every round, before shipping.
// Run: bun --env-file=.env scripts/test-build-integrity.ts
const BASE = process.env.RR3_BASE_URL ?? 'http://localhost:3000'

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

async function fetchBuf(url: string): Promise<{ ok: boolean; status: number; body: Buffer } | null> {
  try {
    const res = await fetch(new URL(url, BASE))
    const body = Buffer.from(await res.arrayBuffer())
    return { ok: res.ok, status: res.status, body }
  } catch {
    return null
  }
}

// ── 1. the page is the console ───────────────────────────────────────────────
const page = await fetchBuf('/')
check('GET / resolves', !!page?.ok, `status=${page?.status}`)
const html = page?.body.toString('utf8') ?? ''
check('page is the ROYAL RED console', /ROYAL RED/i.test(html), 'brand string missing from served HTML')
check('page is not a bare error shell', html.length > 20_000, `html=${html.length}B`)

// ── 2. stylesheets: real utilities + theme tokens ────────────────────────────
const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1])
const cssHrefsAlt = cssHrefs.length
  ? cssHrefs
  : [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"[^>]*>/g)].map((m) => m[1])
check('page links at least one stylesheet', cssHrefsAlt.length >= 1, `found ${cssHrefsAlt.length}`)

let cssAll = ''
let cssOk = true
for (const href of cssHrefsAlt) {
  const css = await fetchBuf(href)
  if (!css?.ok || css.body.length < 1000) {
    cssOk = false
    console.log(`    stylesheet failed to load: ${href} (${css?.status ?? 'fetch error'}, ${css?.body.length ?? 0}B)`)
    continue
  }
  cssAll += css.body.toString('utf8') + '\n'
}
check('all stylesheets resolve and are non-trivial', cssOk && cssAll.length > 50_000, `css total=${cssAll.length}B (the catastrophe served ~30KB fonts-only)`)

// the two load-bearing assertions that would have caught the catastrophe
check('CSS contains real utilities (.flex)', /\.flex\s*\{/.test(cssAll))
check('CSS contains real utilities (.bg-red-500)', /\.bg-red-500\s*\{/.test(cssAll))
check('CSS contains theme tokens (--primary:)', /--primary\s*:/.test(cssAll))

// ── 3. no unprocessed directives leak into served CSS ───────────────────────
const unprocessed = cssAll.match(/@tailwind\s|@apply[\s;{]|@import\s+["']tailwindcss/)
check('no unprocessed PostCSS/Tailwind directives in served CSS', !unprocessed, unprocessed ? JSON.stringify(unprocessed[0]) : undefined)

// ── 4. fonts: @font-face present + referenced files resolve ─────────────────
check('CSS declares @font-face rules (fonts chunk emitted)', /@font-face/.test(cssAll))
const fontUrls = [...cssAll.matchAll(/url\(\s*["']?([^"')]+\.woff2?[^"')]*)["']?\s*\)/g)].map((m) => m[1])
check('CSS references font files', fontUrls.length >= 1, `found ${fontUrls.length}`)
let fontsOk = true
for (const f of [...new Set(fontUrls)].slice(0, 6)) {
  const abs = f.startsWith('http') || f.startsWith('/') ? f : new URL(f, new URL(cssHrefsAlt[0] ?? '/', BASE)).pathname
  const res = await fetchBuf(abs)
  if (!res?.ok || res.body.length < 1000) {
    fontsOk = false
    console.log(`    font failed to load: ${abs} (${res?.status ?? 'fetch error'})`)
  }
}
check('every referenced font file resolves', fontsOk)

// ── 5. scripts resolve ───────────────────────────────────────────────────────
const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
check('page references scripts', scriptSrcs.length >= 1, `found ${scriptSrcs.length}`)
let scriptsOk = true
for (const s of scriptSrcs) {
  const res = await fetchBuf(s)
  if (!res?.ok || res.body.length < 200) {
    scriptsOk = false
    console.log(`    script failed to load: ${s} (${res?.status ?? 'fetch error'})`)
  }
}
check('every referenced script resolves', scriptsOk)

// ── 6. icons ─────────────────────────────────────────────────────────────────
check('inline SVG icons render in SSR HTML (lucide)', /<svg[^>]*class="lucide|<svg[^>]+viewBox/.test(html), 'no inline svg found')
const iconHref = html.match(/<link[^>]+rel="(?:shortcut )?icon"[^>]+href="([^"]+)"/i)?.[1]
if (iconHref) {
  const icon = await fetchBuf(iconHref)
  check('favicon resolves', !!icon?.ok, `status=${icon?.status}`)
} else {
  // Next.js App Router injects /icon or /favicon.ico by convention even
  // without a <link>; probe the conventions directly
  const ico = (await fetchBuf('/favicon.ico')) ?? (await fetchBuf('/icon'))
  check('favicon resolves (convention probe)', !!ico?.ok, 'no icon link and no conventional icon route')
}

// ── 7. images referenced by the page ─────────────────────────────────────────
const imgSrcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])
if (imgSrcs.length) {
  let imgsOk = true
  for (const i of imgSrcs) {
    const res = await fetchBuf(i)
    if (!res?.ok) {
      imgsOk = false
      console.log(`    image failed to load: ${i} (${res?.status ?? 'fetch error'})`)
    }
  }
  check('every <img> referenced by the page resolves', imgsOk)
} else {
  check('no <img> references on the landing page (nothing to break)', true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
