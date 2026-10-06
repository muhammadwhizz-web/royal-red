// AWON OSWorld-V2 harness - SCAFFOLD ONLY (master directive Phase 2).
//
// Task loader, scoring wrapper interface and report formatter for the
// OSWorld-V2 benchmark. Per the directive: SCAFFOLD NOW, EXECUTE IN PHASE 3 -
// real task execution requires agent-facing browser/OS control that does not
// exist yet. Running against the sandboxed preview would produce meaningless
// scores, so there is deliberately NO runner here: loading, normalizing and
// reporting are pure, unit-testable functions.
//
// Data source: /home/z/wh-work/extracted/OSWorld-V2-main (evaluation_examples/
// examples/<app>/<uuid>.json + category index JSONs). If the payload is not
// present, the loader reports an honest empty result instead of failing.
import fs from 'fs'
import path from 'path'

export const OSWORLD_ROOT = '/home/z/wh-work/extracted/OSWorld-V2-main'

export interface OsworldTask {
  id: string
  app: string // chrome, gimp, libreoffice_calc...
  instruction: string
  category: string | null // cross_source_reasoning, dynamic_environment...
  snapshot: string
  relatedApps: string[]
  evaluatorFunc: string // exact_match | rule | ...
  resultType: string
  expectedType: string
  setupSteps: number
  raw: unknown // kept for the Phase 3 runner; never executed in Phase 2
}

export interface OsworldIndex {
  available: boolean
  reason?: string
  tasks: OsworldTask[]
  categories: Record<string, number> // category -> task count
  apps: Record<string, number>
  // the official category files use sequential ids ("001"..) that resolve to
  // the GATED HF task release, not the public uuid example files; the loader
  // records the index counts as metadata and marks the mapping unavailable
  categoryIndexCounts: Record<string, number>
  categoryMappingAvailable: boolean
}

interface RawTaskFile {
  id?: string
  snapshot?: string
  instruction?: string
  related_apps?: string[]
  config?: unknown[]
  evaluator?: { func?: string; result?: { type?: string }; expected?: { type?: string } }
}

function normalizeTask(app: string, category: string | null, raw: RawTaskFile): OsworldTask | null {
  if (!raw?.id || !raw?.instruction) return null
  return {
    id: String(raw.id),
    app,
    instruction: String(raw.instruction).slice(0, 2000),
    category,
    snapshot: String(raw.snapshot ?? app),
    relatedApps: Array.isArray(raw.related_apps) ? raw.related_apps.map(String).slice(0, 8) : [],
    evaluatorFunc: String(raw.evaluator?.func ?? 'unknown'),
    resultType: String(raw.evaluator?.result?.type ?? 'unknown'),
    expectedType: String(raw.evaluator?.expected?.type ?? 'unknown'),
    setupSteps: Array.isArray(raw.config) ? raw.config.length : 0,
    raw,
  }
}

// load the full task index. Bounded reads; missing payload -> honest empty.
export function loadOsworldIndex(root = OSWORLD_ROOT): OsworldIndex {
  const empty = { categories: {}, apps: {}, categoryIndexCounts: {}, categoryMappingAvailable: false }
  if (!fs.existsSync(root)) {
    return { available: false, reason: `payload not found at ${root} (sandbox reset wipes /home/z/wh-work)`, tasks: [], ...empty }
  }
  const examplesRoot = fs.existsSync(path.join(root, 'evaluation_examples', 'examples'))
    ? path.join(root, 'evaluation_examples', 'examples')
    : root
  const tasks: OsworldTask[] = []
  const categories: Record<string, number> = {}
  const apps: Record<string, number> = {}
  const categoryIndexCounts: Record<string, number> = {}

  // official category index files: { "<category>": ["001", ...] }. The ids are
  // sequential release ids (gated HF dataset), NOT the public uuid files, so
  // we count them as metadata only - never pretend a mapping exists.
  const indexFiles = ['conflict_disambiguation.json', 'cross_source_reasoning.json', 'dynamic_environment.json', 'human_in_the_loop.json', 'implicit_state_inference.json', 'multi_item_state_tracking.json', 'multimodal_editing.json', 'tutorial_following.json', 'streaming_interaction.json', 'visual_spatial_precision.json']
  for (const f of indexFiles) {
    try {
      const p = path.join(root, 'evaluation_examples', f)
      if (!fs.existsSync(p)) continue
      const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string[]>
      for (const [cat, ids] of Object.entries(data)) {
        if (!Array.isArray(ids)) continue
        categoryIndexCounts[cat] = (categoryIndexCounts[cat] ?? 0) + ids.length
      }
    } catch {}
  }

  // examples/<app>/<uuid>.json
  let appDirs: string[] = []
  try {
    appDirs = fs.readdirSync(examplesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return { available: false, reason: 'examples directory unreadable', tasks: [], ...empty }
  }
  for (const app of appDirs.sort()) {
    const dir = path.join(examplesRoot, app)
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RawTaskFile
        // uuid files never carry the sequential release ids; categories stay
        // honest: unassigned unless a future release ships a real mapping
        const t = normalizeTask(app, null, raw)
        if (!t) continue
        tasks.push(t)
        apps[app] = (apps[app] ?? 0) + 1
      } catch {}
    }
  }

  if (!tasks.length) {
    return { available: false, reason: 'no example tasks parsed from the payload', tasks: [], ...empty }
  }
  const categoryMappingAvailable = false // sequential ids resolve to the gated HF release
  return { available: true, tasks, categories, apps, categoryIndexCounts, categoryMappingAvailable }
}

// ---------------------------------------------------------------------------
// scoring wrapper (Phase 3 interface, Phase 2 stubs)
// ---------------------------------------------------------------------------

export interface TaskRunRecord {
  taskId: string
  app: string
  instruction: string
  status: 'pending' | 'running' | 'pass' | 'fail' | 'error' | 'skipped'
  score?: number
  durationMs?: number
  agentTranscript?: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface OsworldScoreResult {
  task: OsworldTask
  passed: boolean
  detail: string
}

// The Phase 3 contract: given a finished agent episode, decide pass/fail by
// invoking the task's evaluator against the live environment. In Phase 2 this
// interface exists so the report formatter and QA tooling can be built and
// tested against pending records; evaluateTask is NOT callable yet.
export interface OsworldRunner {
  readonly executable: false
  runTask(task: OsworldTask): Promise<OsworldScoreResult>
}

export function createDeferredRunner(reason: string): OsworldRunner {
  return {
    executable: false,
    async runTask() {
      throw new Error(`OSWorld-V2 execution deferred to Phase 3: ${reason}`)
    },
  }
}

// ---------------------------------------------------------------------------
// report formatter (works on pending + executed records)
// ---------------------------------------------------------------------------

export function formatOsworldReport(index: OsworldIndex, runs: TaskRunRecord[]): string {
  const byTask = new Map(runs.map((r) => [r.taskId, r]))
  const executed = runs.filter((r) => ['pass', 'fail', 'error'].includes(r.status))
  const passed = executed.filter((r) => r.status === 'pass').length
  const rate = executed.length ? Math.round((passed / executed.length) * 1000) / 10 : 0

  const lines: string[] = [
    '# OSWorld-V2 harness report',
    '',
    `- payload available: ${index.available ? 'yes' : `no (${index.reason ?? 'unknown'})`}`,
    `- tasks indexed (public examples): ${index.tasks.length}`,
    `- official benchmark size: ${Object.values(index.categoryIndexCounts).reduce((s, n) => s + n, 0)} tasks across ${Object.keys(index.categoryIndexCounts).length} categories (category-to-task mapping ships with the gated task release)`,
    `- executed: ${executed.length} (pass ${passed}, fail ${executed.filter((r) => r.status === 'fail').length}, error ${executed.filter((r) => r.status === 'error').length})`,
    `- success rate: ${executed.length ? `${rate}%` : 'n/a (nothing executed yet - scaffold phase)'}`,
    `- reference SOTA to beat: 20.6%`,
    '',
    '## official category index',
    '',
    '| category | tasks |',
    '| --- | --- |',
  ]
  for (const [c, n] of Object.entries(index.categoryIndexCounts).sort()) lines.push(`| ${c} | ${n} |`)
  lines.push('', '## apps', '', '| app | tasks |', '| --- | --- |')
  for (const [a, n] of Object.entries(index.apps).sort()) lines.push(`| ${a} | ${n} |`)

  if (executed.length) {
    lines.push('', '## run detail', '')
    for (const r of executed.slice(0, 40)) {
      lines.push(`- ${r.taskId.slice(0, 8)} ${r.status.toUpperCase()}${r.durationMs ? ` (${Math.round(r.durationMs / 100) / 10}s)` : ''}${r.error ? ` - ${r.error.slice(0, 120)}` : ''}`)
    }
  } else {
    lines.push('', '## run detail', '', 'nothing executed yet: the runner ships in Phase 3 (agent-facing browser/OS hands). This report proves the harness loads and indexes the benchmark.')
  }
  return lines.join('\n')
}
