import { NextRequest, NextResponse } from 'next/server'
import { readArtifactFile, readArtifactFileBuffer, isImagePath } from '@/server/royal-red/workspace'

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await ctx.params
  const rel = (path ?? []).join('/') || 'index.html'
  const ext = rel.includes('.') ? rel.split('.').pop()!.toLowerCase() : 'html'

  // binary assets (generated images, fonts) come straight from disk
  if (isImagePath(rel) || ext === 'woff' || ext === 'woff2') {
    const buf = readArtifactFileBuffer(id, rel)
    if (!buf) return new NextResponse('ROYAL RED: artifact file not found', { status: 404 })
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    })
  }

  const content = readArtifactFile(id, rel)
  if (content === null) {
    return new NextResponse('ROYAL RED: artifact file not found', { status: 404 })
  }
  return new NextResponse(content, {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  })
}
