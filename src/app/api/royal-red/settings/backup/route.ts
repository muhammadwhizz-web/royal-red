import { NextResponse } from 'next/server'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'

const run = promisify(exec)

export const dynamic = 'force-dynamic'

// data directory discovery mirrors db.ts (db folder holds the SQLite file)
function dataDir(): string {
  const candidates = [
    process.env.ROYALRED_DATA_DIR,
    process.env.DATA_DIR,
    path.join(process.cwd(), 'db'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c)) return c
  return path.join(process.cwd(), 'db')
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      const st = statSync(p)
      total += st.isFile() ? st.size : dirSize(p)
    }
  } catch { /* unreadable entries are skipped honestly */ }
  return total
}

// GET /api/royal-red/settings/backup — data directory stats for the cockpit
export async function GET() {
  const dir = dataDir()
  return NextResponse.json({ dataDir: dir, dbBytes: dirSize(dir) })
}

// POST /api/royal-red/settings/backup — create a timestamped tarball of the
// data directory in ~/.royal-red/backups (or ./db/backups) and return its path.
export async function POST() {
  const dir = dataDir()
  const home = process.env.HOME || process.cwd()
  const backupRoot = existsSync(path.join(home, '.royal-red')) ? path.join(home, '.royal-red', 'backups') : path.join(dir, 'backups')
  try {
    mkdirSync(backupRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = path.join(backupRoot, `royal-red-backup-${stamp}.tar.gz`)
    await run(`tar -czf "${out}" -C "${path.dirname(dir)}" "${path.basename(dir)}"`, { timeout: 120_000 })
    await db.royalRedAudit.create({
      data: { action: 'settings.backup', detail: `backup created: ${out}`, ok: true, agentRole: 'Settings' },
    }).catch(() => {})
    return NextResponse.json({ ok: true, path: out, bytes: statSync(out).size })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `backup failed: ${msg.slice(0, 200)}` }, { status: 500 })
  }
}
