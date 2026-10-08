// ROYAL RED agent roster (Round 6, Section 3).
//
// 66 named agent employees, one per concept, each bound to a provider from the
// matrix. The roster is VIRTUALIZED: roles are defined here, not instantiated.
// The kernel spins a role up on demand (max 4 concurrent per
// docs/PHASE5-BUDGET.md), routes its work to its bound provider, and
// attributes every action with the role's name (RoyalRedAudit.agentRole,
// RoyalRedRun.agentRole).
//
// The dispatch rule: a task names a capability ("build a website", "critique
// this"); dispatchForCapability() resolves it to the role that owns that
// capability. If the role's provider has no key configured, the dispatch is
// honest: the kernel reports which role needs which key and offers a reassign.

export type AgentCategory =
  | 'planning'
  | 'building'
  | 'critique'
  | 'research'
  | 'writing'
  | 'data'
  | 'operations'
  | 'browser'
  | 'desktop'
  | 'memory'
  | 'communication'
  | 'specialist'

export interface AgentRoleDef {
  name: string
  role: string // kernel role label used in event payloads and receipts
  category: AgentCategory
  provider: string // provider id from the matrix, or 'royalred-builtin'
  model?: string // provider-model override; provider default when omitted
  budgetUsd: number // per-instantiation spend ceiling
  capabilities: string[] // what this role owns; dispatch matches on these
}

const p = (
  name: string,
  role: string,
  category: AgentCategory,
  provider: string,
  budgetUsd: number,
  capabilities: string[],
  model?: string,
): AgentRoleDef => ({ name, role, category, provider, budgetUsd, capabilities, model })

export const AGENT_ROSTER: AgentRoleDef[] = [
  // ---- planning & orchestration (5) ----
  p('Supreme Planner', 'planner', 'planning', 'anthropic', 0.4, ['plan', 'review', 'task list', 'orchestrate'], 'claude-3-5-haiku-latest'),
  p('Deputy Planner', 'deputy-planner', 'planning', 'openai', 0.3, ['plan', 'backup plan', 'replan'], 'gpt-4o-mini'),
  p('Orchestrator', 'orchestrator', 'planning', 'royalred-builtin', 0, ['dispatch', 'spawn', 'coordinate']),
  p('Router', 'router', 'planning', 'royalred-builtin', 0, ['route', 'provider selection', 'cost policy']),
  p('Budget Keeper', 'budget-keeper', 'planning', 'royalred-builtin', 0, ['budget', 'spend ceiling', 'cost check']),

  // ---- building (10) ----
  p('Website Builder', 'builder', 'building', 'openai', 0.6, ['website', 'landing page', 'multi-page site', 'html site'], 'gpt-4o-mini'),
  p('Code Builder', 'builder', 'building', 'anthropic', 0.6, ['code', 'function', 'script', 'refactor'], 'claude-3-5-haiku-latest'),
  p('Component Builder', 'builder', 'building', 'openai', 0.4, ['component', 'widget', 'ui element']),
  p('Page Builder', 'builder', 'building', 'openai', 0.4, ['page', 'section', 'layout']),
  p('CMS Builder', 'builder', 'building', 'openai', 0.5, ['cms', 'admin panel', 'content management']),
  p('WordPress Builder', 'builder', 'building', 'anthropic', 0.5, ['wordpress', 'wp theme', 'wordpress theme']),
  p('PDF Builder', 'builder', 'building', 'royalred-builtin', 0, ['pdf', 'paginated document']),
  p('Poster Builder', 'builder', 'building', 'royalred-builtin', 0, ['poster', 'print layout']),
  p('Document Builder', 'builder', 'building', 'royalred-builtin', 0, ['document', 'report layout', 'letter']),
  p('Slide Builder', 'builder', 'building', 'openai', 0.4, ['slide', 'deck', 'presentation']),

  // ---- critique & verification (8) ----
  p('Crown Critic', 'critic', 'critique', 'anthropic', 0.3, ['critique', 'review build', 'quality gate'], 'claude-3-5-haiku-latest'),
  p('Visual Verifier', 'verifier', 'critique', 'google', 0.2, ['visual check', 'screenshot review', 'overlap check']),
  p('Accessibility Verifier', 'verifier', 'critique', 'royalred-builtin', 0, ['accessibility', 'a11y', 'wcag', 'aria']),
  p('SEO Verifier', 'verifier', 'critique', 'royalred-builtin', 0, ['seo', 'meta tags', 'sitemap', 'structured data']),
  p('Performance Verifier', 'verifier', 'critique', 'royalred-builtin', 0, ['performance', 'web vitals', 'load weight']),
  p('Honesty Auditor', 'auditor', 'critique', 'anthropic', 0.2, ['honesty', 'receipt audit', 'claim check']),
  p('Constraint Checker', 'grader', 'critique', 'royalred-builtin', 0, ['constraint grade', 'ledger check']),
  p('Receipt Writer', 'receipt', 'critique', 'royalred-builtin', 0, ['receipt', 'final report']),

  // ---- research (8) ----
  p('Web Researcher', 'researcher', 'research', 'google', 0.3, ['research', 'search', 'multi-page research']),
  p('Page Reader', 'reader', 'research', 'royalred-builtin', 0, ['read page', 'extract page', 'fetch url']),
  p('Video Watcher', 'analyst', 'research', 'google', 0.3, ['video', 'watch video', 'video analysis']),
  p('Image Analyst', 'analyst', 'research', 'openai', 0.2, ['image analysis', 'screenshot read', 'vlm']),
  p('Source Verifier', 'verifier', 'research', 'anthropic', 0.2, ['verify source', 'fact check']),
  p('Citation Writer', 'writer', 'research', 'anthropic', 0.15, ['citation', 'bibliography']),
  p('Market Analyst', 'analyst', 'research', 'openai', 0.3, ['market analysis', 'pricing landscape']),
  p('Competitor Scout', 'scout', 'research', 'google', 0.3, ['competitor', 'benchmark', '10-site matrix']),

  // ---- writing & content (8) ----
  p('Copywriter', 'writer', 'writing', 'anthropic', 0.25, ['copy', 'marketing copy', 'product copy']),
  p('Editor', 'editor', 'writing', 'anthropic', 0.2, ['edit', 'proofread', 'tone pass']),
  p('Typographer', 'typographer', 'writing', 'royalred-builtin', 0, ['typography', 'font pairing']),
  p('SEO Writer', 'writer', 'writing', 'openai', 0.2, ['seo copy', 'keywords']),
  p('Headline Writer', 'writer', 'writing', 'openai', 0.15, ['headline', 'title']),
  p('Meta Writer', 'writer', 'writing', 'openai', 0.1, ['meta description', 'og tags']),
  p('Scribe', 'scribe', 'writing', 'royalred-builtin', 0, ['transcript', 'session notes']),
  p('Translator', 'translator', 'writing', 'google', 0.2, ['translate', 'localization']),

  // ---- data & analysis (6) ----
  p('Data Analyst', 'analyst', 'data', 'openai', 0.3, ['data analysis', 'insight', 'summary stats']),
  p('Chart Builder', 'chartist', 'data', 'royalred-builtin', 0, ['chart', 'bar', 'line', 'pie']),
  p('Report Writer', 'writer', 'data', 'anthropic', 0.3, ['report', 'analysis report']),
  p('Table Builder', 'builder', 'data', 'royalred-builtin', 0, ['table', 'grid layout']),
  p('CSV Handler', 'handler', 'data', 'royalred-builtin', 0, ['csv', 'parse csv', 'export csv']),
  p('Spreadsheet Builder', 'builder', 'data', 'royalred-builtin', 0, ['spreadsheet', 'xlsx']),

  // ---- operations (6) ----
  p('File Manager', 'operator', 'operations', 'royalred-builtin', 0, ['file', 'move files', 'organize']),
  p('Archive Manager', 'operator', 'operations', 'royalred-builtin', 0, ['archive', 'zip', 'unzip']),
  p('Download Handler', 'operator', 'operations', 'royalred-builtin', 0, ['download', 'fetch file']),
  p('Upload Handler', 'operator', 'operations', 'royalred-builtin', 0, ['upload', 'ingest file']),
  p('Trash Keeper', 'operator', 'operations', 'royalred-builtin', 0, ['trash', 'safe delete']),
  p('Undo Officer', 'operator', 'operations', 'royalred-builtin', 0, ['undo', 'revert', 'journal']),

  // ---- browser hands (5) ----
  p('Navigator', 'browser-hand', 'browser', 'royalred-builtin', 0, ['navigate', 'open url', 'go back']),
  p('Clicker', 'browser-hand', 'browser', 'royalred-builtin', 0, ['click', 'press button']),
  p('Typer', 'browser-hand', 'browser', 'royalred-builtin', 0, ['type', 'fill form']),
  p('Reader', 'browser-hand', 'browser', 'royalred-builtin', 0, ['read dom', 'extract text']),
  p('Screenshotter', 'browser-hand', 'browser', 'royalred-builtin', 0, ['screenshot', 'capture page']),

  // ---- desktop hands (4) ----
  p('Window Watcher', 'desktop-hand', 'desktop', 'royalred-builtin', 0, ['window list', 'focus window']),
  p('Screen Reader', 'desktop-hand', 'desktop', 'royalred-builtin', 0, ['read screen', 'ocr']),
  p('Click Officer', 'desktop-hand', 'desktop', 'royalred-builtin', 0, ['desktop click', 'move cursor']),
  p('Keyboard Officer', 'desktop-hand', 'desktop', 'royalred-builtin', 0, ['keyboard', 'hotkey', 'type text']),

  // ---- memory & state (3) ----
  p('Archivist', 'archivist', 'memory', 'royalred-builtin', 0, ['archive memory', 'persist record']),
  p('Memory Keeper', 'memory-keeper', 'memory', 'royalred-builtin', 0, ['remember', 'recall', 'forget']),
  p('Historian', 'historian', 'memory', 'royalred-builtin', 0, ['history', 'session past', 'event replay']),

  // ---- communication (2) ----
  p('Herald', 'herald', 'communication', 'royalred-builtin', 0, ['announce', 'status line']),
  p('Notifier', 'notifier', 'communication', 'royalred-builtin', 0, ['notify', 'alert user']),

  // ---- specialist (1) ----
  p('The Sovereign', 'sovereign', 'specialist', 'anthropic', 0.5, ['arbitrate', 'final decision', 'tiebreak'], 'claude-3-5-sonnet-latest'),
]

// ---- roster laws (tested in scripts/test-agent-roster.ts) ----

export const ROSTER_CEILING = 66

export function rosterStats(): { total: number; byCategory: Record<string, number>; byProvider: Record<string, number> } {
  const byCategory: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  for (const r of AGENT_ROSTER) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1
  }
  return { total: AGENT_ROSTER.length, byCategory, byProvider }
}

export function roleByName(name: string): AgentRoleDef | undefined {
  return AGENT_ROSTER.find((r) => r.name.toLowerCase() === name.toLowerCase())
}

// dispatch: match a task description against role capabilities. Returns the
// most specific role whose capability set intersects the task's keywords.
// Deterministic: ties break by roster order (planning before building before
// critique), and only ONE role wins.
export function dispatchForCapability(task: string): AgentRoleDef | null {
  const words = task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let best: { role: AgentRoleDef; score: number } | null = null
  for (const role of AGENT_ROSTER) {
    let score = 0
    for (const cap of role.capabilities) {
      const capWords = cap.split(/\s+/)
      if (capWords.length === 1) {
        if (words.includes(cap)) score += 2
      } else if (capWords.every((w) => words.includes(w))) {
        score += 3 // multi-word capability match is stronger
      } else if (capWords.some((w) => words.includes(w))) {
        score += 1
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { role, score }
  }
  return best?.role ?? null
}

// the honest dispatch report when a role's provider has no configured key
export function unavailabilityReport(role: AgentRoleDef): string {
  if (role.provider === 'royalred-builtin') return ''
  return `The ${role.name} is bound to ${role.provider} and that provider has no key configured. Either add a ${role.provider} key in the PROVIDERS panel, or reassign this role to a provider with a key.`
}
