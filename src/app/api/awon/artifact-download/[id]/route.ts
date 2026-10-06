import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isImagePath, readArtifactFileBuffer } from '@/server/awon/workspace'
import { buildZip } from '@/server/awon/zip'

// artifact ZIP export: text files come from the db, binary tombstones from disk

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const artifact = await db.awonArtifact.findUnique({
    where: { id },
    select: { name: true, files: true },
  })
  if (!artifact) return new NextResponse('not found', { status: 404 })
  const dbFiles = JSON.parse(artifact.files) as { path: string; content: string }[]
  if (!dbFiles.length) return new NextResponse('empty artifact', { status: 404 })
  // binary tombstones (images) read from disk; text files from db
  const files = []
  for (const f of dbFiles) {
    if (isImagePath(f.path) && f.content === '') {
      const buf = readArtifactFileBuffer(id, f.path)
      if (buf) files.push({ path: f.path, content: '', data: buf })
    } else {
      files.push({ path: f.path, content: f.content })
    }
  }
  if (!files.length) return new NextResponse('empty artifact', { status: 404 })
  const zip = buildZip(files)
  const safeName = artifact.name.replace(/[^a-z0-9-_]/gi, '_').slice(0, 60) || 'awon-artifact'
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
