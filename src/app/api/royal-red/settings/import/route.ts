import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setSettings } from '@/server/royal-red/settings/store'

export const dynamic = 'force-dynamic'

interface ExportPayload {
  format?: string
  version?: number
  data?: {
    sessions?: unknown[]
    memories?: unknown[]
    settings?: Record<string, string>
    routerPrefs?: Record<string, unknown> | { priority?: string[] }
    customProviders?: Array<Record<string, unknown>>
    mcpServers?: Array<Record<string, unknown>>
    skills?: Array<Record<string, unknown>>
  }
}

// POST /api/royal-red/settings/import — import a previous export. Sessions and
// memories are upserted by id (existing rows win), settings are applied, and
// imported secret COLUMNS (ciphertext) are stored as-is: they only decrypt on a
// machine whose master secret produced them.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ExportPayload | null
  if (!body || body.format !== 'royal-red-export' || !body.data) {
    return NextResponse.json({ error: 'not a Royal Red export file (format: royal-red-export expected)' }, { status: 400 })
  }
  const d = body.data
  const counts = { sessions: 0, memories: 0, settings: 0, customProviders: 0, mcpServers: 0, skills: 0 }

  if (Array.isArray(d.sessions)) {
    for (const raw of d.sessions.slice(0, 5000)) {
      const s = raw as { id?: string; title?: string; mode?: string; pinned?: boolean }
      if (!s.id) continue
      await db.royalRedSession.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, title: s.title ?? 'Imported session', mode: s.mode ?? 'build', pinned: !!s.pinned } }).catch(() => {})
      counts.sessions++
    }
  }
  if (Array.isArray(d.memories)) {
    for (const raw of d.memories.slice(0, 20000)) {
      const m = raw as { id?: string; scope?: string; scopeRef?: string; key?: string; value?: string; source?: string; confidence?: number; tags?: string }
      if (!m.id || !m.key || !m.value) continue
      await db.royalRedMemory.upsert({
        where: { id: m.id },
        update: {},
        create: { id: m.id, scope: m.scope ?? 'global', scopeRef: m.scopeRef ?? '', key: m.key.slice(0, 200), value: m.value, source: m.source ?? 'user', confidence: typeof m.confidence === 'number' ? m.confidence : 1, tags: m.tags ?? null },
      }).catch(() => {})
      counts.memories++
    }
  }
  if (d.settings && typeof d.settings === 'object') {
    await setSettings(Object.fromEntries(Object.entries(d.settings).map(([k, v]) => [k, String(v).slice(0, 200)])))
    counts.settings = Object.keys(d.settings).length
  }
  if (Array.isArray(d.customProviders)) {
    for (const raw of d.customProviders.slice(0, 200)) {
      const c = raw as { providerId?: string; label?: string; baseUrl?: string; authScheme?: string; modalities?: string; model?: string; apiKeyEnc?: string; keyHint?: string }
      if (!c.providerId || !c.label || !c.baseUrl || !c.model) continue
      await db.royalRedCustomProvider.upsert({
        where: { providerId: c.providerId },
        update: {},
        create: { providerId: c.providerId, label: c.label, baseUrl: c.baseUrl, authScheme: c.authScheme ?? 'bearer', modalities: c.modalities ?? 'chat', model: c.model, apiKeyEnc: c.apiKeyEnc ?? null, keyHint: c.keyHint ?? null },
      }).catch(() => {})
      counts.customProviders++
    }
  }
  if (Array.isArray(d.mcpServers)) {
    for (const raw of d.mcpServers.slice(0, 200)) {
      const s = raw as { name?: string; label?: string; type?: string; command?: string; argsJson?: string; envJson?: string; url?: string; tokenEnc?: string; toolsJson?: string; resourcesJson?: string; promptsJson?: string }
      if (!s.name || !s.label) continue
      await db.royalRedMcpServer.upsert({
        where: { name: s.name },
        update: {},
        create: { name: s.name, label: s.label, type: s.type ?? 'stdio', command: s.command ?? null, argsJson: s.argsJson ?? null, envJson: s.envJson ?? null, url: s.url ?? null, tokenEnc: s.tokenEnc ?? null, toolsJson: s.toolsJson ?? null, resourcesJson: s.resourcesJson ?? null, promptsJson: s.promptsJson ?? null },
      }).catch(() => {})
      counts.mcpServers++
    }
  }
  if (Array.isArray(d.skills)) {
    for (const raw of d.skills.slice(0, 200)) {
      const s = raw as { skillId?: string; name?: string; description?: string; instructions?: string; author?: string; version?: string; source?: string; sourceRef?: string; toolsJson?: string; promptsJson?: string }
      if (!s.skillId || !s.name || !s.instructions) continue
      await db.royalRedSkill.upsert({
        where: { skillId: s.skillId },
        update: {},
        create: { skillId: s.skillId, name: s.name, description: s.description ?? '', instructions: s.instructions, author: s.author ?? 'imported', version: s.version ?? '1.0.0', source: s.source ?? 'url', sourceRef: s.sourceRef ?? null, toolsJson: s.toolsJson ?? null, promptsJson: s.promptsJson ?? null },
      }).catch(() => {})
      counts.skills++
    }
  }

  await db.royalRedAudit.create({
    data: { action: 'settings.import', detail: `imported: ${JSON.stringify(counts)}`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})

  return NextResponse.json({ ok: true, counts })
}
