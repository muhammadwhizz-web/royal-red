// One-time backfill: give every pre-existing artifact a v1 version snapshot so
// the version-history diff view has data for old sessions. Idempotent.
import { db } from '@/lib/db'

async function main() {
  const artifacts = await db.royalRedArtifact.findMany({
    select: { id: true, files: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  let created = 0
  for (const a of artifacts) {
    const existing = await db.royalRedArtifactVersion.findFirst({ where: { artifactId: a.id }, select: { id: true } })
    if (existing) continue
    await db.royalRedArtifactVersion.create({
      data: { artifactId: a.id, files: a.files, version: 1, note: 'backfill v1', createdAt: a.createdAt },
    })
    created++
  }
  console.log(`backfill complete: ${created} artifacts snapshotted (${artifacts.length} total)`)
  await db.$disconnect()
}
void main()
