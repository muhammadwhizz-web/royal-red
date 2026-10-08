import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findProvider } from '@/server/royal-red/providers/matrix'
import { setDisabled } from '@/server/royal-red/providers/keys'
import { invalidateKeyCache } from '@/server/royal-red/providers/creds'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/providers/:id/state — { disabled: boolean }. A disabled
// provider keeps its key but is excluded from the router until re-enabled.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await findProvider(id)
  if (!p) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { disabled?: boolean } | null
  if (typeof body?.disabled !== 'boolean') {
    return NextResponse.json({ error: 'body must be { disabled: boolean }' }, { status: 400 })
  }
  const row = await setDisabled(id, body.disabled)
  invalidateKeyCache()
  await db.royalRedAudit.create({
    data: {
      action: body.disabled ? 'provider.disabled' : 'provider.enabled',
      detail: `${p.label} (${id}) ${body.disabled ? 'excluded from routing' : 'returned to routing'}`,
      ok: true,
      agentRole: 'Settings',
    },
  }).catch(() => {})
  return NextResponse.json({ ok: true, providerId: id, disabled: row?.disabled ?? body.disabled })
}
