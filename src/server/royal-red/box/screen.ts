// ROYAL RED Box — screen grounding (Phase 4.3). X11/Xvfb first, honestly scoped.
//
// WHAT IS REAL HERE:
//  - Xvfb virtual displays: fully real. Spawned supervised (process table,
//    kill-switch reaps them), 1280x800x24, -nolisten tcp, never touching any
//    physical output.
//  - Screenshots: real pixels from the virtual display via ffmpeg x11grab,
//    saved under the box tmp tree and servable to the console.
//  - Segmentation: a dependency-free region proposer over the decoded frame
//    (grid + variance heuristics) with per-region confidence. It is a
//    HEURISTIC, labeled as such in every output - not a learned model.
//
// WHAT IS NOT AVAILABLE (and is never faked):
//  - xdotool/xinput are not installed in this environment, so screen_click and
//    screen_type have no input backend. Those primitives exist and are
//    consent-gated, but they FAIL CLOSED with an honest "no input backend"
//    error instead of pretending to click. Installing xdotool (needs root,
//    unavailable here) enables them with zero code change.
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { BOX_TMP, ensureBoxTree } from './prison'
import { spawnSupervised } from './box'
import { liveChildren } from './runtime'

const SCREEN_W = 1280
const SCREEN_H = 800

interface DisplaySession {
  display: number
  startedAt: number
  lock: string
}

const activeDisplays = new Map<number, DisplaySession>()
let nextDisplay = 90

// start a virtual display (Xvfb). Registered with the process table.
export async function ensureDisplay(): Promise<{ display: number; root: string }> {
  ensureBoxTree()
  // reuse a healthy existing display
  for (const n of activeDisplays.keys()) {
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) return { display: n, root: `:${n}` }
    activeDisplays.delete(n)
  }
  const display = nextDisplay++
  const child = spawnSupervised('Xvfb', [`:${display}`, '-screen', '0', `${SCREEN_W}x${SCREEN_H}x24`, '-nolisten', 'tcp'], `Xvfb :${display}`)
  // wait for the socket (up to 5s)
  const socket = `/tmp/.X11-unix/X${display}`
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(socket)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!fs.existsSync(socket)) {
    throw new Error(`Xvfb :${display} failed to start (no socket after 5s)`)
  }
  activeDisplays.set(display, { display, startedAt: Date.now(), lock: child.pid ? String(child.pid) : '' })
  return { display, root: `:${display}` }
}

export function displayCount(): number {
  return activeDisplays.size
}

// capture the virtual display to a PNG under the box tmp tree. Returns the
// absolute path + box-virtual path so the console can serve it.
export async function captureScreen(root: string): Promise<{ abs: string; bytes: number }> {
  ensureBoxTree()
  const out = path.join(BOX_TMP, `screen-${Date.now()}.png`)
  // ffmpeg x11grab: one frame off the virtual X server (real pixels, no
  // physical display involved)
  await new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'x11grab', '-video_size', `${SCREEN_W}x${SCREEN_H}`, '-i', root, '-frames:v', '1', out],
      { timeout: 15_000 },
      (err) => (err ? reject(new Error(`x11grab failed: ${err.message}`)) : resolve()),
    )
  })
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0
  if (!bytes) throw new Error('screenshot was empty')
  return { abs: out, bytes }
}

// ─── segmentation (heuristic, honest confidence) ────────────────────────────
// Decode the PNG to raw RGB via ffmpeg, then propose regions on a coarse grid:
// each cell scores variance (busy cells likely contain UI) and neighboring busy
// cells merge into row-shaped regions (toolbars/buttons/lists are row-ish).
// Confidence = normalized variance z-score, clamped to [0,1]. This finds
// REGIONS, not semantic labels - the output says exactly that.

interface Region {
  x: number
  y: number
  w: number
  h: number
  confidence: number
  kind: 'text-like' | 'edge-heavy' | 'flat'
}

export async function segmentScreenshot(abs: string): Promise<{ regions: Region[]; note: string }> {
  const raw = path.join(BOX_TMP, `raw-${Date.now()}.rgb`)
  await new Promise<void>((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', abs, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw], { timeout: 15_000 }, (err) =>
      err ? reject(new Error(`decode failed: ${err.message}`)) : resolve(),
    )
  })
  const buf = fs.readFileSync(raw)
  fs.rmSync(raw, { force: true })
  if (buf.length < SCREEN_W * SCREEN_H * 3) throw new Error('frame smaller than the display')

  const CELL = 40 // grid: 32x20 cells over 1280x800
  const cols = SCREEN_W / CELL
  const rows = SCREEN_H / CELL
  const score = (cx: number, cy: number): number => {
    let min = 255
    let max = 0
    let sum = 0
    let sum2 = 0
    let n = 0
    for (let y = cy * CELL; y < (cy + 1) * CELL; y += 4) {
      for (let x = cx * CELL; x < (cx + 1) * CELL; x += 4) {
        // luma approx from rgb24
        const i = (y * SCREEN_W + x) * 3
        const l = (buf[i] * 299 + buf[i + 1] * 587 + buf[i + 2] * 114) / 1000
        if (l < min) min = l
        if (l > max) max = l
        sum += l
        sum2 += l * l
        n++
      }
    }
    const mean = sum / n
    const variance = Math.max(0, sum2 / n - mean * mean)
    return variance + (max - min) * 2
  }

  const scores: number[] = []
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) scores.push(score(cx, cy))
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length) || 1

  // merge horizontally-adjacent busy cells into row regions
  const busy = scores.map((s) => (s - mean) / std > 0.7)
  const regions: Region[] = []
  for (let cy = 0; cy < rows; cy++) {
    let runStart = -1
    for (let cx = 0; cx <= cols; cx++) {
      const isBusy = cx < cols && busy[cy * cols + cx]
      if (isBusy && runStart === -1) runStart = cx
      if (!isBusy && runStart !== -1) {
        const w = (cx - runStart) * CELL
        if (w >= CELL * 2) {
          const confs: number[] = []
          for (let k = runStart; k < cx; k++) confs.push((scores[cy * cols + k] - mean) / std)
          const confidence = Math.max(0, Math.min(1, Math.max(...confs) / 3))
          const kind = confidence > 0.75 ? 'edge-heavy' : confidence > 0.4 ? 'text-like' : 'flat'
          regions.push({ x: runStart * CELL, y: cy * CELL, w, h: CELL, confidence: Math.round(confidence * 100) / 100, kind })
        }
        runStart = -1
      }
    }
  }
  // keep the strongest 40 - this is a proposer, not a final answer
  regions.sort((a, b) => b.confidence - a.confidence)
  return {
    regions: regions.slice(0, 40),
    note: 'heuristic grid segmentation (variance-based, NOT a learned model); regions only, no semantic labels; coordinates are virtual-display pixels',
  }
}

// honest input backend probe
export function inputBackendAvailable(): boolean {
  return fs.existsSync('/usr/bin/xdotool')
}

export async function inputUnavailableError(): Promise<never> {
  throw new Error(
    'input backend unavailable: xdotool is not installed in this environment (no root). The click/type primitives FAIL CLOSED instead of faking input. All Phase 4 tests are read-only on a virtual display; no host input is touched.',
  )
}

export function screenSubsystemStatus(): { displays: number; children: number; input: boolean } {
  return { displays: activeDisplays.size, children: liveChildren().length, input: inputBackendAvailable() }
}
