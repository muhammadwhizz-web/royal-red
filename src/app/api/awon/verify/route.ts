import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runVerification } from '@/server/awon/verify/engine'
import { TAXONOMY, type TaxonomyId } from '@/server/awon/verify/benchmark'

export const maxDuration = 300

// GET /api/awon/verify?sessionId=... -> verification history (latest first)
// GET /api/awon/verify?sessionId=...&constraints=1 -> also include the session's
// constraint ledger (used by the console to restore the ledger card on reload)
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const rows = await db.awonVerification.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 24,
  })
  let constraints: { cid: string; category: string; text: string; assertion: string; weight: number }[] | undefined
  if (req.nextUrl.searchParams.get('constraints')) {
    const cs = await db.awonConstraint.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
    constraints = cs.map((c) => ({ cid: c.cid, category: c.category, text: c.text, assertion: c.assertion, weight: c.weight }))
  }
  return NextResponse.json({
    verifications: rows.map((r) => ({
      id: r.id,
      artifactId: r.artifactId,
      kind: r.kind,
      status: r.status,
      score: r.score,
      data: JSON.parse(r.data || '{}'),
      createdAt: r.createdAt,
    })),
    ...(constraints ? { constraints } : {}),
  })
}

// POST /api/awon/verify { sessionId, artifactId, benchmark?: taxonomyId }
// on-demand verification run (slash /verify, VERIFY tab rerun button)
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; artifactId?: string; benchmark?: string }
    | null
  if (!body?.sessionId || !body?.artifactId) {
    return NextResponse.json({ error: 'sessionId and artifactId required' }, { status: 400 })
  }
  const session = await db.awonSession.findUnique({ where: { id: body.sessionId }, select: { id: true } })
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })
  const artifact = await db.awonArtifact.findFirst({
    where: { id: body.artifactId, sessionId: body.sessionId },
    select: { id: true, score: true },
  })
  if (!artifact) return NextResponse.json({ error: 'artifact not found in this session' }, { status: 404 })

  let benchmark: TaxonomyId | null = null
  if (body.benchmark && TAXONOMY.some((t) => t.id === body.benchmark)) {
    benchmark = body.benchmark as TaxonomyId
  }

  // the on-demand command is audit-logged like every kernel action
  await db.awonAudit
    .create({ data: { action: 'verify.request', detail: `artifact=${artifact.id} benchmark=${benchmark ?? 'no'}`, ok: true } })
    .catch(() => {})

  const firstUser = await db.awonMessage.findFirst({
    where: { sessionId: body.sessionId, role: 'user' },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  })

  const result = await runVerification(body.sessionId, artifact.id, firstUser?.content ?? '', artifact.score, {
    withBenchmark: benchmark,
  })

  return NextResponse.json({
    runId: result.runId,
    ledger: result.ledger,
    critique: result.critique,
    visual: result.visual,
    cms: result.cms,
    benchmark: result.benchmark,
  })
}
