// ROYAL RED visual regression (Phase 2.3).
//
// Deterministic screenshot capture (fixed viewports, light media, reduced
// motion, animations frozen, fonts awaited) + PERCEPTUAL hash comparison
// (16x16 aHash + Hamming distance - never raw pixel diff, which false-positives
// on antialiasing) + an 8x8 tile region map that highlights WHERE change
// happened instead of raw counts. Screenshots live under the sandboxed
// workspace verify/ tree and are served by the verify-shot route.
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { WORKSPACE_ROOT } from '../workspace'
import { withScopedBrowser, settlePage } from './browser'

export const VIEWPORTS = [
  { id: 'desktop', w: 1440, h: 900 },
  { id: 'tablet', w: 768, h: 1024 },
  { id: 'mobile', w: 390, h: 844 },
] as const

export type ViewportId = (typeof VIEWPORTS)[number]['id']

export interface ShotResult {
  viewport: ViewportId
  ok: boolean
  file?: string // absolute path
  relFile?: string // verify/<runId>/<name> relative to workspace
  hash?: string // 64-bit aHash as 16-hex-char string
  error?: string
}

export interface RegionDiff {
  tile: number // 0-63 row-major on the 8x8 grid
  row: number
  col: number
  delta: number // mean brightness delta 0-255
}

export interface VisualDiff {
  viewport: ViewportId
  baselineRun: string | null
  hashA: string | null
  hashB: string | null
  hamming: number // 0-64 (0 identical, >18 typically means real layout change)
  similarity: number // 0-100
  changedRegions: RegionDiff[]
  changedPct: number
  verdict: 'identical' | 'minor' | 'changed' | 'new' | 'error'
}

// screenshots live under workspace verify/<runId>/ - run ids are globally
// unique (timestamp + uuid), the session linkage lives in the verification
// rows, and the flat tree keeps the verify-shot route simple
export function verifyDir(_sessionId: string, runId: string): string {
  const dir = path.join(WORKSPACE_ROOT, 'verify', runId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function verifyRelPath(runId: string, name: string): string {
  // names are generated here, never user input; still guarded for the route
  if (!/^[a-z0-9-]+\.(png|jpg)$/i.test(name) || name.includes('..')) throw new Error('bad verify asset name')
  return `verify/${runId}/${name}`
}

// 16x16 grayscale aHash -> 64-bit hex string
export async function perceptualHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const px = Array.from(data)
  const mean = px.reduce((s, v) => s + v, 0) / px.length
  let bits = 0n
  for (let i = 0; i < 64; i++) if (px[i] > mean) bits |= 1n << BigInt(63 - i)
  return bits.toString(16).padStart(16, '0')
}

export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let n = 0
  while (x) {
    if (x & 1n) n++
    x >>= 1n
  }
  return n
}

// 8x8 tile brightness grid for region-level change mapping
async function tileGrid(buf: Buffer): Promise<number[]> {
  const { data } = await sharp(buf).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return Array.from(data)
}

export function compareShots(
  viewport: ViewportId,
  baselineRun: string | null,
  hashA: string | null,
  hashB: string | null,
  tilesA: number[] | null,
  tilesB: number[] | null,
): VisualDiff {
  if (!hashA || !hashB || !tilesA || !tilesB) {
    return { viewport, baselineRun, hashA, hashB, hamming: 64, similarity: 0, changedRegions: [], changedPct: 100, verdict: 'new' }
  }
  const ham = hammingHex(hashA, hashB)
  const similarity = Math.round(((64 - ham) / 64) * 1000) / 10
  const changedRegions: RegionDiff[] = []
  for (let t = 0; t < 64; t++) {
    const delta = Math.abs(tilesA[t] - tilesB[t])
    if (delta >= 14) changedRegions.push({ tile: t, row: Math.floor(t / 8), col: t % 8, delta })
  }
  changedRegions.sort((x, y) => y.delta - x.delta)
  const changedPct = Math.round((changedRegions.length / 64) * 1000) / 10
  // region change dominates: a shifted block with a globally-similar hash is
  // still a real change; a globally shifted gradient with few strong tiles is minor
  const verdict: VisualDiff['verdict'] =
    ham <= 2 && changedPct < 8 ? 'identical' : changedPct >= 25 || ham >= 12 ? 'changed' : 'minor'
  return { viewport, baselineRun, hashA, hashB, hamming: ham, similarity, changedRegions: changedRegions.slice(0, 10), changedPct, verdict }
}

// capture the three deterministic viewports of a preview url
export async function captureShots(previewUrl: string, sessionId: string, runId: string): Promise<ShotResult[]> {
  const out: ShotResult[] = []
  for (const vp of VIEWPORTS) {
    const name = `${vp.id}.png`
    try {
      await withScopedBrowser(async (b) => {
        await b.setViewport(vp.w, vp.h)
        await b.setMedia('light', true)
        await b.open(previewUrl)
        await settlePage(b)
        const target = path.join(verifyDir(sessionId, runId), name)
        await b.screenshot(target)
      })
      const file = path.join(verifyDir(sessionId, runId), name)
      if (!fs.existsSync(file)) throw new Error('screenshot file did not land')
      const buf = fs.readFileSync(file)
      out.push({ viewport: vp.id, ok: true, file, relFile: verifyRelPath(runId, name), hash: await perceptualHash(buf) })
    } catch (e) {
      out.push({ viewport: vp.id, ok: false, error: (e as Error).message.slice(0, 200) })
    }
  }
  return out
}

export async function readTileGrid(file: string): Promise<number[]> {
  return tileGrid(fs.readFileSync(file))
}

// fetch the most recent prior visual run for this session (perceptual baseline)
export async function latestBaseline(sessionId: string, excludeRunId: string): Promise<{ runId: string; hashes: Record<string, string>; tiles: Record<string, number[]> } | null> {
  const { db } = await import('@/lib/db')
  const rows = await db.royalRedVerification.findMany({
    where: { sessionId, kind: 'visual', status: { not: 'error' } },
    orderBy: { createdAt: 'desc' },
    take: 6,
  })
  for (const r of rows) {
    try {
      const data = JSON.parse(r.data) as { runId?: string; shots?: ShotResult[]; tiles?: Record<string, number[]> }
      if (!data.runId || data.runId === excludeRunId) continue
      const hashes: Record<string, string> = {}
      for (const s of data.shots ?? []) if (s.viewport && s.hash) hashes[s.viewport] = s.hash
      if (!Object.keys(hashes).length) continue
      return { runId: data.runId, hashes, tiles: data.tiles ?? {} }
    } catch {}
  }
  return null
}

export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
}
