// ROYAL RED verification engine (Phase 2 orchestrator).
//
// Runs the full Verification 2.0 pipeline for a finished artifact:
//   1. constraint ledger grading (deterministic kernel checks first)
//   2. adversarial critique (independent second opinion, no shared context)
//   3. visual regression (deterministic screenshots + perceptual hashes)
//   4. CMS panel verification (scoped browser, real create + persistence)
//   5. competitor benchmark (on demand - /verify benchmark, not every build)
//
// Every receipt is persisted to RoyalRedVerification and streamed to the console
// as SSE 'verify' events. The HONEST score is min(builder, critic) when both
// exist - the dashboard never shows an inflated number.
import { db } from '@/lib/db'
import {
  artifactSnapshot,
  autoGrade,
  loadLedger,
  type ConstraintVerdict,
  type LedgerItem,
} from './ledger'
import { runCritique, mergeCriticVerdicts, disagreement, type CritiqueResult } from './critic'
import {
  captureShots,
  compareShots,
  latestBaseline,
  readTileGrid,
  newRunId,
  type ShotResult,
  type VisualDiff,
} from './visual'
import { verifyCms, type CmsReport } from './cms'
import { runBenchmark, type BenchmarkReport, type TaxonomyId } from './benchmark'

export interface LedgerReceipt {
  runId: string
  artifactId: string
  items: LedgerItem[]
  verdicts: ConstraintVerdict[]
  passed: number
  failed: number
  unclear: number
}

export interface CritiqueReceipt {
  runId: string
  artifactId: string
  critique: CritiqueResult
  builderScore: number | null
  delta: number
  disagree: boolean
  honestScore: number | null
}

export interface VisualReceipt {
  runId: string
  artifactId: string
  shots: ShotResult[]
  diffs: VisualDiff[]
}

export type Emit = (e: { type: string; [k: string]: unknown }) => void

async function saveVerification(sessionId: string, artifactId: string | null, kind: string, status: string, score: number | null, data: unknown): Promise<void> {
  try {
    await db.royalRedVerification.create({
      data: {
        sessionId,
        artifactId,
        kind,
        status,
        score,
        data: JSON.stringify(data),
      },
    })
  } catch (e) {
    console.error(`verification persist failed (${kind})`, e)
  }
}

function artifactScoreSnapshot(filesJson: string): { files: { path: string; content: string }[]; entry: string; textOnly: boolean } {
  const files = JSON.parse(filesJson) as { path: string; content: string }[]
  const entryFile = files.find((f) => /index\.html?$/i.test(f.path)) ?? files.find((f) => /\.html?$/i.test(f.path))
  return { files, entry: entryFile?.path ?? 'index.html', textOnly: !files.some((f) => /\.html?$/i.test(f.path)) }
}

// ---------- pipeline pieces ----------

export async function verifyLedger(sessionId: string, artifactId: string, runId: string, filesJson: string): Promise<LedgerReceipt | null> {
  const items = await loadLedger(sessionId)
  if (!items.length) return null
  const snap = artifactSnapshot(JSON.parse(filesJson) as { path: string; content: string }[], artifactScoreSnapshot(filesJson).entry)
  const verdicts: ConstraintVerdict[] = []
  for (const item of items) {
    const r = autoGrade(item, snap)
    verdicts.push(r.verdict)
  }
  // critic verdicts merge in later (engine step 2) via mergeCriticVerdicts
  const passed = verdicts.filter((v) => v.verdict === 'pass').length
  const failed = verdicts.filter((v) => v.verdict === 'fail').length
  const unclear = verdicts.filter((v) => v.verdict === 'unclear').length
  const receipt: LedgerReceipt = { runId, artifactId, items, verdicts, passed, failed, unclear }
  return receipt
}

export async function verifyCritique(
  sessionId: string,
  artifactId: string,
  runId: string,
  userPrompt: string,
  filesJson: string,
  builderScore: number | null,
  shotNotes: string[],
): Promise<CritiqueReceipt> {
  const { files, entry } = artifactScoreSnapshot(filesJson)
  const constraints = await loadLedger(sessionId)
  const critique = await runCritique({
    userPrompt,
    constraints,
    files,
    entry,
    screenshotDescriptions: shotNotes,
  })
  const d = disagreement(builderScore, critique)
  const honestScore =
    critique.status === 'ok'
      ? builderScore !== null
        ? Math.min(builderScore, critique.score)
        : critique.score
      : builderScore
  return {
    runId,
    artifactId,
    critique,
    builderScore,
    delta: d.delta,
    disagree: d.disagree,
    honestScore,
  }
}

export async function verifyVisual(sessionId: string, artifactId: string, runId: string): Promise<VisualReceipt> {
  // explicit entry file: the bare trailing-slash preview url 308-redirects to
  // a path the catch-all route does not match (404)
  const previewUrl = `http://localhost:3000/api/royal-red/preview/${artifactId}/index.html`
  const shots = await captureShots(previewUrl, sessionId, runId)
  const baseline = await latestBaseline(sessionId, runId)
  const diffs: VisualDiff[] = []
  for (const s of shots) {
    if (!s.ok || !s.hash || !s.file) {
      diffs.push({
        viewport: s.viewport,
        baselineRun: baseline?.runId ?? null,
        hashA: null,
        hashB: s.hash ?? null,
        hamming: 64,
        similarity: 0,
        changedRegions: [],
        changedPct: 100,
        verdict: 'error',
      })
      continue
    }
    let tilesB: number[] = []
    try {
      tilesB = await readTileGrid(s.file)
    } catch {}
    const hashA = baseline?.hashes[s.viewport] ?? null
    const tilesA = baseline?.tiles[s.viewport] ?? null
    diffs.push(compareShots(s.viewport, baseline?.runId ?? null, hashA, s.hash, tilesA ?? null, tilesB))
  }
  // persist tile grids inside the report so the next run has its baseline
  const tiles: Record<string, number[]> = {}
  for (const s of shots) {
    if (s.ok && s.file) {
      try {
        tiles[s.viewport] = await readTileGrid(s.file)
      } catch {}
    }
  }
  return { runId, artifactId, shots: shots.map(({ file, ...rest }) => rest), diffs, tiles } as VisualReceipt & { tiles: Record<string, number[]> }
}

// the builder quality bar ships an admin panel with every site; whenever a
// cms page exists in the artifact, its login/create/persist flow gets proofed
export async function shouldRunCms(sessionId: string, filesJson: string): Promise<string | null> {
  const files = JSON.parse(filesJson) as { path: string; content: string }[]
  const cmsFile = files.find((f) => /cms(\d*)\.html?$/i.test(f.path))
  return cmsFile?.path ?? null
}

// ---------- full pipeline ----------

export interface VerificationOptions {
  withBenchmark?: TaxonomyId | null
  emit?: Emit
}

export async function runVerification(
  sessionId: string,
  artifactId: string,
  userPrompt: string,
  builderScore: number | null,
  opts: VerificationOptions = {},
): Promise<{ runId: string; ledger: LedgerReceipt | null; critique: CritiqueReceipt | null; visual: VisualReceipt | null; cms: CmsReport | null; benchmark: BenchmarkReport | null }> {
  const runId = newRunId()
  const artifact = await db.royalRedArtifact.findUnique({ where: { id: artifactId }, select: { files: true, entry: true } })
  if (!artifact) throw new Error(`artifact ${artifactId} not found`)
  const emit = opts.emit
  emit?.({ type: 'phase', value: 'verification 2.0' })

  // 1. constraint ledger
  emit?.({ type: 'verify', kind: 'ledger', status: 'run' })
  let ledger = await verifyLedger(sessionId, artifactId, runId, artifact.files)
  let ledgerStatus = 'unverified'
  if (ledger) {
    ledgerStatus = ledger.failed === 0 && ledger.unclear === 0 ? 'pass' : ledger.failed === 0 ? 'partial' : 'fail'
  }
  await saveVerification(sessionId, artifactId, 'ledger', ledgerStatus, null, ledger ?? { runId, note: 'no constraints extracted for this session' })
  emit?.({
    type: 'verify',
    kind: 'ledger',
    status: ledgerStatus,
    summary: ledger ? `${ledger.passed}/${ledger.items.length} constraints pass (${ledger.failed} fail, ${ledger.unclear} unclear)` : 'no constraint ledger for this session',
    data: ledger,
  })

  // 2. visual regression (before critique so the critic gets screenshot notes)
  emit?.({ type: 'verify', kind: 'visual', status: 'run' })
  let visual: VisualReceipt | null = null
  let shotNotes: string[] = []
  try {
    visual = await verifyVisual(sessionId, artifactId, runId)
    await saveVerification(sessionId, artifactId, 'visual', visual.shots.every((s) => s.ok) ? 'pass' : visual.shots.some((s) => s.ok) ? 'partial' : 'error', null, visual)
    emit?.({
      type: 'verify',
      kind: 'visual',
      status: visual.shots.every((s) => s.ok) ? 'pass' : 'partial',
      summary: visual.diffs.map((d) => `${d.viewport}: ${d.verdict}${d.baselineRun ? ` (hamming ${d.hamming})` : ' (new baseline)'}`).join(' · '),
      data: visual,
    })
  } catch (e) {
    await saveVerification(sessionId, artifactId, 'visual', 'error', null, { runId, error: (e as Error).message.slice(0, 300) })
    emit?.({ type: 'verify', kind: 'visual', status: 'error', summary: `visual regression failed: ${(e as Error).message.slice(0, 120)}` })
  }

  // 2b. VLM notes on the desktop shot feed the critique (semantic layer)
  if (visual) {
    const desktop = visual.shots.find((s) => s.viewport === 'desktop' && s.ok)
    if (desktop?.relFile) {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const { WORKSPACE_ROOT } = await import('../workspace')
        const buf = fs.default.readFileSync(path.default.join(WORKSPACE_ROOT, desktop.relFile))
        const { seamVision } = await import('../llm/seam')
        const vr = await seamVision({
          operation: 'verify.shot-note',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this website screenshot in 4-6 factual sentences: layout, visual identity, content sections, and any visible flaws (broken layout, unreadable text, overlaps).' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } },
              ],
            },
          ],
        })
        if (!vr.ok) throw new Error(vr.meta.error ?? 'vision failed')
        const note = vr.text
        if (note.trim()) shotNotes = [note.slice(0, 1200)]
      } catch {}
    }
  }

  // 3. adversarial critique
  emit?.({ type: 'verify', kind: 'critique', status: 'run' })
  let critique: CritiqueReceipt | null = null
  try {
    critique = await verifyCritique(sessionId, artifactId, runId, userPrompt, artifact.files, builderScore, shotNotes)
    await saveVerification(
      sessionId,
      artifactId,
      'critique',
      critique.critique.status === 'ok' ? 'pass' : 'unverified',
      critique.honestScore,
      critique,
    )
    emit?.({
      type: 'verify',
      kind: 'critique',
      status: critique.critique.status === 'ok' ? (critique.disagree ? 'partial' : 'pass') : 'unverified',
      summary:
        critique.critique.status === 'ok'
          ? `critic ${critique.critique.score}/10 vs builder ${critique.builderScore ?? '?'}/10 (${critique.disagree ? 'DISAGREE' : 'agree'}), honest score ${critique.honestScore}`
          : critique.critique.summary,
      data: critique,
    })
  } catch (e) {
    await saveVerification(sessionId, artifactId, 'critique', 'error', null, { runId, error: (e as Error).message.slice(0, 300) })
    emit?.({ type: 'verify', kind: 'critique', status: 'error', summary: `critique failed: ${(e as Error).message.slice(0, 120)}` })
  }

  // 3b. merge critic constraint verdicts into the ledger (kernel verdicts win)
  if (ledger && critique?.critique.status === 'ok') {
    ledger = { ...ledger, verdicts: mergeCriticVerdicts(ledger.verdicts, critique.critique) }
    ledger.passed = ledger.verdicts.filter((v) => v.verdict === 'pass').length
    ledger.failed = ledger.verdicts.filter((v) => v.verdict === 'fail').length
    ledger.unclear = ledger.verdicts.filter((v) => v.verdict === 'unclear').length
    // persist the MERGED verdicts so reloaded sessions see the same receipts
    const mergedStatus = ledger.failed === 0 && ledger.unclear === 0 ? 'pass' : ledger.failed === 0 ? 'partial' : 'fail'
    await saveVerification(sessionId, artifactId, 'ledger', mergedStatus, null, ledger)
    emit?.({
      type: 'verify',
      kind: 'ledger',
      status: mergedStatus,
      summary: `${ledger.passed}/${ledger.items.length} constraints pass (${ledger.failed} fail, ${ledger.unclear} unclear)`,
      data: ledger,
    })
  }

  // 4. CMS panel verification (only when the artifact ships a cms page)
  let cms: CmsReport | null = null
  const cmsPath = await shouldRunCms(sessionId, artifact.files)
  if (cmsPath) {
    emit?.({ type: 'verify', kind: 'cms', status: 'run' })
    try {
      cms = await verifyCms(artifactId, sessionId, runId, cmsPath)
      await saveVerification(sessionId, artifactId, 'cms', cms.status, null, cms)
      emit?.({ type: 'verify', kind: 'cms', status: cms.status, summary: cms.summary, data: cms })
    } catch (e) {
      await saveVerification(sessionId, artifactId, 'cms', 'error', null, { runId, error: (e as Error).message.slice(0, 300) })
      emit?.({ type: 'verify', kind: 'cms', status: 'error', summary: `cms verification failed: ${(e as Error).message.slice(0, 120)}` })
    }
  }

  // 5. competitor benchmark (explicit opt-in via /verify benchmark)
  let benchmark: BenchmarkReport | null = null
  if (opts.withBenchmark) {
    emit?.({ type: 'verify', kind: 'benchmark', status: 'run' })
    try {
      benchmark = await runBenchmark(opts.withBenchmark, `http://localhost:3000/api/royal-red/preview/${artifactId}/index.html`, runId)
      await saveVerification(sessionId, artifactId, 'benchmark', benchmark.royalRed && benchmark.royalRedTotal >= benchmark.competitorAvg ? 'pass' : 'partial', null, benchmark)
      emit?.({
        type: 'verify',
        kind: 'benchmark',
        status: benchmark.royalRed ? 'pass' : 'error',
        summary: benchmark.royalRed
          ? `ROYAL RED ${benchmark.royalRedTotal}/60 vs ${benchmark.competitors.filter((c) => c.accessible).length} competitors avg ${benchmark.competitorAvg}/60 (${benchmark.categoryLabel})`
          : 'benchmark could not score the artifact',
        data: benchmark,
      })
    } catch (e) {
      await saveVerification(sessionId, artifactId, 'benchmark', 'error', null, { runId, error: (e as Error).message.slice(0, 300) })
      emit?.({ type: 'verify', kind: 'benchmark', status: 'error', summary: `benchmark failed: ${(e as Error).message.slice(0, 120)}` })
    }
  }

  await db.royalRedAudit
    .create({
      data: {
        action: 'verify.run',
        detail: `artifact=${artifactId} run=${runId} honest=${critique?.honestScore ?? 'n/a'} ledger=${ledger ? `${ledger.passed}/${ledger.items.length}` : 'none'} cms=${cms?.status ?? 'skipped'}`,
        ok: true,
      },
    })
    .catch(() => {})

  return { runId, ledger, critique, visual, cms, benchmark }
}
