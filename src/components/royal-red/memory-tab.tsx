'use client'

// ROYAL RED MEMORY panel (Round 6, Section 2.4). Shows every memory by scope.
// The user can view, add, edit, delete, promote (session -> project -> global),
// demote, tag, expire, search, and export as JSON. All mutations hit
// /api/royal-red/memory and are audit-logged by the kernel as the
// Memory Keeper role.

import { useCallback, useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Brain, Plus, Search, Trash2, Pencil, ChevronUp, ChevronDown, Download, RefreshCw, KeyRound,
} from 'lucide-react'
import { useRoyalRed } from './store'
import { cn } from '@/lib/utils'

interface MemoryRow {
  id: string
  scope: 'global' | 'project' | 'session' | 'agent'
  scopeRef: string
  key: string
  value: string
  source: string
  confidence: number
  tags: string[]
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  foreign: boolean
}

const SCOPES = ['all', 'global', 'project', 'session', 'agent'] as const

const SCOPE_BADGE: Record<string, string> = {
  global: 'bg-red-900/25 text-red-300 border-red-700/40',
  project: 'bg-amber-900/20 text-amber-300 border-amber-700/40',
  session: 'bg-stone-800/60 text-stone-300 border-stone-600/40',
  agent: 'bg-emerald-900/20 text-emerald-300 border-emerald-700/40',
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MemoryTab() {
  const sessionId = useRoyalRed((s) => s.sessionId)
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [scopeFilter, setScopeFilter] = useState<(typeof SCOPES)[number]>('all')
  const [editing, setEditing] = useState<MemoryRow | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/royal-red/memory?sessionId=${encodeURIComponent(sessionId ?? '')}`)
      const data = (await res.json()) as { memories: MemoryRow[] }
      setRows(data.memories ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'memory list failed')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!draftKey.trim() || !draftValue.trim()) return
    setError(null)
    const body = editing
      ? { key: draftKey.trim(), value: draftValue.trim(), tags: draftTags }
      : { scope: 'global', key: draftKey.trim(), value: draftValue.trim(), tags: draftTags, source: 'user' }
    const res = await fetch(editing ? `/api/royal-red/memory/${editing.id}` : '/api/royal-red/memory', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? 'save failed')
      return
    }
    setCreating(false)
    setEditing(null)
    setDraftKey('')
    setDraftValue('')
    setDraftTags('')
    void load()
  }

  const forget = async (id: string) => {
    await fetch(`/api/royal-red/memory/${id}`, { method: 'DELETE' })
    void load()
  }

  const move = async (m: MemoryRow, dir: 'promote' | 'demote') => {
    await fetch(`/api/royal-red/memory/${m.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [dir]: true }),
    })
    void load()
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'royal-red-memory.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const visible = rows.filter(
    (r) => (scopeFilter === 'all' || r.scope === scopeFilter) && (!q || `${r.key} ${r.value} ${r.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
  )
  const byScope = {
    global: rows.filter((r) => r.scope === 'global').length,
    project: rows.filter((r) => r.scope === 'project').length,
    session: rows.filter((r) => r.scope === 'session').length,
    agent: rows.filter((r) => r.scope === 'agent').length,
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3 font-mono">
        {/* header stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] tracking-wider text-muted-foreground">
            <Brain className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />
            <span className="tabular-nums">
              {rows.length} memories · global {byScope.global} · project {byScope.project} · session {byScope.session} · agent {byScope.agent}
            </span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} aria-label="Reload memories">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={exportJson} aria-label="Export memory as JSON">
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="btn-glossy h-7 rounded-full px-3 text-[11px]"
              onClick={() => {
                setEditing(null)
                setDraftKey('')
                setDraftValue('')
                setDraftTags('')
                setCreating(true)
              }}
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden /> REMEMBER
            </Button>
          </div>
        </div>

        {/* search + scope filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[140px] flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search memory"
              className="h-8 rounded-xl border-border/60 bg-background/60 pl-7 font-mono text-xs"
              aria-label="Search memories"
            />
          </div>
          <div className="seg flex gap-1 rounded-full p-0.5">
            {SCOPES.map((s) => (
              <button
                key={s}
                onClick={() => setScopeFilter(s)}
                className={cn(
                  'seg-item rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
                  scopeFilter === s && 'data-[state=active]',
                  scopeFilter === s ? 'bg-background text-red-700 shadow-sm dark:text-red-300' : 'text-muted-foreground',
                )}
                aria-pressed={scopeFilter === s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}

        {/* create / edit form */}
        {(creating || editing) && (
          <div className="glass space-y-2 rounded-2xl p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <KeyRound className="h-3 w-3" aria-hidden />
              {editing ? `edit memory ${editing.id.slice(0, 8)}` : 'new memory (global scope)'}
            </div>
            <Input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="key, e.g. theme preference"
              className="h-8 rounded-xl border-border/60 bg-background/60 font-mono text-xs"
              aria-label="Memory key"
            />
            <textarea
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="the memory itself, plain English"
              rows={2}
              className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-red-700/40"
              aria-label="Memory value"
            />
            <Input
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              placeholder="tags, comma separated (optional)"
              className="h-8 rounded-xl border-border/60 bg-background/60 font-mono text-xs"
              aria-label="Memory tags"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-3 text-[11px]"
                onClick={() => {
                  setCreating(false)
                  setEditing(null)
                }}
              >
                cancel
              </Button>
              <Button size="sm" className="btn-glossy h-7 rounded-full px-4 text-[11px]" onClick={() => void save()} disabled={!draftKey.trim() || !draftValue.trim()}>
                {editing ? 'SAVE EDIT' : 'SEAL IT'}
              </Button>
            </div>
          </div>
        )}

        {/* memory rows */}
        <div className="space-y-2">
          {visible.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-border/50 p-6 text-center text-xs text-muted-foreground">
              no memories in this view. Say &quot;remember that ...&quot; in the console, or press REMEMBER.
            </div>
          )}
          {visible.map((m) => (
            <div key={m.id} className="glass group rounded-2xl p-3 transition-shadow hover:shadow-[0_0_0_1px_rgba(185,28,28,0.25)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-widest', SCOPE_BADGE[m.scope])}>{m.scope}</span>
                    <span className="truncate text-[11px] font-semibold tracking-wide text-foreground/90">{m.key}</span>
                    <span className="text-[9px] text-muted-foreground/70">source {m.source} · conf {m.confidence.toFixed(2)}</span>
                    {m.foreign && <span className="text-[9px] text-amber-500/80">other session</span>}
                  </div>
                  <div className="mt-1 break-words text-xs text-foreground/85">{m.value}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground/60">
                    <span className="tabular-nums">{fmtDate(m.updatedAt)}</span>
                    {m.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1 py-0.5 text-[9px]">#{t}</span>
                    ))}
                    {m.expiresAt && <span className="text-amber-500/70">expires {fmtDate(m.expiresAt)}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void move(m, 'promote')} aria-label={`Promote ${m.key}`} title="promote scope">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void move(m, 'demote')} aria-label={`Demote ${m.key}`} title="demote scope">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setEditing(m)
                      setDraftKey(m.key)
                      setDraftValue(m.value)
                      setDraftTags(m.tags.join(', '))
                      setCreating(false)
                    }}
                    aria-label={`Edit ${m.key}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500/80 hover:text-red-500" onClick={() => void forget(m.id)} aria-label={`Forget ${m.key}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pb-2 text-center text-[9px] text-muted-foreground/50">
          memories never leave this machine. no cloud sync exists. export is the only way out.
        </div>
      </div>
    </ScrollArea>
  )
}
