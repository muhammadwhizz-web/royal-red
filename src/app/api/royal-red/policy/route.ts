// ROYAL RED policy API — the inspection surface for the tool policy waterfall
// (harness port #2). Every layer is visible here; nothing about authorization
// is hidden inside the executor.
import { NextRequest, NextResponse } from 'next/server'
import { policyStack } from '@/server/royal-red/policy/waterfall'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined
  const mode = req.nextUrl.searchParams.get('mode') ?? undefined
  try {
    return NextResponse.json(await policyStack({ sessionId, mode }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
