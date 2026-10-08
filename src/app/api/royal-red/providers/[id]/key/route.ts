import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findProvider } from '@/server/royal-red/providers/matrix'
import { saveKey, deleteKey, getKeyRow } from '@/server/royal-red/providers/keys'
import { invalidateKeyCache } from '@/server/royal-red/providers/creds'
import { maskKey } from '@/server/royal-red/verify/crypto'

export const dynamic = 'force-dynamic'

function validBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.protocol === 'http:') {
      const h = u.hostname
      const local = h === 'localhost' || h === '127.0.0.1' || h === '::1'
      if (!local) return null // plaintext http only tolerated for local runners
    }
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

// POST /api/royal-red/providers/:id/key — save or rotate the key.
// Body: { key?, baseUrl?, model?, orgId?, headers?, region? }. The key is
// AES-256-GCM encrypted and never echoed back; the response carries the hint.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await findProvider(id)
  if (!p) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as
    | { key?: string; baseUrl?: string; model?: string; orgId?: string; headers?: Record<string, string>; region?: string; rotate?: boolean }
    | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const key = typeof body.key === 'string' ? body.key.trim() : ''
  const existing = await getKeyRow(id)
  const rotating = !!body.rotate
  if (rotating && !key) return NextResponse.json({ error: 'rotation needs the new key value' }, { status: 400 })
  if (!existing?.hasKey && !key && p.requiresKey) {
    return NextResponse.json({ error: 'no key stored yet for this provider: provide one' }, { status: 400 })
  }
  // plausibility check: keys are at least 8 chars and have no whitespace
  if (key && (key.length < 8 || /\s/.test(key))) {
    return NextResponse.json({ error: 'that key does not look valid: 8+ characters, no spaces' }, { status: 400 })
  }

  let baseUrl: string | null = existing?.baseUrl ?? null
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    baseUrl = validBaseUrl(body.baseUrl.trim())
    if (!baseUrl) return NextResponse.json({ error: 'baseUrl must be a valid http(s) URL (http only for localhost)' }, { status: 400 })
  }

  const row = await saveKey({
    providerId: id,
    key: key || undefined,
    baseUrl,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 160) : undefined,
    orgId: typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim().slice(0, 120) : undefined,
    headers: body.headers && Object.keys(body.headers).length ? body.headers : undefined,
    region: typeof body.region === 'string' && body.region.trim() ? body.region.trim() : undefined,
  })
  invalidateKeyCache()

  const action = rotating ? 'provider.key.rotated' : existing?.hasKey ? 'provider.key.saved' : 'provider.key.saved'
  await db.royalRedAudit.create({
    data: { action, detail: `${p.label} (${id}) keyHint=${row.keyHint ?? (maskKey(key) || '(none)')}`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})

  return NextResponse.json({ ok: true, providerId: id, keyHint: row.keyHint, hasKey: row.hasKey, baseUrl: row.baseUrl, model: row.model })
}

// DELETE /api/royal-red/providers/:id/key — remove the stored key. The
// provider stays in the matrix and shows status "No key".
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await findProvider(id)
  if (!p) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
  const removed = await deleteKey(id)
  invalidateKeyCache()
  await db.royalRedAudit.create({
    data: { action: 'provider.key.deleted', detail: `${p.label} (${id}) key removed from the encrypted store`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: removed ? true : false, providerId: id })
}
