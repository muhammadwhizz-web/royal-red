// POST /api/awon/desktop/consent/[id] - the user's answer to a consent card.
// The waiting kernel promise resolves here (or 120s expiry already failed it
// closed, in which case the answer is recorded as a late no).
import { NextRequest } from 'next/server'
import { decideConsent } from '@/server/awon/box/consent'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as
    | { decision?: string; ruleText?: string; modifiedPayload?: unknown }
    | null
  const decision = body?.decision
  if (!decision || !['approve', 'deny', 'modify', 'rule'].includes(decision)) {
    return Response.json({ error: 'decision must be approve | deny | modify | rule' }, { status: 400 })
  }
  const res = await decideConsent(id, {
    decision: decision as 'approve' | 'deny' | 'modify' | 'rule',
    ruleText: body?.ruleText,
    modifiedPayload: body?.modifiedPayload,
  })
  return Response.json(res, { status: res.ok ? 200 : 409 })
}
