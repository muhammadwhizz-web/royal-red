// ROYAL RED health endpoint (Phase A): the Docker healthcheck and the
// launcher readiness probe both hit this. Returns process + boot facts.
import { NextResponse } from 'next/server'
import { APP_VERSION } from '@/lib/version'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'royal-red',
    version: APP_VERSION,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    time: new Date().toISOString(),
  })
}
