import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customProviders } from '@/server/royal-red/providers/matrix'
import { encryptSecret, maskKey } from '@/server/royal-red/verify/crypto'
import { invalidateKeyCache } from '@/server/royal-red/providers/creds'

export const dynamic = 'force-dynamic'

const MODALITIES = ['chat', 'vision', 'image', 'audio', 'search', 'embedding', 'video', 'rerank']
const AUTH_SCHEMES = ['bearer', 'header', 'query', 'none']

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom-provider'
}

function validBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.protocol === 'http:') {
      const h = u.hostname
      const local = h === 'localhost' || h === '127.0.0.1' || h === '::1'
      if (!local) return null
    }
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

// GET /api/royal-red/providers/custom — list custom providers (hints only)
export async function GET() {
  const all = await customProviders()
  return NextResponse.json({
    providers: all.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, modalities: p.modalities, model: p.model, endpointNote: p.endpointNote })),
  })
}

// POST /api/royal-red/providers/custom — add a custom provider. Appears in the
// matrix alongside the shipped 96 and routes through the openai-compat adapter.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        label?: string
        providerId?: string
        baseUrl?: string
        authScheme?: string
        headerName?: string
        modalities?: string[]
        model?: string
        apiKey?: string
        costIn?: number
        costOut?: number
      }
    | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const label = String(body.label ?? '').trim().slice(0, 60)
  const baseUrl = validBaseUrl(String(body.baseUrl ?? ''))
  const authScheme = AUTH_SCHEMES.includes(String(body.authScheme)) ? String(body.authScheme) : 'bearer'
  const model = String(body.model ?? '').trim().slice(0, 160)
  const modalities = (Array.isArray(body.modalities) ? body.modalities : ['chat'])
    .map((m) => String(m))
    .filter((m) => MODALITIES.includes(m))
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!label || !baseUrl || !model) {
    return NextResponse.json({ error: 'label, a valid baseUrl and a model are required' }, { status: 400 })
  }
  if (!modalities.length) return NextResponse.json({ error: 'at least one supported modality is required' }, { status: 400 })

  let providerId = slugify(String(body.providerId ?? label))
  const clash = await db.royalRedCustomProvider.findUnique({ where: { providerId } })
  if (clash) providerId = `${providerId}-${Date.now().toString(36).slice(-4)}`

  await db.royalRedCustomProvider.create({
    data: {
      providerId,
      label,
      baseUrl,
      authScheme,
      headerName: authScheme === 'header' ? String(body.headerName ?? 'x-api-key').slice(0, 60) : null,
      modalities: modalities.join(','),
      model,
      costIn: typeof body.costIn === 'number' && body.costIn >= 0 ? body.costIn : null,
      costOut: typeof body.costOut === 'number' && body.costOut >= 0 ? body.costOut : null,
      apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
      keyHint: apiKey ? maskKey(apiKey) : null,
    },
  })
  invalidateKeyCache()
  await db.royalRedAudit.create({
    data: { action: 'provider.custom.added', detail: `${label} (${providerId}) ${baseUrl} [${modalities.join('+')}]`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})

  return NextResponse.json({ ok: true, providerId, label, baseUrl, modalities, model })
}
