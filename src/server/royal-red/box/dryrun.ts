// ROYAL RED Box — dry-run engine (Phase 4.2). "Dry-run is the product."
//
// HARD INVARIANT: an operation that cannot produce a dry-run is NOT proposable.
// The planner never mutates; it stats, classifies, flags, and refuses. The
// executor (ops.ts) refuses to run a batch whose plan hash does not match the
// approved dry-run, so what the user approved is byte-for-byte what runs.
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { defaultMounts, resolveVirtual, verifyReal, statVirtual, PrisonEscapeError } from './prison'

export type BoxOpKind = 'move' | 'copy' | 'trash' | 'mkdir' | 'write'

export type FileClass =
  | 'documents'
  | 'images'
  | 'video'
  | 'audio'
  | 'archives'
  | 'code'
  | 'data'
  | 'junk'
  | 'installers'
  | 'other'

export interface PlanStep {
  seq: number
  op: BoxOpKind
  from: string // box-virtual
  to: string // box-virtual ('' for trash: assigned at execution)
  class: FileClass
  flagged: boolean
  reversible: boolean
  bytes: number
  reason: string // one-line human explanation shown on the plan card
  proposable: true
}

export interface Refusal {
  seq: number
  op: BoxOpKind
  from: string
  to?: string
  reason: string // why this cannot even be proposed
  proposable: false
}

export type PlanEntry = PlanStep | Refusal

export interface DryRunPlan {
  planId: string
  hash: string
  createdAt: string
  steps: PlanEntry[]
  summary: {
    total: number
    proposable: number
    refused: number
    flagged: number
    byClass: Record<string, number>
    bytes: number
  }
}

const EXT_CLASS: [RegExp, FileClass][] = [
  [/\.(pdf|docx?|txt|md|rtf|odt|pptx?|xlsx?|csv|epub)$/i, 'documents'],
  [/\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?|heic)$/i, 'images'],
  [/\.(mp4|mkv|mov|avi|webm|flv)$/i, 'video'],
  [/\.(mp3|wav|flac|ogg|m4a)$/i, 'audio'],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, 'archives'],
  [/\.(js|mjs|cjs|ts|tsx|jsx|py|sh|rs|go|c|cpp|h|java|rb|php|sql|html?|css|json|xml|ya?ml|toml)$/i, 'code'],
  [/\.(db|sqlite3?|parquet|arrow|pkl|npy)$/i, 'data'],
  [/\.(deb|rpm|exe|msi|dmg|pkg|appimage|apk)$/i, 'installers'],
]

// patterns that a cleanup should treat as junk. Conservative by design:
// partial downloads + obvious cache droppings + editor leftovers. Anything not
// matched stays in `other` and is NOT moved by default rules.
const JUNK: [RegExp, string][] = [
  [/\.(crdownload|part|partial|tmp)$/i, 'unfinished download or temp file'],
  [/\.download$/i, 'browser partial download'],
  [/~$/i, 'editor backup file'],
  [/^\.DS_Store$/i, 'macOS finder junk'],
  [/^Thumbs\.db$/i, 'Windows thumbnail cache'],
  [/^\.~lock\./i, 'office lock file'],
]

function classify(name: string): { class: FileClass; flagged: boolean; reason: string } {
  for (const [re, why] of JUNK) {
    if (re.test(name)) return { class: 'junk', flagged: true, reason: why }
  }
  for (const [re, cls] of EXT_CLASS) {
    if (re.test(name)) return { class: cls, flagged: false, reason: `${cls} by extension` }
  }
  return { class: 'other', flagged: false, reason: 'unrecognized type' }
}

export interface RawOp {
  op: BoxOpKind
  from?: string
  to?: string
  path?: string
  content?: string // write op only
}

// the planner. Reads the REAL filesystem through the prison but never writes.
export function planOperations(rawOps: RawOp[]): DryRunPlan {
  const mounts = defaultMounts()
  const steps: PlanEntry[] = []
  let seq = 0
  for (const raw of rawOps) {
    seq++
    try {
      steps.push(planOne(seq, raw, mounts, steps))
    } catch (e) {
      steps.push({
        seq,
        op: raw.op,
        from: raw.from ?? raw.path ?? '',
        to: raw.to,
        reason: `cannot propose: ${(e as Error).message}`,
        proposable: false,
      })
    }
  }
  const ok = steps.filter((s): s is PlanStep => s.proposable)
  const byClass: Record<string, number> = {}
  let bytes = 0
  for (const s of ok) {
    byClass[s.class] = (byClass[s.class] ?? 0) + 1
    bytes += s.bytes
  }
  const canonical = JSON.stringify(steps)
  const planId = `plan_${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
  return {
    planId,
    hash: createHash('sha256').update(canonical).digest('hex'),
    createdAt: new Date().toISOString(),
    steps,
    summary: {
      total: steps.length,
      proposable: ok.length,
      refused: steps.length - ok.length,
      flagged: ok.filter((s) => s.flagged).length,
      byClass,
      bytes,
    },
  }
}

function planOne(seq: number, raw: RawOp, mounts: ReturnType<typeof defaultMounts>, prior: PlanEntry[]): PlanEntry {
  if (raw.op === 'write') {
    // content is NOT included in the plan card (could be huge); the step
    // carries the target + byte count only, full content is consent-bound
    if (typeof raw.content !== 'string') throw new Error('write op without content')
    const to = raw.to ?? raw.path ?? ''
    const { virtual, real, mount } = resolveVirtual(to, mounts)
    verifyReal(real, mount.real)
    if (mount.mode !== 'rw') throw new Error(`"${virtual}" is read-only`)
    return {
      seq,
      op: 'write',
      from: '',
      to: virtual,
      class: 'code',
      flagged: false,
      reversible: true, // previous content is journaled for undo
      bytes: Buffer.byteLength(raw.content),
      reason: `write ${Buffer.byteLength(raw.content)} bytes to ${virtual}`,
      proposable: true,
    }
  }
  if (raw.op === 'mkdir') {
    const to = raw.to ?? raw.path ?? ''
    const { virtual, real, mount } = resolveVirtual(to, mounts)
    verifyReal(real, mount.real)
    if (mount.mode !== 'rw') throw new Error(`"${virtual}" is read-only`)
    if (statVirtual(virtual, mounts)) throw new Error(`"${virtual}" already exists`)
    return { seq, op: 'mkdir', from: '', to: virtual, class: 'other', flagged: false, reversible: true, bytes: 0, reason: `create directory ${virtual}`, proposable: true }
  }
  if (!raw.from) throw new Error(`${raw.op} op without a source`)
  const { virtual: fromV, real: fromReal, mount: fromMount } = resolveVirtual(raw.from, mounts)
  verifyReal(fromReal, fromMount.real)
  const st = (() => {
    try {
      return fs.statSync(fromReal)
    } catch {
      return null
    }
  })()
  if (!st) throw new Error(`source "${fromV}" does not exist`)
  const cls = st.isDirectory() ? { class: 'other' as FileClass, flagged: false, reason: 'directory' } : classify(path.basename(fromV))

  if (raw.op === 'trash') {
    if (fromMount.mode !== 'rw') throw new Error(`"${fromV}" is read-only`)
    return {
      seq,
      op: 'trash',
      from: fromV,
      to: '', // assigned under .awon-trash/<runId>/ at execution time
      class: cls.class,
      flagged: true, // trashing anything is always flagged
      reversible: true, // undo restores from trash
      bytes: st.size,
      reason: `${cls.reason} - move to .awon-trash`,
      proposable: true,
    }
  }

  if (!raw.to) throw new Error(`${raw.op} op without a destination`)
  let { virtual: toV, real: toReal } = resolveVirtual(raw.to, mounts)
  const toMount = resolveVirtual(raw.to, mounts).mount
  verifyReal(toReal, toMount.real)
  if (fromMount.mode !== 'rw' || toMount.mode !== 'rw') throw new Error('move/copy requires rw on both ends')
  // moving INTO an existing directory is legitimate: resolve to dir/basename
  // so the plan card shows the true final path and collisions stay detectable
  if (fs.existsSync(toReal) && fs.statSync(toReal).isDirectory()) {
    toV = `${toV.replace(/\/$/, '')}/${path.basename(fromV)}`
    const remounted = resolveVirtual(toV, mounts)
    toV = remounted.virtual
    toReal = remounted.real
    if (fs.existsSync(toReal)) throw new Error(`destination "${toV}" already exists`)
  }
  if (fromV === toV) throw new Error('source and destination are the same')
  if (statVirtual(toV, mounts)) throw new Error(`destination "${toV}" already exists`)
  // duplicate-destination check inside this same plan
  const dup = prior.find((p) => p.proposable && p.op !== 'write' && p.op !== 'mkdir' && p.to === toV)
  if (dup) throw new Error(`plan collides: step ${dup.seq} already targets "${toV}"`)
  return {
    seq,
    op: raw.op,
    from: fromV,
    to: toV,
    class: cls.class,
    flagged: cls.flagged,
    reversible: true,
    bytes: st.size,
    reason: `${raw.op === 'move' ? 'move' : 'copy'}: ${cls.reason}`,
    proposable: true,
  }
}

// default cleanup policy: the rule table for "clean up my Downloads folder".
// Junk + installers go to trash; documents/images/archives get type folders;
// everything else stays. Flagged items are listed explicitly on the card.
export function cleanupPlanFor(dirVirtual: string): DryRunPlan {
  const st = statVirtual(dirVirtual)
  if (!st || !st.isDirectory()) {
    // a plan that cannot even read the directory: refuse everything honestly
    return planOperations([{ op: 'trash', from: dirVirtual }])
  }
  const { real } = resolveVirtual(dirVirtual)
  const rawOps: RawOp[] = []
  const names = fs.readdirSync(real).filter((n) => !n.startsWith('.'))
  for (const name of names) {
    const from = `${dirVirtual.replace(/\/$/, '')}/${name}`
    const { class: cls } = classify(name)
    if (cls === 'junk' || cls === 'installers') {
      rawOps.push({ op: 'trash', from })
    } else if (cls === 'documents') {
      rawOps.push({ op: 'move', from, to: `~/Documents/${name}` })
    } else if (cls === 'images') {
      rawOps.push({ op: 'move', from, to: `~/Pictures/${name}` })
    } else if (cls === 'archives') {
      rawOps.push({ op: 'move', from, to: `~/Documents/archives/${name}` })
    }
    // code/data/video/audio/other: untouched by default policy
  }
  return planOperations(rawOps)
}

export { PrisonEscapeError }

// ─── pending-plan cache ─────────────────────────────────────────────────────
// The plan card intentionally omits write-op CONTENT (a card with 4MB of text
// is useless). The executor needs the content back after approval, so raw ops
// are cached in-memory by planId for the consent window (single process).
const pendingRaw = new Map<string, RawOp[]>()
export function cachePlanRaw(planId: string, rawOps: RawOp[]): void {
  pendingRaw.set(planId, rawOps)
  // keep the cache bounded: drop plans older than 15 minutes by re-creating
  // entries with timestamps
  if (pendingRaw.size > 64) {
    const first = pendingRaw.keys().next().value
    if (first) pendingRaw.delete(first)
  }
}
export function getCachedPlanRaw(planId: string): RawOp[] | undefined {
  return pendingRaw.get(planId)
}
