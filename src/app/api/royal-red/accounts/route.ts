import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ROYAL RED System console APIs: accounts + audit + diagnostics trigger helper.
// All state mutations here are explicit human actions (consent enforced in UI).

export async function GET() {
  const accounts = await db.royalRedAccount.findMany({ orderBy: { createdAt: 'asc' } })
  const audit = await db.royalRedAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      username: a.username,
      role: a.role,
      note: a.note,
      createdAt: a.createdAt,
    })),
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action,
      detail: a.detail,
      ok: a.ok,
      createdAt: a.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { action?: string; username?: string; role?: string; note?: string }
    | null
  const action = body?.action

  if (action === 'create_account') {
    const username = String(body?.username ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
    if (!username) return NextResponse.json({ error: 'invalid username' }, { status: 400 })
    const exists = await db.royalRedAccount.findUnique({ where: { username } })
    if (exists) return NextResponse.json({ error: 'account exists' }, { status: 409 })
    const acc = await db.royalRedAccount.create({
      data: {
        username,
        role: body?.role === 'admin' ? 'admin' : 'user',
        note: body?.note?.slice(0, 200) ?? null,
      },
    })
    await db.royalRedAudit.create({ data: { action: 'account.create', detail: username, ok: true } })
    return NextResponse.json({ account: acc })
  }

  if (action === 'remove_account') {
    const username = String(body?.username ?? '').trim().toLowerCase()
    const deleted = await db.royalRedAccount.delete({ where: { username } }).catch(() => null)
    if (!deleted) return NextResponse.json({ error: 'no such account' }, { status: 404 })
    await db.royalRedAudit.create({ data: { action: 'account.remove', detail: username, ok: true } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
