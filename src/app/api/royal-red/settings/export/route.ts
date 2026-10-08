import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllSettings, getRouterPrefs } from '@/server/royal-red/settings/store'

export const dynamic = 'force-dynamic'

// GET /api/royal-red/settings/export?encrypted=1 — export all sessions, memory,
// audit log and settings as one JSON file. Keys and connector credentials are
// NEVER included in plaintext: with encrypted=1 the secret COLUMNS are exported
// as their ciphertext blobs (still AES-256-GCM), without it they are omitted.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const encrypted = url.searchParams.get('encrypted') === '1'

  // audit-only export: CSV or JSON, for the Security section
  const part = url.searchParams.get('part')
  const format = url.searchParams.get('format')
  if (part === 'audit') {
    const rows = await db.royalRedAudit.findMany({ orderBy: { createdAt: 'asc' }, take: 100000 })
    await db.royalRedAudit.create({ data: { action: 'settings.audit-export', detail: `${rows.length} audit rows exported as ${format ?? 'json'}`, ok: true, agentRole: 'Settings' } }).catch(() => {})
    if (format === 'csv') {
      const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
      const csv = ['id,action,detail,ok,runId,subAgentId,agentRole,createdAt', ...rows.map((r) => [r.id, r.action, r.detail ?? '', String(r.ok), r.runId ?? '', r.subAgentId ?? '', r.agentRole ?? '', r.createdAt.toISOString()].map(esc).join(','))].join('\n')
      return new NextResponse(csv, {
        headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="royal-red-audit-${new Date().toISOString().slice(0, 10)}.csv"` },
      })
    }
    return new NextResponse(JSON.stringify({ format: 'royal-red-audit-export', rows }, null, 2), {
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="royal-red-audit-${new Date().toISOString().slice(0, 10)}.json"` },
    })
  }

  const [sessions, messages, artifacts, memories, audit, settings, prefs, keys, custom, connectors, mcpServers, skills] = await Promise.all([
    db.royalRedSession.findMany({ orderBy: { createdAt: 'asc' } }),
    db.royalRedMessage.findMany({ orderBy: { createdAt: 'asc' } }),
    db.royalRedArtifact.findMany(),
    db.royalRedMemory.findMany(),
    db.royalRedAudit.findMany({ orderBy: { createdAt: 'asc' }, take: 50000 }),
    getAllSettings(),
    getRouterPrefs(),
    db.royalRedProviderKey.findMany(),
    db.royalRedCustomProvider.findMany(),
    db.royalRedConnector.findMany(),
    db.royalRedMcpServer.findMany(),
    db.royalRedSkill.findMany(),
  ])

  const strip = <T extends { apiKeyEnc?: string | null; credEnc?: string | null; tokenEnc?: string | null }>(rows: T[], keep: boolean) =>
    rows.map((r) => {
      if (!keep) {
        const { apiKeyEnc, credEnc, tokenEnc, ...rest } = r
        void apiKeyEnc; void credEnc; void tokenEnc
        return rest as T
      }
      return r // ciphertext blobs only decrypt with this machine's master secret
    })

  const payload = {
    format: 'royal-red-export',
    version: 2,
    exportedAt: new Date().toISOString(),
    encryptedSecrets: encrypted,
    data: {
      sessions,
      messages,
      artifacts,
      memories,
      audit,
      settings,
      routerPrefs: prefs,
      providerKeys: strip(keys, encrypted),
      customProviders: strip(custom, encrypted),
      connectors: strip(connectors, encrypted),
      mcpServers: strip(mcpServers, encrypted),
      skills,
    },
  }

  await db.royalRedAudit.create({
    data: { action: 'settings.export', detail: `exported (encryptedSecrets=${encrypted})`, ok: true, agentRole: 'Settings' },
  }).catch(() => {})

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="royal-red-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
