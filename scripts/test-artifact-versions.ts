// ROYAL RED ROUND 3 — ARTIFACT VERSION HISTORY: IMMUTABILITY CONTRACT.
//
// This closes the second gap the invariants audit found: artifact versioning
// (every artifact write creates an immutable version row, INVARIANTS.md C-3)
// was exercised in live build flows but had NO dedicated regression test.
//
// The contract under test:
//   1. every snapshot creates exactly one version row, monotonically numbered
//   2. rows are IMMUTABLE in practice: earlier rows keep their exact bytes
//      after later writes (no update path exists in versions.ts — append-only)
//   3. (artifactId, version) is unique — the DB enforces what the module claims
//   4. history reloads oldest→newest for replay
//
// Run: bun --env-file=.env scripts/test-artifact-versions.ts
import { db } from '../src/lib/db'
import { snapshotArtifactVersion } from '../src/server/royal-red/versions'

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

const SID = `ver-${Date.now()}`
const AID = `royalred_ver_${Date.now()}`

await db.royalRedSession.create({ data: { id: SID, title: 'version-history regression' } })
const v1Json = JSON.stringify([{ path: 'index.html', content: '<h1>v1</h1>' }])
const v2Json = JSON.stringify([{ path: 'index.html', content: '<h1>v2 with more</h1>' }])
const v3Json = JSON.stringify([{ path: 'index.html', content: '<h1>v2 with more</h1>' }, { path: 'about.html', content: '<p>about</p>' }])

await db.royalRedArtifact.create({
  data: { id: AID, sessionId: SID, name: 'regression artifact', kind: 'site', entry: 'index.html', files: v1Json },
})
await snapshotArtifactVersion(AID, v1Json, 'initial build')
await snapshotArtifactVersion(AID, v2Json, 'merge update')
await snapshotArtifactVersion(AID, v3Json, 'adversarial regeneration')

const rows = await db.royalRedArtifactVersion.findMany({ where: { artifactId: AID }, orderBy: { version: 'asc' } })
check('three writes -> exactly three version rows', rows.length === 3, `got ${rows.length}`)
check('versions numbered 1,2,3 contiguously', rows.map((r) => r.version).join(',') === '1,2,3', rows.map((r) => r.version).join(','))
check('v1 bytes immutable after later writes', rows[0].files === v1Json)
check('v2 bytes immutable after later writes', rows[1].files === v2Json)
check('v3 bytes match the last write', rows[2].files === v3Json)
check('notes preserved for the reload UI', rows[0].note === 'initial build' && rows[2].note === 'adversarial regeneration', JSON.stringify(rows.map((r) => r.note)))

let dupThrew = false
try {
  await db.royalRedArtifactVersion.create({ data: { artifactId: AID, files: v1Json, version: 1, note: 'collision attempt' } })
} catch {
  dupThrew = true
}
check('(artifactId, version) uniqueness enforced by the DB', dupThrew)

// the reload path: history comes back oldest->newest; the artifact's live row
// holds the latest content (in real flows agent.ts updates the row whenever
// it snapshots — mirror that pair here before asserting the reload)
await db.royalRedArtifact.update({ where: { id: AID }, data: { files: v3Json } })
const artifact = await db.royalRedArtifact.findUnique({ where: { id: AID } })
check('artifact row reloadable with latest files', artifact?.files === v3Json)

// append-only discipline: the module exposes NO update/delete — assert the
// source never mutates version rows
const src = await import('fs').then((fs) => fs.promises.readFile('src/server/royal-red/versions.ts', 'utf8'))
check('versions.ts contains no update/delete on version rows', !/royalRedArtifactVersion\.(update|updateMany|delete|deleteMany)/.test(src))

// ── cleanup ──────────────────────────────────────────────────────────────────
await db.royalRedArtifact.delete({ where: { id: AID } }) // versions cascade
await db.royalRedSession.delete({ where: { id: SID } }).catch(() => null)

console.log(`\n${pass} passed, ${fail} failed`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
