// ROYAL RED workspace browser: list, inspect, and manage the user-files half of the
// sandboxed workspace (uploads + anything the agent wrote via write_file).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listUserFiles, resolveUserFile, WORKSPACE_ROOT } from '@/server/royal-red/workspace'
import fs from 'fs'
import path from 'path'

const KIND_IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i
const KIND_MEDIA = /\.(mp4|webm|mov|mkv|avi|mp3|wav|ogg|m4a)$/i
const KIND_CODE = /\.(py|js|mjs|cjs|ts|tsx|jsx|sh|html|css|rs|go|c|cpp|h|java|rb|php|sql)$/i
const KIND_DATA = /\.(json|csv|xml|md|txt|log|ya?ml|toml|ini|conf|env)$/i

type WsKind = 'image' | 'media' | 'code' | 'data' | 'other'

function wsKind(p: string): WsKind {
  if (KIND_IMAGE.test(p)) return 'image'
  if (KIND_MEDIA.test(p)) return 'media'
  if (KIND_CODE.test(p)) return 'code'
  if (KIND_DATA.test(p)) return 'data'
  return 'other'
}

export async function GET(req: NextRequest) {
  const files = listUserFiles()
  if (req.nextUrl.searchParams.get('stats')) {
    let bytes = 0
    const byKind: Record<WsKind, number> = { image: 0, media: 0, code: 0, data: 0, other: 0 }
    const kindBytes: Record<WsKind, number> = { image: 0, media: 0, code: 0, data: 0, other: 0 }
    for (const f of files) {
      bytes += f.size
      const k = wsKind(f.path)
      byKind[k] += 1
      kindBytes[k] += f.size
    }
    return NextResponse.json({ files, stats: { files: files.length, bytes, byKind, kindBytes } })
  }
  return NextResponse.json({ files })
}

export async function DELETE(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get('path') ?? ''
  const clean = rel.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.includes('..')) {
    return NextResponse.json({ error: 'bad path' }, { status: 400 })
  }
  const target = resolveUserFile(clean)
  if (!target.startsWith(path.join(WORKSPACE_ROOT, 'files') + path.sep)) {
    return NextResponse.json({ error: 'path outside workspace files' }, { status: 400 })
  }
  try {
    const stat = fs.statSync(target)
    if (!stat.isFile()) return NextResponse.json({ error: 'not a file' }, { status: 400 })
    fs.unlinkSync(target)
    await db.royalRedAudit.create({
      data: { action: 'workspace.file.remove', detail: clean, ok: true },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 })
  }
}
