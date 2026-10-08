// ROYAL RED agent employees API (Round 6, Section 3.4).
// GET   /api/royal-red/agents -> the full 66-role roster with overrides applied,
//                                plus live status (running / done / disabled)
//                                and the last actions per role.
// PATCH /api/royal-red/agents -> reassign a role's provider or disable/enable it.
//                                Overrides persist as agent-scope memory rows
//                                (scope=agent, scopeRef=roster), audited by the
//                                Memory Keeper.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AGENT_ROSTER, rosterStats, ROSTER_CEILING } from '@/server/royal-red/roster'
import { auditMemory } from '@/server/royal-red/memory'

const OVERRIDE_SCOPE = 'agent'
const OVERRIDE_REF = 'roster'

interface RosterOverride {
  provider?: string
  disabled?: boolean
}

async function loadOverrides(): Promise<Record<string, RosterOverride>> {
  const rows = await db.royalRedMemory.findMany({
    where: { scope: OVERRIDE_SCOPE, scopeRef: OVERRIDE_REF, key: { startsWith: 'override:' } },
  })
  const out: Record<string, RosterOverride> = {}
  for (const r of rows) {
    const name = r.key.slice('override:'.length)
    try {
      const parsed = JSON.parse(r.value) as RosterOverride
      if (parsed && typeof parsed === 'object') out[name] = parsed
    } catch {
      // a corrupt override row must never take the roster down; skip it
    }
  }
  return out
}

export async function GET() {
  const overrides = await loadOverrides()

  const runs = await db.royalRedRun.findMany({
    where: { agentRole: { not: null } },
    orderBy: { startedAt: 'desc' },
    take: 300,
    select: { id: true, agentRole: true, status: true, startedAt: true, endedAt: true, tool: true },
  })
  const audits = await db.royalRedAudit.findMany({
    where: { agentRole: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 250,
    select: { agentRole: true, action: true, detail: true, ok: true, createdAt: true },
  })

  const roster = AGENT_ROSTER.map((r) => {
    const ov = overrides[r.name] ?? {}
    const roleRuns = runs.filter((x) => x.agentRole === r.name)
    const live = roleRuns.find((x) => x.status === 'running')
    const last = roleRuns[0]
    return {
      ...r,
      provider: ov.provider ?? r.provider,
      disabled: ov.disabled ?? false,
      status: ov.disabled ? ('disabled' as const) : live ? ('running' as const) : last ? ((last.status === 'aborted' ? 'aborted' : 'done') as 'aborted' | 'done') : ('idle' as const),
      currentTask: live?.tool ?? null,
      runCount: roleRuns.length,
      lastRunAt: last?.startedAt?.toISOString() ?? null,
      lastActions: audits
        .filter((a) => a.agentRole === r.name)
        .slice(0, 5)
        .map((a) => ({ action: a.action, detail: a.detail, ok: a.ok, at: a.createdAt.toISOString() })),
    }
  })

  const live = roster.filter((r) => r.status === 'running').length
  return Response.json({
    ceiling: ROSTER_CEILING,
    stats: rosterStats(),
    live,
    roster,
  })
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; provider?: string; disabled?: boolean }
    | null
  const name = body?.name?.trim()
  if (!name) return Response.json({ error: 'name required' }, { status: 400 })
  const role = AGENT_ROSTER.find((r) => r.name.toLowerCase() === name.toLowerCase())
  if (!role) return Response.json({ error: 'unknown role' }, { status: 404 })

  const overrides = await loadOverrides()
  const current = overrides[role.name] ?? {}
  const next: RosterOverride = {
    provider: typeof body?.provider === 'string' && body.provider ? body.provider : current.provider,
    disabled: typeof body?.disabled === 'boolean' ? body.disabled : current.disabled,
  }
  const key = `override:${role.name}`
  await db.royalRedMemory.upsert({
    where: { scope_scopeRef_key: { scope: OVERRIDE_SCOPE, scopeRef: OVERRIDE_REF, key } },
    create: { scope: OVERRIDE_SCOPE, scopeRef: OVERRIDE_REF, key, value: JSON.stringify(next), source: 'user', confidence: 1 },
    update: { value: JSON.stringify(next), source: 'user' },
  })
  await auditMemory('roster:override', `${role.name}: ${JSON.stringify(next)}`)
  return Response.json({ ok: true, role: role.name, ...next })
}
