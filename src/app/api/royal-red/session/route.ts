import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SEL = { id: true, title: true, mode: true, pinned: true, updatedAt: true } as const

// Cursor-paginated session index (50 per page).
// Pinned sessions always lead page 0 (they are few, capped at 100); the
// unpinned tail pages by a compound (updatedAt|id) cursor for stable ordering.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 100)
  const cursorRaw = sp.get('cursor')

  const unpinnedWhere = (() => {
    if (!cursorRaw) return { pinned: false }
    const sep = cursorRaw.lastIndexOf('|')
    if (sep < 0) return null
    const ts = cursorRaw.slice(0, sep)
    const id = cursorRaw.slice(sep + 1)
    const cu = new Date(ts)
    if (Number.isNaN(cu.getTime()) || !id) return null
    return {
      pinned: false,
      OR: [{ updatedAt: { lt: cu } }, { updatedAt: cu, id: { lt: id } }],
    }
  })()
  if (unpinnedWhere === null) return NextResponse.json({ error: 'bad cursor' }, { status: 400 })

  const unpinned = await db.royalRedSession.findMany({
    where: unpinnedWhere,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: SEL,
  })

  let sessions
  let nextCursor: string | null = null
  if (cursorRaw) {
    sessions = unpinned
  } else {
    const pinned = await db.royalRedSession.findMany({
      where: { pinned: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: SEL,
    })
    sessions = [...pinned, ...unpinned]
  }
  if (unpinned.length === limit && unpinned.length > 0) {
    const last = unpinned[unpinned.length - 1]
    nextCursor = `${last.updatedAt.toISOString()}|${last.id}`
  }

  return NextResponse.json({ sessions, nextCursor })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; mode?: string }
  const session = await db.royalRedSession.create({
    data: {
      title: (body.title ?? 'New session').slice(0, 80),
      mode: body.mode ?? 'build',
    },
  })
  return NextResponse.json({ session })
}
