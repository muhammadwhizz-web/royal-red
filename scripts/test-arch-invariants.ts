// ROYAL RED ROUND 3 — ARCHITECTURE INVARIANT CHECKS (directive 1: every
// invariant gets a "how it's tested" line; these are the executable greps).
//
// Encodes the kernel's structural laws as fail-loud assertions over the
// source tree itself. These complement the behavioral suites (kernel units,
// router, soft spots, acceptance): those prove the kernel BEHAVES; this
// proves the SHAPE that makes the behavior auditable has not quietly rotted.
//
// Run: bun --env-file=.env scripts/test-arch-invariants.ts
import fs from 'fs'
import path from 'path'

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

const ROOT = path.resolve(import.meta.dir, '..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(d.name)) out.push(p)
  }
  return out
}
const rel = (p: string) => path.relative(SRC, p).replaceAll('\\', '/')
const files = walk(SRC).map((p) => ({ path: rel(p), text: fs.readFileSync(p, 'utf8') }))

// ── INVARIANT: LLM seam — all model calls flow through the seam ─────────────
// (INVARIANTS.md S-8). The adapter layer EXECUTES model calls; the router
// drives it; the seam drives the router. Nothing else may import them.
// providers/types (pure types + DEFAULT_POLICY) is importable anywhere.
const seamAllowed = {
  'providers/adapters': [/^server\/royal-red\/llm\//, /^server\/royal-red\/router\//, /^server\/royal-red\/providers\//],
  'providers/registry': [/^server\/royal-red\/llm\//, /^server\/royal-red\/router\//, /^server\/royal-red\/providers\//, /^app\/api\/royal-red\/router\//],
  'providers/creds': [/^server\/royal-red\/llm\//, /^server\/royal-red\/router\//, /^server\/royal-red\/providers\//, /^app\/api\/royal-red\/router\//, /^app\/api\/royal-red\/providers\//],
  'providers/health': [/^server\/royal-red\/llm\//, /^server\/royal-red\/router\//, /^server\/royal-red\/providers\//, /^app\/api\/royal-red\/router\//, /^app\/api\/royal-red\/providers\//],
} as const

console.log('LLM seam:')
for (const [mod, allow] of Object.entries(seamAllowed)) {
  const offenders = files
    .filter((f) => new RegExp(`from ['"].*${mod}['"]`).test(f.text))
    .filter((f) => !allow.some((re) => re.test(f.path)))
  check(`${mod} imported only behind the seam boundary`, offenders.length === 0, offenders.map((o) => o.path).join(', '))
}
const directFetch = files
  .filter((f) => /^server\/royal-red\//.test(f.path) && !/^server\/royal-red\/(providers|llm|router)\//.test(f.path))
  .filter((f) => /fetch\(\s*[`'"]https?:\/\/(api\.|openai|anthropic|generativelanguage|deepseek|moonshot|dashscope|bigmodel)/i.test(f.text))
check('no direct provider-host fetch() outside the seam family', directFetch.length === 0, directFetch.map((o) => o.path).join(', '))

// ── INVARIANT: trash-only law — no delete in the Box, ever ──────────────────
// (INVARIANTS.md S-4). rm is structurally absent: Box deletes are moves into
// .awon-trash. Destructive fs calls may exist ONLY on kernel-owned storage
// outside the Box, each individually audited:
//   box/screen.ts            — its own raw RGB scratch frame in BOX_TMP
//   api session/[id]/route   — kernel artifact storage on session delete (audited)
//   api workspace/route      — BYOK workspace file remove (path-guarded, audited)
const destructiveAllow = new Set([
  'server/royal-red/box/screen.ts',
  'app/api/royal-red/session/[id]/route.ts',
  'app/api/royal-red/workspace/route.ts',
])
console.log('trash-only law:')
const destructive = files.filter((f) => /\b(unlinkSync|rmdirSync|rmSync)\b/.test(f.text))
const destructiveOffenders = destructive.filter((f) => !destructiveAllow.has(f.path))
check('destructive fs calls confined to kernel-owned storage (allowlist)', destructiveOffenders.length === 0, destructiveOffenders.map((o) => o.path).join(', ') || `allowed: ${[...destructiveAllow].filter((a) => destructive.some((d) => d.path === a)).join(', ')}`)
const shellRm = files.filter((f) => /exec(File|Sync)?\(\s*[`'"]rm[`'"]|spawn(Sync)?\(\s*[`'"]rm[`'"]|\bexec\s+rm\b/.test(f.text))
check('no shell `rm` invocation anywhere in the kernel', shellRm.length === 0, shellRm.map((o) => o.path).join(', '))

// ── INVARIANT: path prison — no code path touches the real home ─────────────
// (INVARIANTS.md S-1). The user's real home directories must never appear as
// path literals or operation targets; the Box emulates them under
// /home/z/my-project/royalred-box. Allowed /home/z roots: the kernel's own
// project tree, the read-only OSWorld payload, the payload intake dir.
console.log('path prison:')
const allowedHomeRoots = ['/home/z/my-project', '/home/z/wh-work', '/home/z/rr-payload', '/home/z/git-recovery', '/home/z/tmp']
const userHomeLiterals = files.filter((f) => {
  const hits = f.text.match(/\/home\/z\/[A-Za-z0-9_.-]+/g) ?? []
  return hits.some((h) => !allowedHomeRoots.some((r) => h.startsWith(r)))
})
check('no path literals into the real user home (outside allowed kernel roots)', userHomeLiterals.length === 0, userHomeLiterals.map((o) => `${o.path}`).join(', '))

// ── INVARIANT: supervised processes only ─────────────────────────────────────
// (INVARIANTS.md S-1 companion). Child processes may be spawned only by the
// box runtime/supervision modules, the box tools bridge, the screen
// subsystem, and the permitted-PC route — all documented, all audited.
console.log('supervised processes:')
// verify/browser.ts is the browser-hands subsystem: it drives the supervised
// agent-browser CLI (session-scoped, URL-prisoned to the preview origin). It
// is a documented execution surface, same class as box/runtime supervision.
const procAllowed = [/^server\/royal-red\/box\//, /^server\/royal-red\/tools\.ts$/, /^server\/royal-red\/verify\/browser\.ts$/, /^app\/api\/royal-red\/pc\//]
const procSites = files.filter((f) => /from ['"]child_process['"]|require\(['"]child_process['"]\)/.test(f.text))
const procOffenders = procSites.filter((f) => !procAllowed.some((re) => re.test(f.path)))
check('child_process confined to supervised execution surfaces', procOffenders.length === 0, procOffenders.map((o) => o.path).join(', '))

// ── INVARIANT: provider keys never returned in plaintext ────────────────────
// (INVARIANTS.md S-6). Keys travel in exactly two sanctioned directions:
//   - INTO the DB encrypted (encryptSecret in the providers API route)
//   - OUT to the provider they belong to, inside request bodies built by the
//     adapters (that is the whole point of BYOK)
// They must NEVER be projected by a prisma select, and the app/response layer
// (src/app) must never stringify one into a response.
console.log('provider key hygiene:')
const keySelects = files.filter((f) => /select\s*:\s*\{[^}]*\bapiKey\b/.test(f.text))
check('no apiKey projected by a prisma select', keySelects.length === 0, keySelects.map((o) => o.path).join(', '))
const appKeyStringify = files
  .filter((f) => /^app\//.test(f.path))
  .filter((f) => /JSON\.stringify\([^)]*\bapiKey\b/.test(f.text))
check('app/response layer never stringifies a raw key', appKeyStringify.length === 0, appKeyStringify.map((o) => o.path).join(', '))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
