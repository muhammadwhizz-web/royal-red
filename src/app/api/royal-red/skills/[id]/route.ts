import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PATCH /api/royal-red/skills/:id — { enabled: boolean } (enable/disable keeps
// the package installed)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedSkill.findUnique({ where: { skillId: id } })
  if (!row) return NextResponse.json({ error: 'skill not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'body must be { enabled: boolean }' }, { status: 400 })
  await db.royalRedSkill.update({ where: { skillId: id }, data: { enabled: body.enabled } })
  await db.royalRedAudit.create({
    data: { action: body.enabled ? 'skill.enabled' : 'skill.disabled', detail: `${row.name} (${id})`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})
  return NextResponse.json({ ok: true, skillId: id, enabled: body.enabled })
}

// GET /api/royal-red/skills/:id — full contents (instructions, tools, prompts)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedSkill.findUnique({ where: { skillId: id } })
  if (!row) return NextResponse.json({ error: 'skill not found' }, { status: 404 })
  return NextResponse.json({
    skillId: row.skillId,
    name: row.name,
    description: row.description,
    author: row.author,
    version: row.version,
    source: row.source,
    sourceRef: row.sourceRef,
    enabled: row.enabled,
    instructions: row.instructions,
    tools: row.toolsJson ? JSON.parse(row.toolsJson) : [],
    prompts: row.promptsJson ? JSON.parse(row.promptsJson) : [],
  })
}

// DELETE /api/royal-red/skills/:id — remove the skill
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await db.royalRedSkill.findUnique({ where: { skillId: id } })
  if (!row) return NextResponse.json({ error: 'skill not found' }, { status: 404 })
  await db.royalRedSkill.delete({ where: { skillId: id } })
  await db.royalRedAudit.create({ data: { action: 'skill.removed', detail: `${row.name} (${id}) uninstalled`, ok: true, agentRole: 'Settings' } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
