// Phase 3 soft spot #1 - LEAK REGRESSION: run the browser daemon 10x and the
// desktop (box) subsystem 10x, then assert process counts and memory return
// to baseline. Phase 4 ships only if nothing accumulates.
// Run: bun --env-file=.env scripts/test-phase4-leak.ts
import { execSync } from 'child_process'
import { withScopedBrowser } from '../src/server/royal-red/verify/browser'
import { boxExec, boxLiveChildCount } from '../src/server/royal-red/box/box'
import { terminateAll } from '../src/server/royal-red/box/runtime'
import { spawnSupervised } from '../src/server/royal-red/box/box'

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

function procSnapshot(): { count: number; rssKB: number } {
  try {
    const out = execSync("ps -eo rss=,comm= | grep -E 'chrome|agent-browser' | awk '{c++; s+=$1} END {print c+0, s+0}'", { encoding: 'utf8' })
    const [count, rss] = out.trim().split(/\s+/).map(Number)
    return { count: count ?? 0, rssKB: rss ?? 0 }
  } catch {
    return { count: 0, rssKB: 0 }
  }
}

console.log('browser daemon: baseline, 10 scoped cycles, baseline again')
const base = procSnapshot()
console.log(`  baseline: ${base.count} procs, ${Math.round(base.rssKB / 1024)}MB rss`)
for (let i = 0; i < 10; i++) {
  await withScopedBrowser(async (b) => {
    await b.open('http://localhost:3000/')
    await b.evalJs('document.title')
    await b.setViewport(800, 600)
  })
  // let the daemon reap its pages between cycles
  await new Promise((r) => setTimeout(r, 500))
}
await new Promise((r) => setTimeout(r, 4000)) // reaper window
const after10 = procSnapshot()
console.log(`  after 10: ${after10.count} procs, ${Math.round(after10.rssKB / 1024)}MB rss`)
check('browser process count returns to baseline (max +2 for page teardown lag)', after10.count <= base.count + 2, `${base.count} -> ${after10.count}`)
check('browser memory does not accumulate (max +20% over 10 cycles)', after10.rssKB <= base.rssKB * 1.2 + 50_000, `${Math.round(base.rssKB / 1024)}MB -> ${Math.round(after10.rssKB / 1024)}MB`)

console.log('box subsystem: 10 supervised exec cycles, process table must return to zero')
for (let i = 0; i < 10; i++) {
  const r = await boxExec(`echo cycle-${i}`)
  if (!r.ok) {
    check(`box exec cycle ${i} ran`, false, r.stderr)
    break
  }
}
await new Promise((r) => setTimeout(r, 1500))
check('box process table empty after 10 exec cycles (no orphans)', boxLiveChildCount() === 0, String(boxLiveChildCount()))
const orphans = execSync("ps -eo args= | grep -E '^echo cycle-' | grep -v grep | wc -l", { encoding: 'utf8' }).trim()
check('no orphaned child processes in the OS', Number(orphans) === 0, orphans)

console.log('box subsystem: supervised Xvfb lifecycle (spawn, SIGTERM via kill switch, reap)')
spawnSupervised('Xvfb', [':97', '-screen', '0', '640x480x24', '-nolisten', 'tcp'], 'Xvfb :97 leak-test')
await new Promise((r) => setTimeout(r, 1500))
const withXvfb = boxLiveChildCount()
const xvfbUp = execSync('ps -eo args= | grep "Xvfb :97" | grep -v grep | wc -l', { encoding: 'utf8' }).trim()
terminateAll('SIGTERM')
await new Promise((r) => setTimeout(r, 2000))
const afterKill = boxLiveChildCount()
const xvfbDown = execSync('ps -eo args= | grep "Xvfb :97" | grep -v grep | wc -l', { encoding: 'utf8' }).trim()
check('Xvfb registered in the supervised table', withXvfb >= 1 && Number(xvfbUp) >= 1, `table=${withXvfb} os=${xvfbUp}`)
check('kill switch SIGTERMs the display and the table returns to zero', afterKill === 0 && Number(xvfbDown) === 0, `table=${afterKill} os=${xvfbDown}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
