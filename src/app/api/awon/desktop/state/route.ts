// GET /api/awon/desktop/state?sessionId=... - mission-control state for the
// DESKTOP panel: honest runtime identity, mount table, active runs, pending
// consent queue (FIFO), recent undo journal, trash stats, screen subsystem.
import { NextRequest } from 'next/server'
import { existsSync } from 'fs'
import { db } from '@/lib/db'
import { getBoxRuntime, liveChildren } from '@/server/awon/box/runtime'
import { BOX_ROOT, BOX_HOME, defaultMounts, ensureBoxTree } from '@/server/awon/box/prison'
import { trashStats } from '@/server/awon/box/ops'
import { screenSubsystemStatus } from '@/server/awon/box/screen'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  ensureBoxTree()
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined

  const [runs, pending, recentAudit] = await Promise.all([
    db.awonRun.findMany({ where: sessionId ? { sessionId } : undefined, orderBy: { startedAt: 'desc' }, take: 6 }),
    db.awonConsent.findMany({ where: sessionId ? { sessionId, status: 'pending' } : { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 12 }),
    db.awonAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 14 }),
  ])
  const journal = sessionId
    ? await db.awonUndoEntry.findMany({ where: { sessionId, undone: false }, orderBy: { createdAt: 'desc' }, take: 20 })
    : []
  const runsWithUndo = await Promise.all(
    runs.map(async (r) => ({ ...r, undoable: await db.awonUndoEntry.count({ where: { runId: r.id, undone: false } }) })),
  )

  const mounts = defaultMounts().map((m) => ({ virtual: m.virtual, mode: m.mode, label: m.label, exists: existsSync(m.real) }))
  const runtime = getBoxRuntime()
  const trash = await trashStats()

  return Response.json({
    runtime: { kind: runtime.kind, name: runtime.name, description: runtime.describe(), active: runtime.available() },
    boxRoot: BOX_ROOT,
    boxHome: BOX_HOME,
    mounts,
    runs: runsWithUndo.map((r) => ({
      id: r.id,
      status: r.status,
      tool: r.tool,
      total: r.actionsTotal,
      done: r.actionsDone,
      undoable: r.undoable,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      abortReason: r.abortReason,
    })),
    consentQueue: pending.map((c) => ({
      id: c.id,
      tier: c.tier,
      title: c.title,
      detail: c.detail,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
    })),
    journal: journal.map((j) => ({ id: j.id, runId: j.runId, seq: j.seq, op: j.op, from: j.fromPath, to: j.toPath, createdAt: j.createdAt })),
    trash,
    screen: screenSubsystemStatus(),
    processes: liveChildren().map((p) => ({ label: p.label, startedAt: p.startedAt, pid: p.child.pid })),
    audit: recentAudit.map((a) => ({ id: a.id, action: a.action, detail: a.detail, ok: a.ok, createdAt: a.createdAt })),
  })
}
