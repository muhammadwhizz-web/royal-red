'use client'

// ROYAL RED AGENTS panel (Round 6, Section 3.4). The 66 agent employees as a
// roster: name, role, bound provider, live status, current task, last actions.
// The user can reassign a role's provider or disable a role; both persist as
// audited roster overrides. Data comes from /api/royal-red/agents.

import { useCallback, useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { RefreshCw, Users, Crown, Ban, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'

type AgentStatus = 'idle' | 'running' | 'done' | 'aborted' | 'disabled'

interface AgentRow {
  name: string
  role: string
  category: string
  provider: string
  model?: string
  budgetUsd: number
  capabilities: string[]
  disabled: boolean
  status: AgentStatus
  currentTask: string | null
  runCount: number
  lastRunAt: string | null
  lastActions: { action: string; detail: string; ok: boolean; at: string }[]
}

interface AgentsResponse {
  ceiling: number
  live: number
  stats: { total: number; byCategory: Record<string, number>; byProvider: Record<string, number> }
  roster: AgentRow[]
}

const CATEGORY_LABEL: Record<string, string> = {
  planning: 'planning & orchestration',
  building: 'building',
  critique: 'critique & verification',
  research: 'research',
  writing: 'writing & content',
  data: 'data & analysis',
  operations: 'operations',
  browser: 'browser hands',
  desktop: 'desktop hands',
  memory: 'memory & state',
  communication: 'communication',
  specialist: 'specialist',
}

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-stone-500/50',
  running: 'bg-emerald-500 animate-pulse',
  done: 'bg-red-600',
  aborted: 'bg-amber-500',
  disabled: 'bg-stone-700',
}

// the provider options a role can be reassigned to (chat-capable, common keys)
const PROVIDER_CHOICES = ['royalred-builtin', 'openai', 'anthropic', 'google', 'mistral', 'groq']

export function AgentsTab() {
  const [data, setData] = useState<AgentsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/royal-red/agents')
      const json = (await res.json()) as AgentsResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'roster load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patchRole = async (name: string, body: { provider?: string; disabled?: boolean }) => {
    await fetch('/api/royal-red/agents', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, ...body }),
    })
    void load()
  }

  const grouped = new Map<string, AgentRow[]>()
  for (const r of data?.roster ?? []) {
    const list = grouped.get(r.category) ?? []
    list.push(r)
    grouped.set(r.category, list)
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3 font-mono">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />
            <span className="tabular-nums">
              {data ? `${data.stats.total} roles · ${data.live} in service · ceiling ${data.ceiling}` : 'assembling court...'}
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} aria-label="Reload roster">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        {error && <div className="rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}

        {/* the sovereign note */}
        <div className="glass flex items-center gap-2 rounded-2xl p-3 text-[10px] text-muted-foreground">
          <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
          <span>
            roles are virtualized: instantiated on demand, max 4 concurrent. every action carries the role name in the audit log and the event log.
          </span>
        </div>

        {(['planning', 'building', 'critique', 'research', 'writing', 'data', 'operations', 'browser', 'desktop', 'memory', 'communication', 'specialist'] as const).map((cat) => {
          const list = grouped.get(cat)
          if (!list?.length) return null
          return (
            <div key={cat} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{CATEGORY_LABEL[cat]}</span>
                <span className="h-px flex-1 bg-border/40" />
                <span className="text-[10px] tabular-nums text-muted-foreground/60">{list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {list.map((r) => (
                  <div key={r.name} className="glass rounded-xl p-2.5">
                    <button
                      className="flex w-full items-center justify-between gap-2 text-left"
                      onClick={() => setExpanded(expanded === r.name ? null : r.name)}
                      aria-expanded={expanded === r.name}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[r.status])} aria-hidden />
                        <span className={cn('truncate text-[11px] font-semibold', r.disabled ? 'text-muted-foreground line-through' : 'text-foreground/90')}>{r.name}</span>
                      </span>
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/70">{r.provider}</span>
                    </button>
                    <div className="mt-0.5 flex items-center justify-between text-[9px] text-muted-foreground/60">
                      <span>{r.role} · {r.runCount} run{r.runCount === 1 ? '' : 's'}</span>
                      <span className="tabular-nums">{r.budgetUsd ? `$${r.budgetUsd.toFixed(2)} cap` : 'kernel role'}</span>
                    </div>
                    {expanded === r.name && (
                      <div className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
                        <div className="flex flex-wrap gap-1">
                          {r.capabilities.map((c) => (
                            <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{c}</span>
                          ))}
                        </div>
                        {r.lastActions.length > 0 && (
                          <div className="space-y-0.5">
                            {r.lastActions.slice(0, 3).map((a, i) => (
                              <div key={i} className="truncate text-[9px] text-muted-foreground/70">
                                <span className={a.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{a.action}</span> {a.detail?.slice(0, 70)}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <Repeat className="h-3 w-3 text-muted-foreground" aria-hidden />
                          <select
                            className="h-6 rounded-md border border-border/60 bg-background/70 px-1 font-mono text-[10px]"
                            value={r.provider}
                            onChange={(e) => void patchRole(r.name, { provider: e.target.value })}
                            aria-label={`Reassign provider for ${r.name}`}
                          >
                            {PROVIDER_CHOICES.map((pid) => (
                              <option key={pid} value={pid}>{pid}</option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn('h-6 gap-1 rounded-full px-2 text-[9px]', r.disabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500/80')}
                            onClick={() => void patchRole(r.name, { disabled: !r.disabled })}
                          >
                            <Ban className="h-3 w-3" aria-hidden />
                            {r.disabled ? 'enable' : 'disable'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
