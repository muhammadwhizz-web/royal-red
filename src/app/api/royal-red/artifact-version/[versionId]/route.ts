import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// File content inside an immutable artifact version snapshot.
// GET /api/royal-red/artifact-version/<versionId>?path=index.html
export async function GET(req: NextRequest, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params
  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const version = await db.royalRedArtifactVersion.findUnique({
    where: { id: versionId },
    select: { files: true },
  })
  if (!version) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const files = JSON.parse(version.files) as { path: string; content: string }[]
  const hit = files.find((f) => f.path === path)
  if (!hit) return NextResponse.json({ error: 'path not in snapshot' }, { status: 404 })
  return NextResponse.json({ path: hit.path, content: hit.content })
}
