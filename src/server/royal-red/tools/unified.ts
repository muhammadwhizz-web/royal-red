// ROYAL RED unified tool execution layer (Round 7, closing directive section 5).
//
// EVERY tool, regardless of origin, flows through here: native tools (search,
// box, screen, image...), connector tools (github_list_repos...), MCP tools
// (mcp_<server>_<tool>) and skill tools (skill_<skill>_<tool>). One registry,
// one consent gate, one audit trail, one rate limiter, one error shape.
//
// Consent tiers (mirroring the desktop consent law):
//   read-only    → auto-approved inside a session, batchable, still audited
//   write        → executed, audited, rate-limited per source
//   destructive  → per-action consent ONLY: the request must carry
//                  confirm: true from an explicit user action

import { db } from '@/lib/db'
import { toolsForConnector, connectorHealth } from '../connectors/tools'
import { CONNECTOR_CATALOG } from '../connectors/catalog'
import { callTool as mcpCallTool, readResource as mcpReadResource, getPrompt as mcpGetPrompt } from '../mcp/client'
import { runTool } from '../tools'
import type { ToolRequest } from '@/lib/royal-red/types'

export type ToolSource = 'native' | 'connector' | 'mcp' | 'skill'
export type PermissionTier = 'read-only' | 'write' | 'destructive'

export interface UnifiedTool {
  name: string
  description: string
  source: ToolSource
  sourceId: string // connectorId, mcp server slug, skill slug, or 'native'
  permission: PermissionTier
  schema?: unknown
}

interface RegistryEntry extends UnifiedTool {
  mcpServerRowId?: string
}

const NATIVE_TIERS: Record<string, PermissionTier> = {
  web_search: 'read-only',
  read_file: 'read-only',
  list_files: 'read-only',
  system_report: 'read-only',
  list_accounts: 'read-only',
  analyze_image: 'read-only',
  analyze_video: 'read-only',
  read_page: 'read-only',
  screen_shot: 'read-only',
  box_list: 'read-only',
  box_read: 'read-only',
  box_plan: 'read-only',
  generate_image: 'write',
  write_file: 'write',
  create_account: 'write',
  box_write: 'write',
  box_mkdir: 'write',
  box_move: 'write',
  box_copy: 'write',
  box_undo: 'write',
  screen_click: 'write',
  screen_type: 'write',
  shell: 'destructive',
  shell_exec: 'destructive',
  remove_account: 'destructive',
  box_trash: 'destructive',
}

const NATIVE_NAMES: Record<string, string> = {
  web_search: 'search the web',
  read_page: 'read a web page',
  generate_image: 'generate an image',
  analyze_image: 'analyze an image',
  analyze_video: 'analyze a video',
  shell: 'run a shell command',
  system_report: 'report system status',
}

// ---------------- rate limiting (per source, token bucket) ----------------

const RATE_BUCKETS = new Map<string, { tokens: number; updatedAt: number }>()
const RATE_PER_MIN = 30

function rateLimitOk(key: string): boolean {
  const now = Date.now()
  const b = RATE_BUCKETS.get(key) ?? { tokens: RATE_PER_MIN, updatedAt: now }
  b.tokens = Math.min(RATE_PER_MIN, b.tokens + ((now - b.updatedAt) / 60_000) * RATE_PER_MIN)
  b.updatedAt = now
  if (b.tokens < 1) {
    RATE_BUCKETS.set(key, b)
    return false
  }
  b.tokens -= 1
  RATE_BUCKETS.set(key, b)
  return true
}

// ---------------- registry ----------------

export async function unifiedRegistry(): Promise<UnifiedTool[]> {
  const out: UnifiedTool[] = []

  // native: the runTool surface
  for (const [name, tier] of Object.entries(NATIVE_TIERS)) {
    out.push({
      name,
      description: `native: ${NATIVE_NAMES[name] ?? 'Royal Red native tool'}`,
      source: 'native',
      sourceId: 'native',
      permission: tier,
    })
  }

  // connectors: built ones expose their tools
  for (const c of CONNECTOR_CATALOG) {
    for (const t of toolsForConnector(c.id)) {
      out.push({ name: t.name, description: t.description, source: 'connector', sourceId: c.id, permission: t.permission, schema: t.schema })
    }
  }

  // mcp servers: tools persisted from the last successful connect
  try {
    const servers = await db.royalRedMcpServer.findMany({ where: { enabled: true } })
    for (const s of servers) {
      const tools = s.toolsJson ? (JSON.parse(s.toolsJson) as Array<{ name: string; description?: string }>) : []
      for (const t of tools) {
        out.push({
          name: `mcp_${s.name}_${t.name}`,
          description: t.description ?? `MCP tool ${t.name} on server ${s.name}`,
          source: 'mcp',
          sourceId: s.name,
          permission: classifyMcpTool(t.name),
        })
      }
    }
  } catch { /* DB unavailable: registry still lists native + connectors */ }

  // skills: declared tools from installed, enabled skills
  try {
    const skills = await db.royalRedSkill.findMany({ where: { enabled: true } })
    for (const s of skills) {
      const tools = s.toolsJson ? (JSON.parse(s.toolsJson) as Array<{ name: string; description?: string; permission?: string }>) : []
      for (const t of tools) {
        out.push({
          name: `skill_${s.skillId}_${t.name}`,
          description: t.description ?? `skill tool ${t.name}`,
          source: 'skill',
          sourceId: s.skillId,
          permission: (t.permission as PermissionTier) === 'write' ? 'write' : 'read-only',
        })
      }
    }
  } catch { /* same honest degrade */ }

  return out
}

// MCP tool classification by name convention (the protocol does not carry a
// permission tier, so names drive it, mirroring connector conventions)
function classifyMcpTool(name: string): PermissionTier {
  const n = name.toLowerCase()
  if (/(delete|drop|remove|unlink|rm_|kill|format)/.test(n)) return 'destructive'
  if (/(write|create|post|put|send|update|insert|move|edit|patch)/.test(n)) return 'write'
  return 'read-only'
}

// ---------------- execution ----------------

export interface UnifiedCall {
  source: ToolSource
  sourceId: string
  tool: string // bare tool name (connector tool name, mcp bare tool name, native name)
  args: Record<string, unknown>
  confirm?: boolean // per-action consent for destructive tier
  actor?: string
}

export interface UnifiedCallResult {
  ok: boolean
  summary: string
  data?: unknown
  latencyMs: number
  audited: boolean
  error?: string
  retryable: boolean
  suggestion?: string
}

const RETRYABLE = /(timeout|temporarily|429|rate.?limit|5\d\d|ECONNRESET|ECONNREFUSED)/i

export async function executeUnified(call: UnifiedCall): Promise<UnifiedCallResult> {
  const started = Date.now()
  const fail = (error: string, extra?: Partial<UnifiedCallResult>): UnifiedCallResult => ({
    ok: false, summary: '', latencyMs: Date.now() - started, audited: false, retryable: RETRYABLE.test(error),
    error, suggestion: RETRYABLE.test(error) ? 'retry: the failure looks transient' : 'check the tool arguments and the source configuration',
    ...extra,
  })

  // ---- consent gate (BEFORE any execution)
  const registry = await unifiedRegistry()
  const entry: RegistryEntry | undefined = registry.find((t) => t.source === call.source && t.sourceId === call.sourceId && (t.name === call.tool || t.name.endsWith(`_${call.tool}`)))
  const tier: PermissionTier = entry?.permission ?? (call.source === 'connector' ? 'write' : 'read-only')

  if (tier === 'destructive' && call.confirm !== true) {
    await auditToolCall(call, tier, 'rejected: destructive tool needs per-action consent (confirm: true)', 0)
    return fail('destructive tool: this call needs per-action consent. Re-send with confirm true after explicit user approval.')
  }
  if (!rateLimitOk(`${call.source}:${call.sourceId}`)) {
    await auditToolCall(call, tier, 'rejected: rate limit hit for source', 0)
    return fail(`rate limit hit for ${call.source}:${call.sourceId} (30 calls per minute cap)`, { suggestion: 'wait a moment and retry' })
  }

  // ---- route to the source executor
  try {
    if (call.source === 'native') {
      const req = { name: call.tool, args: call.args } as unknown as ToolRequest
      const out = await runTool(req, { sessionId: call.actor ?? 'settings' })
      const res: UnifiedCallResult = { ok: out.ok, summary: out.summary, data: out.detail, latencyMs: Date.now() - started, audited: true, retryable: RETRYABLE.test(out.summary) }
      await auditToolCall(call, tier, out.summary.slice(0, 300), res.latencyMs)
      return res
    }

    if (call.source === 'connector') {
      const row = await db.royalRedConnector.findUnique({ where: { connectorId: call.sourceId } })
      if (!row?.credEnc) return fail('connector is not connected: add the credential in Settings first')
      const { decryptSecret } = await import('../verify/crypto')
      const cred = decryptSecret(row.credEnc) ?? ''
      const config = row.configJson ? (JSON.parse(row.configJson) as Record<string, string>) : {}
      const tool = toolsForConnector(call.sourceId).find((t) => t.name === call.tool)
      if (!tool) return fail(`connector ${call.sourceId} does not expose tool ${call.tool}`)
      const out = await tool.run(cred, config, call.args)
      await db.royalRedConnector.update({ where: { connectorId: call.sourceId }, data: { lastUsedAt: new Date() } }).catch(() => {})
      const res: UnifiedCallResult = { ok: out.ok, summary: out.summary, data: out.data, latencyMs: Date.now() - started, audited: true, error: out.error, retryable: RETRYABLE.test(out.error ?? '') }
      await auditToolCall(call, tier, (out.error ?? out.summary).slice(0, 300), res.latencyMs)
      return res
    }

    if (call.source === 'mcp') {
      const server = await db.royalRedMcpServer.findFirst({ where: { OR: [{ name: call.sourceId }, { id: call.sourceId }] } })
      if (!server) return fail('MCP server not found in Settings')
      if (!server.enabled) return fail('MCP server is disabled: enable it in Settings')
      const { decryptSecret } = await import('../verify/crypto')
      const token = server.tokenEnc ? decryptSecret(server.tokenEnc) ?? undefined : undefined
      const spec = {
        type: server.type as 'stdio' | 'http' | 'ws',
        command: server.command ?? undefined,
        args: server.argsJson ? (JSON.parse(server.argsJson) as string[]) : undefined,
        env: server.envJson ? (JSON.parse(server.envJson) as Record<string, string>) : undefined,
        url: server.url ?? undefined,
        token,
      }
      if (call.tool.startsWith('resource:')) {
        const out = await mcpReadResource(spec, call.tool.slice('resource:'.length))
        await auditToolCall(call, tier, out.ok ? 'resource read ok' : (out.error ?? 'resource read failed'), out.latencyMs)
        return { ok: out.ok, summary: 'resource read', data: out.contents, latencyMs: out.latencyMs, audited: true, error: out.error, retryable: RETRYABLE.test(out.error ?? '') }
      }
      if (call.tool.startsWith('prompt:')) {
        const out = await mcpGetPrompt(spec, call.tool.slice('prompt:'.length))
        await auditToolCall(call, tier, out.ok ? 'prompt fetched' : (out.error ?? 'prompt fetch failed'), out.latencyMs)
        return { ok: out.ok, summary: 'prompt fetched', data: out.messages, latencyMs: out.latencyMs, audited: true, error: out.error, retryable: RETRYABLE.test(out.error ?? '') }
      }
      const out = await mcpCallTool(spec, call.tool, call.args)
      await db.royalRedMcpServer.update({ where: { id: server.id }, data: { lastConnectedAt: new Date() } }).catch(() => {})
      await auditToolCall(call, tier, out.ok ? 'mcp tool call ok' : (out.error ?? 'mcp tool call failed'), out.latencyMs)
      return { ok: out.ok, summary: out.ok ? 'mcp tool call completed' : '', data: out.result, latencyMs: out.latencyMs, audited: true, error: out.error, retryable: RETRYABLE.test(out.error ?? '') }
    }

    if (call.source === 'skill') {
      // skill tools declared by catalog skills are instruction-driven: the
      // agent consumes the skill instructions; direct calls surface the
      // declared tool guidance honestly
      const skill = await db.royalRedSkill.findUnique({ where: { skillId: call.sourceId } })
      if (!skill) return fail('skill not installed')
      if (!skill.enabled) return fail('skill is disabled: enable it in Settings')
      const tools = skill.toolsJson ? (JSON.parse(skill.toolsJson) as Array<{ name: string; description?: string }>) : []
      const t = tools.find((x) => x.name === call.tool)
      if (!t) return fail(`skill ${call.sourceId} does not declare tool ${call.tool}`)
      const res: UnifiedCallResult = { ok: true, summary: `skill guidance: ${t.description ?? call.tool}`, data: { skill: skill.skillId, tool: t.name, description: t.description }, latencyMs: Date.now() - started, audited: true, retryable: false }
      await auditToolCall(call, tier, res.summary, res.latencyMs)
      return res
    }

    return fail(`unknown tool source ${call.source}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await auditToolCall(call, tier, `error: ${msg.slice(0, 250)}`, Date.now() - started)
    return fail(msg)
  }
}

async function auditToolCall(call: UnifiedCall, tier: PermissionTier, result: string, latencyMs: number) {
  await db.royalRedAudit.create({
    data: {
      action: 'tool.call',
      detail: JSON.stringify({ tool: call.tool, source: `${call.source}:${call.sourceId}`, tier, result, latencyMs }),
      ok: true,
      agentRole: call.actor ?? 'Settings',
    },
  }).catch(() => {})
}

// health re-export so the connectors test endpoint and the unified layer agree
export { connectorHealth }
