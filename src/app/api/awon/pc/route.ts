import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'

const pexec = promisify(execFile)

// Human-consented, whitelisted diagnostics commands for the AWON System console.
// This is the explicit-permission surface: every call is audit logged.
const DIAGNOSTICS: { id: string; label: string; bin: string; args: string[] }[] = [
  { id: 'kernel', label: 'Kernel + host', bin: 'uname', args: ['-a'] },
  { id: 'uptime', label: 'Uptime + load', bin: 'uptime', args: [] },
  { id: 'cpu', label: 'CPU (top processes)', bin: 'ps', args: ['-eo', 'pcpu,comm', '--sort=-pcpu'] },
  { id: 'mem', label: 'Memory', bin: 'free', args: ['-h'] },
  { id: 'disk', label: 'Disk', bin: 'df', args: ['-h', '/'] },
  { id: 'whoami', label: 'Runtime identity', bin: 'whoami', args: [] },
]

export async function GET() {
  return NextResponse.json({ commands: DIAGNOSTICS.map(({ id, label }) => ({ id, label })) })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { command?: string } | null
  const cmd = DIAGNOSTICS.find((c) => c.id === body?.command)
  if (!cmd) {
    return NextResponse.json({ error: 'command not allowed' }, { status: 400 })
  }
  try {
    const { stdout } = await pexec(cmd.bin, cmd.args, { timeout: 8000, maxBuffer: 1024 * 128 })
    await db.awonAudit.create({
      data: { action: `diag.${cmd.id}`, detail: cmd.bin, ok: true },
    })
    return NextResponse.json({ output: stdout.trim().slice(0, 4000) })
  } catch (e) {
    await db.awonAudit.create({
      data: { action: `diag.${cmd.id}`, detail: (e as Error).message.slice(0, 200), ok: false },
    })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
