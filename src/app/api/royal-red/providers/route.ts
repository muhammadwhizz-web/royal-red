import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encryptSecret, maskKey } from '@/server/royal-red/verify/crypto'

// ROYAL RED critique-provider config API (Phase 2.2).
//
// BYO second-model keys, used EXCLUSIVELY for adversarial critique. Security
// contract:
// - API keys are stored AES-256-GCM encrypted at rest
// - no API here ever returns a key; only the masked hint survives a GET
// - baseUrl must be a valid http(s) endpoint; localhost URLs are allowed so
//   local model runners (ollama, lm studio) work, everything else must be https
// - every mutation is audit-logged
// - activating a provider deactivates others (single active critic at a time)

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

export async function GET() {
  const rows = await db.royalRedProviderConfig.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json({
    providers: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      baseUrl: r.baseUrl,
      model: r.model,
      keyHint: r.keyHint,
      hasKey: !!r.apiKeyEnc,
      purpose: r.purpose,
      active: r.active,
      createdAt: r.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { provider?: string; label?: string; baseUrl?: string; model?: string; apiKey?: string; activate?: boolean }
    | null
  const provider = ['openai', 'anthropic', 'custom'].includes(String(body?.provider)) ? String(body?.provider) : null
  const label = String(body?.label ?? '').trim().slice(0, 60)
  const model = String(body?.model ?? '').trim().slice(0, 120)
  const baseUrl = body?.baseUrl ? validBaseUrl(String(body.baseUrl)) : null
  const apiKey = String(body?.apiKey ?? '').trim()
  if (!provider || !label || !model || !baseUrl) {
    return NextResponse.json({ error: 'provider, label, model and a valid baseUrl are required' }, { status: 400 })
  }

  const created = await db.royalRedProviderConfig.create({
    data: {
      provider,
      label,
      model,
      baseUrl,
      apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
      keyHint: apiKey ? maskKey(apiKey) : null,
      purpose: 'critique',
      active: false,
    },
  })
  if (body?.activate) {
    await db.royalRedProviderConfig.updateMany({ where: { purpose: 'critique' }, data: { active: false } })
    await db.royalRedProviderConfig.update({ where: { id: created.id }, data: { active: true } })
    created.active = true
  }
  await db.royalRedAudit
    .create({ data: { action: 'provider.create', detail: `${provider}:${label} (${maskKey(apiKey || '(none)')})`, ok: true } })
    .catch(() => {})

  return NextResponse.json({
    id: created.id,
    provider: created.provider,
    label: created.label,
    model: created.model,
    baseUrl: created.baseUrl,
    keyHint: created.keyHint,
    hasKey: !!created.apiKeyEnc,
    active: created.active,
  })
}

// PATCH: activate / deactivate / rotate key
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; active?: boolean; apiKey?: string }
    | null
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await db.royalRedProviderConfig.findUnique({ where: { id: body.id } })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const data: { active?: boolean; apiKeyEnc?: string; keyHint?: string } = {}
  if (typeof body.active === 'boolean') {
    data.active = body.active
    if (body.active) {
      await db.royalRedProviderConfig.updateMany({ where: { purpose: 'critique', id: { not: row.id } }, data: { active: false } })
    }
  }
  if (body.apiKey && String(body.apiKey).trim()) {
    data.apiKeyEnc = encryptSecret(String(body.apiKey).trim())
    data.keyHint = maskKey(String(body.apiKey).trim())
  }
  const updated = await db.royalRedProviderConfig.update({ where: { id: row.id }, data })
  await db.royalRedAudit
    .create({ data: { action: 'provider.update', detail: `${row.label} active=${updated.active}${data.apiKeyEnc ? ' key-rotated' : ''}`, ok: true } })
    .catch(() => {})
  return NextResponse.json({ ok: true, active: updated.active, keyHint: updated.keyHint })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await db.royalRedProviderConfig.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await db.royalRedProviderConfig.delete({ where: { id } })
  await db.royalRedAudit.create({ data: { action: 'provider.delete', detail: row.label, ok: true } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
