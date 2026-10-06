import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Returns artifact files with full contents (used by the Files tab).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const artifact = await db.awonArtifact.findUnique({
    where: { id },
    select: { files: true },
  })
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ files: JSON.parse(artifact.files) })
}
