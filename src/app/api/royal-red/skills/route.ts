import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SKILL_CATALOG } from '@/server/royal-red/skills/catalog'
import { installFromFolder, installFromUrl } from '@/server/royal-red/skills/store'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/skills — installed skills + the curated catalog
export async function GET() {
  const rows = await db.royalRedSkill.findMany({ orderBy: { installedAt: 'asc' } })
  const installed = new Set(rows.map((r) => r.skillId))
  return NextResponse.json({
    counts: { installed: rows.length, catalog: SKILL_CATALOG.length, enabled: rows.filter((r) => r.enabled).length },
    skills: rows.map((s) => ({
      id: s.id,
      skillId: s.skillId,
      name: s.name,
      description: s.description,
      author: s.author,
      version: s.version,
      source: s.source,
      sourceRef: s.sourceRef,
      enabled: s.enabled,
      tools: s.toolsJson ? JSON.parse(s.toolsJson) : [],
      prompts: s.promptsJson ? JSON.parse(s.promptsJson) : [],
      installedAt: s.installedAt,
    })),
    catalog: SKILL_CATALOG.map((c) => ({ ...c, installed: installed.has(c.skillId) })),
  })
}

// POST /api/royal-red/skills — install: { from: 'catalog'|'folder'|'url', skillId?, path?, url? }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { from?: string; skillId?: string; path?: string; url?: string }
    | null
  if (!body) return NextResponse.json({ error: 'empty body' }, { status: 400 })

  if (body.from === 'catalog') {
    const entry = SKILL_CATALOG.find((c) => c.skillId === body.skillId)
    if (!entry) return NextResponse.json({ error: 'unknown catalog skill' }, { status: 404 })
    const existing = await db.royalRedSkill.findUnique({ where: { skillId: entry.skillId } })
    await db.royalRedSkill.upsert({
      where: { skillId: entry.skillId },
      update: { enabled: true },
      create: {
        skillId: entry.skillId,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        version: entry.version,
        source: 'catalog',
        instructions: entry.instructions,
        toolsJson: JSON.stringify(entry.tools),
        promptsJson: JSON.stringify(entry.prompts),
      },
    })
    await db.royalRedAudit.create({
      data: { action: 'skill.installed', detail: `${entry.name} (${entry.skillId}) from catalog${existing ? ' (re-enabled)' : ''}`, ok: true, agentRole: 'Settings' },
    }).catch(() => {})
    return NextResponse.json({ ok: true, skillId: entry.skillId })
  }

  if (body.from === 'folder' && body.path) {
    const res = await installFromFolder(body.path)
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
    await db.royalRedAudit.create({ data: { action: 'skill.installed', detail: `${res.skillId} from folder ${body.path}`, ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true, skillId: res.skillId })
  }

  if (body.from === 'url' && body.url) {
    const res = await installFromUrl(body.url)
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
    await db.royalRedAudit.create({ data: { action: 'skill.installed', detail: `${res.skillId} from url ${body.url}`, ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true, skillId: res.skillId })
  }

  return NextResponse.json({ error: 'body must be { from: catalog|folder|url, ... }' }, { status: 400 })
}
