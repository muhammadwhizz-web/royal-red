import { NextRequest, NextResponse } from 'next/server'
import { decide, execute } from '@/server/royal-red/router/router'
import type { CapabilityRequest } from '@/server/royal-red/providers/types'

export const dynamic = 'force-dynamic'

// POST /api/royal-red/router/decide
//   body: CapabilityRequest (+ "dryRun": true, default true)
// dry-run previews the routing decision (what would this cost? who wins? who
// is blocked and why?) without executing anything. dryRun:false executes with
// fallback + rotation and records the cost ledger.
export async function POST(req: NextRequest) {
  let body: (Partial<CapabilityRequest> & { dryRun?: boolean }) | null = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body.operation !== 'string' || !body.modality) {
    return NextResponse.json({ error: 'operation (string) and modality are required' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false

  // fail closed: only known modalities
  const ALLOWED = ['chat', 'vision', 'image', 'audio', 'search', 'embedding', 'video'] as const
  if (!ALLOWED.includes(body.modality as never)) {
    return NextResponse.json({ error: `unknown modality ${body.modality}` }, { status: 400 })
  }

  const request: CapabilityRequest = {
    modality: body.modality,
    operation: body.operation,
    messages: body.messages,
    tools: body.tools,
    prompt: body.prompt,
    imageUrl: body.imageUrl,
    query: body.query,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
    minTier: body.minTier,
    policy: body.policy,
  }

  try {
    if (dryRun) {
      const decision = await decide(request, true)
      return NextResponse.json({ dryRun: true, decision })
    }
    const result = await execute(request)
    return NextResponse.json(
      {
        dryRun: false,
        ok: result.ok,
        text: result.text,
        switches: result.switches,
        totalCostUsd: result.totalCostUsd,
        attempts: result.attempts.map((a) => ({ providerId: a.providerId, model: a.model, ok: a.ok, latencyMs: a.latencyMs, error: a.error, usage: a.usage })),
        decision: result.decision,
        error: result.error,
      },
      { status: result.ok ? 200 : 502 },
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'router failure' }, { status: 500 })
  }
}
