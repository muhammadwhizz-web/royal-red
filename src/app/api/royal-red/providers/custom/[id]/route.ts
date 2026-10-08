import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateKeyCache } from '@/server/royal-red/providers/creds'

export const dynamic = 'force-dynamic'

// DELETE /api/royal-red/providers/custom/:id — remove a custom provider and
// its stored key material.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedCustomProvider.findUnique({ where: { providerId: id } })
  if (!row) return NextResponse.json({ error: 'custom provider not found' }, { status: 404 })
  await db.royalRedCustomProvider.delete({ where: { providerId: id } })
  await db.royalRedProviderKey.deleteMany({ where: { providerId: id } })
  invalidateKeyCache()
  await db.royalRedAudit.create({
    data: { action: 'provider.custom.removed', detail: `${row.label} (${id}) removed from the matrix`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
