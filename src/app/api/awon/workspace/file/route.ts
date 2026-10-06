// Download (or inline-render) a single workspace file. Sandboxed to files/.
import { NextRequest } from 'next/server'
import { resolveUserFile, WORKSPACE_ROOT } from '@/server/awon/workspace'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'

// text extensions the inline editor is allowed to touch; everything else
// (binaries, videos, images) is read-only and download-only
const TEXT_EDIT_EXTS = new Set([
  'txt', 'md', 'json', 'csv', 'html', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx',
  'jsx', 'py', 'sh', 'svg', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf',
  'env', 'log', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'rb', 'php', 'sql',
])

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  ts: 'text/typescript; charset=utf-8',
}

const INLINE_OK = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'mp4', 'webm', 'pdf', 'txt', 'md'])

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get('path') ?? ''
  const clean = rel.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.includes('..')) {
    return Response.json({ error: 'bad path' }, { status: 400 })
  }
  const target = resolveUserFile(clean)
  if (!target.startsWith(path.join(WORKSPACE_ROOT, 'files') + path.sep)) {
    return Response.json({ error: 'path outside workspace files' }, { status: 400 })
  }
  try {
    const stat = fs.statSync(target)
    if (!stat.isFile()) return Response.json({ error: 'not a file' }, { status: 400 })
    if (stat.size > 64 * 1024 * 1024) {
      return Response.json({ error: 'file too large (64MB cap)' }, { status: 413 })
    }
    const buf = fs.readFileSync(target)
    const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : ''
    const mime = MIME[ext] ?? 'application/octet-stream'
    const inline = INLINE_OK.has(ext)
    const name = clean.split('/').pop() ?? 'file'
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buf.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 })
  }
}

// Save an edited text file back into the workspace. 512KB cap, text-only,
// jailed to files/, every write is audit-logged.
export async function PUT(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get('path') ?? ''
  const clean = rel.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.includes('..')) {
    return Response.json({ error: 'bad path' }, { status: 400 })
  }
  const target = resolveUserFile(clean)
  if (!target.startsWith(path.join(WORKSPACE_ROOT, 'files') + path.sep)) {
    return Response.json({ error: 'path outside workspace files' }, { status: 400 })
  }
  const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : ''
  if (!TEXT_EDIT_EXTS.has(ext)) {
    return Response.json({ error: 'only text files can be edited here' }, { status: 415 })
  }
  const body = await req.text()
  if (Buffer.byteLength(body, 'utf8') > 512 * 1024) {
    return Response.json({ error: 'file too large to edit (512KB cap)' }, { status: 413 })
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, body, 'utf8')
    await db.awonAudit.create({
      data: {
        action: 'workspace.file.edit',
        detail: `${clean} (${Buffer.byteLength(body, 'utf8')} bytes)`,
        ok: true,
      },
    })
    return Response.json({ ok: true, size: Buffer.byteLength(body, 'utf8') })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
