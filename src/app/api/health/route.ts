// ROYAL RED health endpoint (Phase A): the Docker healthcheck and the
// launcher readiness probe both hit this. Returns process + boot facts.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'royal-red',
    version: '1.8.1',
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    time: new Date().toISOString(),
  })
}
