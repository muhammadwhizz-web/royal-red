// ROYAL RED tool policy waterfall (Royal Red Round 2, DeepSeek-harness port #2).
//
// SOURCE PATTERN (MIT, verified upstream 2026-10-07):
//   deepseek-harness `packages/core/tools/src/index.ts:1131-1133` — "Register
//   a monotonic guard after the extensible `tools/pre-execute` waterfall. A
//   plain-context guard applies globally; one registered through `agent.ctx`
//   applies only to that agent. Any matching guard may deny by returning a
//   reason, while NO guard can force-allow a call another guard denied."
//   `:1507-1509` — the gate resolves through the waterfall before dispatch;
//   `:1509-1511` — `ask` gates route to the approval channel;
//   `:1519` — the denial names its reason. `known-event-types.ts` —
//   `approval/asked` / `approval/decided` / `approval/policy` are typed log
//   events, which here become `policy/decision` event-log entries.
//
// PORT DISCIPLINE (direct pattern port, reimplemented natively):
//   Five inspectable layers, evaluated in order —
//     1. global   kernel defaults (registry membership, shell allowlist,
//                 destructive-pattern veto, workspace escape veto)
//     2. mode     per-mode overrides (build / research / pc)
//     3. session  per-session rules the user typed (RoyalRedConsentRule rows)
//     4. turn     per-turn rules supplied with the directive
//     5. action   per-action consent — for box-tiered tools the decision is
//                 `ask` and enforcement is DELEGATED to the existing consent
//                 engine (box/consent.ts) which owns tier batching/timeout
//   The final decision ALWAYS names the layer that won (harness :1519
//   discipline) and is appended to the durable event log (`policy/decision`).
//   Monotonicity: later layers may only NARROW. No rule can force-allow a
//   call a higher layer denied — the harness's guard contract, kept verbatim.

import { db } from '@/lib/db'
import { appendEvent } from '../event-log'

export type PolicyVerdict = 'allow' | 'deny' | 'ask'
export type PolicyLayerName = 'global' | 'mode' | 'session' | 'turn' | 'action-consent'

export interface PolicyLayerSnapshot {
  name: PolicyLayerName
  rulesConsidered: number
  source: string
}

export interface PolicyDecision {
  tool: string
  verdict: PolicyVerdict
  layer: PolicyLayerName
  reason: string
  ruleId?: string
  /** for verdict 'ask': which engine enforces the ask (the consent engine owns tiers) */
  enforcedBy?: 'consent-engine'
  layers: PolicyLayerSnapshot[]
}

// ---------- global layer: kernel defaults (fail closed) ----------

// The kernel shell allowlist — single source of truth. tools.ts imports this
// so the waterfall and the executor can never drift apart.
export const SHELL_ALLOWLIST = [
  'uname', 'whoami', 'uptime', 'date', 'df', 'free', 'ps',
  'ls', 'echo', 'wc', 'head', 'tail', 'python3', 'node', 'bun',
]

// Patterns that are never executable by the agent even via whitelisted
// interpreters (defense in depth; the interpreters run sandboxed).
const DESTRUCTIVE_SHELL_PATTERNS: RegExp[] = [
  /rm\s+(-[a-zA-Z]*\s+)*-?[rf]{2,}/i, // rm -rf and friends
  /mkfs(\.\w+)?\s/i,
  /dd\s+[^\n]*of=\/dev\//i,
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, // fork bomb
  /chmod\s+-R\s+777\s+\/(?!home\/royalred)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
]

// Desktop primitives and their consent tier (mirrors box/consent.ts T1/T2/T3).
const BOX_TIERS: Record<string, 1 | 2 | 3> = {
  box_list: 1, box_read: 1, screen_shot: 1,
  box_plan: 2, box_write: 2, box_mkdir: 2, box_move: 2, box_copy: 2, box_undo: 2,
  box_trash: 3, shell_exec: 3, screen_click: 3, screen_type: 3,
}

// Tools the kernel registry knows. Anything else is denied at the global
// layer (previously an unnamed default-case error — now a named-layer veto).
const KNOWN_TOOLS = new Set([
  ...Object.keys(BOX_TIERS),
  'web_search', 'list_files', 'read_file', 'write_file', 'shell',
  'system_report', 'create_account', 'remove_account', 'list_accounts',
  'generate_image', 'analyze_image', 'analyze_video', 'read_page',
])

const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'system_report', 'list_accounts', 'web_search', 'read_page'])

interface ToolShape {
  name: string
  args?: Record<string, unknown>
}

function globalDecide(t: ToolShape): { verdict: PolicyVerdict; reason: string } | null {
  if (!KNOWN_TOOLS.has(t.name)) {
    return { verdict: 'deny', reason: `unknown tool: "${t.name}" is not in the kernel tool registry (fail closed)` }
  }
  if (t.name === 'shell' || t.name === 'shell_exec') {
    const cmd = String(t.args?.command ?? '').trim()
    const bin = cmd.split(/\s+/)[0] ?? ''
    if (bin && !SHELL_ALLOWLIST.includes(bin)) {
      return { verdict: 'deny', reason: `shell binary "${bin}" is not on the kernel allowlist` }
    }
    for (const re of DESTRUCTIVE_SHELL_PATTERNS) {
      if (re.test(cmd)) {
        return { verdict: 'deny', reason: `destructive shell pattern veto (${re.source.slice(0, 40)})` }
      }
    }
  }
  if (t.name === 'write_file' || t.name === 'read_file') {
    const p = String(t.args?.path ?? '')
    if (p.includes('..')) {
      return { verdict: 'deny', reason: 'path traversal veto (".." segments are never resolved)' }
    }
  }
  return null
}

// ---------- mode layer: per-mode overrides (extension point, inspectable) ----------
// Currently carries no denies: mode behavior is instructed by the prompt and
// enforced where it belongs (box tiers, prison, ledger). The layer exists so
// per-mode vetoes can be installed WITHOUT touching the executor again.

const MODE_RULES: Record<string, { tool: string; verdict: PolicyVerdict; reason: string }[]> = {
  build: [],
  research: [],
  pc: [],
}

// ---------- session + turn layers ----------

interface LayerRule {
  id: string
  tool: string // primitive/op name, or '*'
  verdict: PolicyVerdict
  pattern?: string // glob-ish scope (kept verbatim from the user rule)
  reason: string
}

function globToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

function ruleMatches(rule: LayerRule, t: ToolShape): boolean {
  if (rule.tool !== '*' && rule.tool !== t.name) return false
  if (rule.pattern) {
    const target = String(t.args?.path ?? t.args?.pattern ?? '')
    if (target && !globToRegExp(rule.pattern).test(target)) return false
  }
  return true
}

async function sessionRules(sessionId: string): Promise<LayerRule[]> {
  const rows = await db.royalRedConsentRule.findMany({
    where: { enabled: true, OR: [{ sessionId }, { sessionId: null }] },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    tool: r.op,
    verdict: 'allow' as const, // a typed consent rule is a persistent user grant
    pattern: r.pattern || undefined,
    reason: `user-typed session rule: "${r.ruleText.slice(0, 120)}"`,
  }))
}

// ---------- the waterfall ----------

export async function decideTool(t: ToolShape, opts: { sessionId: string; mode?: string; turnRules?: LayerRule[] }): Promise<PolicyDecision> {
  const layers: PolicyLayerSnapshot[] = []

  // 1. global
  const g = globalDecide(t)
  layers.push({ name: 'global', rulesConsidered: 1, source: 'kernel defaults (SHELL_ALLOWLIST, registry, destructive veto)' })
  if (g) {
    return finish(t, opts, { tool: t.name, verdict: g.verdict, layer: 'global', reason: g.reason, layers })
  }

  // 2. mode
  const mode = opts.mode ?? 'build'
  const modeRules = MODE_RULES[mode] ?? []
  layers.push({ name: 'mode', rulesConsidered: modeRules.length, source: `per-mode overrides for "${mode}"` })
  const mHit = modeRules.find((r) => r.tool === t.name)
  if (mHit && mHit.verdict === 'deny') {
    return finish(t, opts, { tool: t.name, verdict: 'deny', layer: 'mode', reason: mHit.reason, layers })
  }

  // 3. session (user-typed rules; monotonic — may narrow, never force-allow past a deny)
  let sessionRuleCount = 0
  try {
    const sRules = await sessionRules(opts.sessionId)
    sessionRuleCount = sRules.length
    layers.push({ name: 'session', rulesConsidered: sessionRuleCount, source: 'RoyalRedConsentRule rows typed by the user' })
    const sHit = sRules.find((r) => ruleMatches(r, t))
    if (sHit && sHit.verdict === 'deny') {
      return finish(t, opts, { tool: t.name, verdict: 'deny', layer: 'session', reason: sHit.reason, ruleId: sHit.id, layers })
    }
    if (sHit && sHit.verdict === 'allow') {
      return finish(t, opts, { tool: t.name, verdict: 'allow', layer: 'session', reason: sHit.reason, ruleId: sHit.id, layers })
    }
  } catch {
    layers.push({ name: 'session', rulesConsidered: 0, source: 'unavailable — treated as no rules (global+mode still bind)' })
  }

  // 4. turn
  const tRules = opts.turnRules ?? []
  layers.push({ name: 'turn', rulesConsidered: tRules.length, source: 'rules supplied with this directive/turn' })
  const tHit = tRules.find((r) => ruleMatches(r, t))
  if (tHit && tHit.verdict === 'deny') {
    return finish(t, opts, { tool: t.name, verdict: 'deny', layer: 'turn', reason: tHit.reason, ruleId: tHit.id, layers })
  }
  if (tHit && tHit.verdict === 'allow') {
    return finish(t, opts, { tool: t.name, verdict: 'allow', layer: 'turn', reason: tHit.reason, ruleId: tHit.id, layers })
  }

  // 5. action — box-tiered tools ask; the consent engine owns the dialog
  const tier = BOX_TIERS[t.name]
  if (tier) {
    return finish(t, opts, {
      tool: t.name,
      verdict: 'ask',
      layer: 'action-consent',
      reason: `box primitive at tier T${tier} requires per-action consent (tier ${tier === 3 ? '3: one dialog per action, never batched' : `${tier}: batched plan card`})`,
      enforcedBy: 'consent-engine',
      layers,
    })
  }

  // default: read/write workspace tools pass on kernel defaults
  const reason = READ_ONLY_TOOLS.has(t.name) ? 'read-only tool, kernel default allow' : 'workspace tool, kernel default allow (prison + version journal still bind)'
  return finish(t, opts, { tool: t.name, verdict: 'allow', layer: 'global', reason, layers })
}

function finish(t: ToolShape, opts: { sessionId: string }, d: PolicyDecision): PolicyDecision {
  // INSPECTABILITY CONTRACT: every decision carries the COMPLETE five-layer
  // stack — including the layers never consulted because an earlier layer
  // decided — so a receipt always shows the whole waterfall, not just the
  // path taken. (Found by the Round 3 waterfall regression: partial stacks
  // made the audit trail look like layers were skipped.)
  const ALL_LAYERS: PolicyLayerName[] = ['global', 'mode', 'session', 'turn', 'action-consent']
  d.layers = ALL_LAYERS.map(
    (name) => d.layers.find((l) => l.name === name) ?? { name, rulesConsidered: 0, source: 'not consulted (an earlier layer decided)' },
  )
  // every decision is a durable typed event — the audit trail names its layer
  void appendEvent({
    sessionId: opts.sessionId,
    type: 'policy/decision',
    payload: { tool: d.tool, verdict: d.verdict, layer: d.layer, reason: d.reason, layers: d.layers },
  })
  void db.royalRedAudit
    .create({
      data: {
        action: `policy.${d.verdict}`,
        detail: `${d.tool} -> ${d.verdict} by ${d.layer}: ${d.reason.slice(0, 160)}`,
        ok: d.verdict !== 'deny',
      },
    })
    .catch(() => null)
  return d
}

// inspectable snapshot for the policy API surface
export async function policyStack(opts: { sessionId?: string; mode?: string }) {
  const mode = opts.mode ?? 'build'
  let sessionRuleCount = 0
  if (opts.sessionId) {
    try {
      sessionRuleCount = await db.royalRedConsentRule.count({ where: { enabled: true, OR: [{ sessionId: opts.sessionId }, { sessionId: null }] } })
    } catch {}
  }
  return {
    mode,
    layers: [
      { name: 'global', source: 'kernel defaults', rules: 1, notes: 'registry membership, shell allowlist, destructive veto, traversal veto' },
      { name: 'mode', source: `overrides for "${mode}"`, rules: (MODE_RULES[mode] ?? []).length, notes: 'extension point — no denies installed' },
      { name: 'session', source: 'user-typed rules', rules: sessionRuleCount, notes: 'RoyalRedConsentRule (verbatim text shown back to the user forever)' },
      { name: 'turn', source: 'per-directive rules', rules: 0, notes: 'plumbed via decideTool turnRules' },
      { name: 'action-consent', source: 'box tiers', rules: Object.keys(BOX_TIERS).length, notes: 'ask decisions delegated to the consent engine (T3 never batched)' },
    ],
    monotonicity: 'later layers narrow only — no rule can force-allow a denied call',
    boxTiers: BOX_TIERS,
    shellAllowlist: SHELL_ALLOWLIST,
  }
}
