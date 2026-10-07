// ROYAL RED artifact version history: immutable snapshots after every artifact write.
// Lives in its own module so both agent.ts and tools.ts can use it without a cycle.
import { db } from '@/lib/db'

export async function snapshotArtifactVersion(
  artifactId: string,
  filesJson: string,
  note?: string,
): Promise<void> {
  try {
    const last = await db.royalRedArtifactVersion.findFirst({
      where: { artifactId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    await db.royalRedArtifactVersion.create({
      data: { artifactId, files: filesJson, version: (last?.version ?? 0) + 1, note },
    })
  } catch (e) {
    console.error('artifact version snapshot failed', e)
  }
}
