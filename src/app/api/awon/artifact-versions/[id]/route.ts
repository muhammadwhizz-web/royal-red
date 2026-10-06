import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Session-wide artifact version timeline (newest first). Given any artifact id,
// returns every immutable version snapshot of every artifact in the same session,
// so the Files tab can diff the current file against any point in build history.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const artifact = await db.awonArtifact.findUnique({
    where: { id },
    select: { sessionId: true },
  })
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const versions = await db.awonArtifactVersion.findMany({
    where: { artifact: { sessionId: artifact.sessionId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      artifactId: true,
      version: true,
      note: true,
      createdAt: true,
      artifact: { select: { name: true } },
    },
  })

  return NextResponse.json({
    versions: versions.map((v) => ({
      versionId: v.id,
      artifactId: v.artifactId,
      artifactName: v.artifact.name,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
    })),
  })
}
