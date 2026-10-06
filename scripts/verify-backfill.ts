// Verification: every artifact must have >=1 version snapshot; every repaired row too.
import { db } from '@/lib/db'
async function main() {
  const artifacts = await db.awonArtifact.findMany({ select: { id: true, sessionId: true, entry: true, files: true, createdAt: true } })
  const versions = await db.awonArtifactVersion.findMany({ select: { artifactId: true, version: true, note: true, files: true } })
  const distinctIds = new Set(versions.map(v => v.artifactId))
  console.log(`artifacts total:              ${artifacts.length}`)
  console.log(`distinct artifact_ids in ver: ${distinctIds.size}`)
  console.log(`version rows total:           ${versions.length}`)
  const missing = artifacts.filter(a => !distinctIds.has(a.id))
  console.log(`\nMISSING snapshots: ${missing.length}`)
  for (const m of missing) console.log(`  - ${m.id} session=${m.sessionId}`)
  const counts = new Map<string, number>()
  for (const v of versions) counts.set(v.artifactId, (counts.get(v.artifactId) ?? 0) + 1)
  console.log(`\nper-artifact coverage:`)
  for (const a of artifacts) {
    const n = counts.get(a.id) ?? 0
    const fl = (JSON.parse(a.files as string) as any)?.files?.length ?? 0
    const flag = n === 0 ? '  <-- GAP' : ''
    console.log(`  ${a.id.slice(0,10)} entry=${(a.entry ?? 'none').padEnd(30).slice(0,30)} files=${String(fl).padStart(2)} versions=${n}${flag}`)
  }
  let bad = 0
  for (const v of versions) {
    try { const f = JSON.parse(v.files as string); if (!Array.isArray(f)) throw new Error('files not array') }
    catch (e) { bad++; console.log(`  MALFORMED v${v.version} of ${v.artifactId.slice(0,10)}: ${(e as Error).message}`) }
  }
  console.log(`\nmalformed version rows: ${bad}`)
  const repaired = versions.filter(v => (v.note ?? '').includes('repair'))
  console.log(`repair-flagged version rows: ${repaired.length}`)
  await db.$disconnect()
}
main()
