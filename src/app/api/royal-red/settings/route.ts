import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllSettings, setSettings, getRouterPrefs, saveRouterPrefs, type RouterPrefsShape } from '@/server/royal-red/settings/store'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/settings — all settings (defaults merged with stored)
// plus the About payload (versions, commit, counts).
export async function GET() {
  const [settings, routerPrefs, sessionCount, memoryCount, artifactCount, messageCount] = await Promise.all([
    getAllSettings(),
    getRouterPrefs(),
    db.royalRedSession.count(),
    db.royalRedMemory.count(),
    db.royalRedArtifact.count(),
    db.royalRedMessage.count(),
  ])
  // commit hash of the running build (honest: dev builds resolve to the same HEAD)
  let commit = 'unknown'
  try {
    const { readFileSync } = await import('node:fs')
    const head = readFileSync('.git/HEAD', 'utf8').trim()
    const ref = head.startsWith('ref: ') ? head.slice(5) : null
    commit = ref ? readFileSync(`.git/${ref}`, 'utf8').trim() : head.slice(0, 12)
  } catch { /* .git not present in some deployment shapes */ }
  return NextResponse.json({
    settings: { ...settings, sessionPasswordHash: settings.sessionPasswordHash ? 'set' : '' },
    routerPrefs,
    about: {
      version: 'v1.9.0',
      bootVersion: 'v1.9.0',
      kernelVersion: 'v1.8',
      commit,
      counts: {
        sessions: sessionCount,
        memories: memoryCount,
        artifacts: artifactCount,
        messages: messageCount,
      },
    },
  })
}

// PATCH /api/royal-red/settings — partial updates. Body may carry:
//   { settings: { theme: 'dark', ... }, routerPrefs: { costCeilingUsd: 0.25, ... } }
// Every change writes an audit row; router preference changes write
// router.preferences.updated.
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { settings?: Record<string, string>; routerPrefs?: Partial<RouterPrefsShape> }
    | null
  if (!body || (!body.settings && !body.routerPrefs)) {
    return NextResponse.json({ error: 'body must contain settings and/or routerPrefs' }, { status: 400 })
  }
  const changed: string[] = []
  if (body.settings) {
    const allowed = new Set([
      'theme', 'language', 'defaultMode', 'bootAnimation', 'sound', 'telemetry', 'autoUpdate',
      'fontSize', 'density', 'motion', 'port', 'logLevel', 'maxConcurrentAgents',
      'wallClockBudgetMin', 'tokenBudget', 'autoLockMin', 'auditRetentionDays',
    ])
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.settings)) {
      if (!allowed.has(k)) continue
      clean[k] = String(v).slice(0, 200)
      changed.push(k)
    }
    await setSettings(clean)
    if (changed.length) {
      await db.royalRedAudit.create({
        data: { action: 'settings.updated', detail: `keys: ${changed.join(', ')}`, ok: true, agentRole: 'Settings' },
      }).catch(() => {})
    }
  }
  if (body.routerPrefs) {
    const prefs = await saveRouterPrefs(body.routerPrefs)
    await db.royalRedAudit.create({
      data: { action: 'router.preferences.updated', detail: JSON.stringify(prefs), ok: true, agentRole: 'Settings' },
    }).catch(() => {})
  }
  const [settings, routerPrefs] = await Promise.all([getAllSettings(), getRouterPrefs()])
  return NextResponse.json({ ok: true, changed, settings, routerPrefs })
}
