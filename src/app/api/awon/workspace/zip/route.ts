// Export the whole user-files workspace (uploads + agent outputs) as a zip.
import { NextResponse } from 'next/server'
import { listUserFiles, resolveUserFile } from '@/server/awon/workspace'
import { buildZip } from '@/server/awon/zip'
import fs from 'fs'

const TOTAL_CAP = 128 * 1024 * 1024

export async function GET() {
  const files = listUserFiles()
  if (!files.length) return new NextResponse('workspace is empty', { status: 404 })
  const entries: { path: string; content: string; data?: Buffer }[] = []
  let total = 0
  for (const f of files) {
    if (total + f.size > TOTAL_CAP) continue
    try {
      const buf = fs.readFileSync(resolveUserFile(f.path))
      entries.push({ path: f.path, content: '', data: buf })
      total += f.size
    } catch {}
  }
  if (!entries.length) return new NextResponse('workspace files unreadable', { status: 500 })
  const zip = buildZip(entries)
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="awon-workspace-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
