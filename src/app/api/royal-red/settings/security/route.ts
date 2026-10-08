import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setSetting, getAllSettings } from '@/server/royal-red/settings/store'
import { rotateAllSecrets } from '@/server/royal-red/verify/crypto'
import { invalidateKeyCache } from '@/server/royal-red/providers/keys'
import crypto from 'node:crypto'

export const dynamic = 'force-dynamic'

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
}

// POST /api/royal-red/settings/security
// Body: { action, ... }
//   set-password   { password }        store a scrypt hash (never the password)
//   clear-password {}                  remove the session password
//   unlock         { password }        validate the password for this tab session
//   rotate-master  { newSecret }       re-encrypt every stored key under a new
//                                      master secret (keys, connectors, mcp tokens)
//   clear-all      { confirmText }     destructive wipe, requires confirmText 'ERASE'
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { action?: string; password?: string; newSecret?: string; confirmText?: string }
    | null
  if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

  if (body.action === 'set-password') {
    const pw = String(body.password ?? '')
    if (pw.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
    await setSetting('sessionPasswordHash', hashPassword(pw))
    await db.royalRedAudit.create({ data: { action: 'security.password.set', detail: 'session password enabled (scrypt hash stored)', ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'clear-password') {
    await setSetting('sessionPasswordHash', '')
    await db.royalRedAudit.create({ data: { action: 'security.password.cleared', detail: 'session password removed', ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'unlock') {
    const settings = await getAllSettings()
    const stored = settings.sessionPasswordHash
    if (!stored) return NextResponse.json({ ok: true, unlocked: true }) // no password set: always open
    const ok = verifyPassword(String(body.password ?? ''), stored)
    await db.royalRedAudit.create({ data: { action: 'security.unlock', detail: ok ? 'unlock succeeded' : 'unlock failed', ok, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok, unlocked: ok }, { status: ok ? 200 : 401 })
  }

  if (body.action === 'rotate-master') {
    const secret = String(body.newSecret ?? '')
    if (secret.length < 16) return NextResponse.json({ error: 'the new master secret must be at least 16 characters' }, { status: 400 })
    try {
      // collect every stored ciphertext, decrypt with the old secret, swap,
      // re-encrypt with the new one, persist. One pass, all secret columns.
      const [keys, connectors, mcp, legacy] = await Promise.all([
        db.royalRedProviderKey.findMany(),
        db.royalRedConnector.findMany(),
        db.royalRedMcpServer.findMany(),
        db.royalRedProviderConfig.findMany(),
      ])
      const blobs = new Map<string, string | null>()
      for (const k of keys) if (k.apiKeyEnc) blobs.set(`key:${k.id}`, k.apiKeyEnc)
      for (const c of connectors) if (c.credEnc) blobs.set(`conn:${c.id}`, c.credEnc)
      for (const m of mcp) if (m.tokenEnc) blobs.set(`mcp:${m.id}`, m.tokenEnc)
      for (const l of legacy) if (l.apiKeyEnc) blobs.set(`legacy:${l.id}`, l.apiKeyEnc)

      const reEncrypted = await rotateAllSecrets(
        blobs,
        async (updates) => {
          for (const u of updates) {
            const [kind, id] = u.id.split(':')
            if (kind === 'key') await db.royalRedProviderKey.update({ where: { id }, data: { apiKeyEnc: u.enc } })
            else if (kind === 'conn') await db.royalRedConnector.update({ where: { id }, data: { credEnc: u.enc } })
            else if (kind === 'mcp') await db.royalRedMcpServer.update({ where: { id }, data: { tokenEnc: u.enc } })
            else if (kind === 'legacy') await db.royalRedProviderConfig.update({ where: { id }, data: { apiKeyEnc: u.enc } })
          }
        },
        secret,
      )
      invalidateKeyCache()
      await db.royalRedAudit.create({ data: { action: 'security.master-rotated', detail: `master secret rotated: ${reEncrypted} secrets re-encrypted`, ok: true, agentRole: 'Settings' } }).catch(() => {})
      return NextResponse.json({ ok: true, reEncrypted })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ ok: false, error: `rotation failed: ${msg.slice(0, 200)}` }, { status: 500 })
    }
  }

  if (body.action === 'clear-all') {
    if (body.confirmText !== 'ERASE') {
      return NextResponse.json({ error: 'type ERASE in the confirmation box to wipe all data' }, { status: 400 })
    }
    await db.royalRedMessage.deleteMany({})
    await db.royalRedArtifactVersion.deleteMany({})
    await db.royalRedArtifact.deleteMany({})
    await db.royalRedSession.deleteMany({})
    await db.royalRedMemory.deleteMany({})
    await db.royalRedCostEntry.deleteMany({})
    await db.royalRedEventLog.deleteMany({})
    await db.royalRedAudit.deleteMany({})
    await db.royalRedConstraint.deleteMany({})
    await db.royalRedVerification.deleteMany({})
    await db.royalRedProviderKey.deleteMany({})
    await db.royalRedCustomProvider.deleteMany({})
    await db.royalRedConnector.deleteMany({})
    await db.royalRedMcpServer.deleteMany({})
    await db.royalRedSkill.deleteMany({})
    await db.royalRedAudit.create({ data: { action: 'security.clear-all', detail: 'all Royal Red data wiped from the console (destructive, user-confirmed)', ok: true, agentRole: 'Settings' } }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `unknown action ${body.action}` }, { status: 400 })
}
