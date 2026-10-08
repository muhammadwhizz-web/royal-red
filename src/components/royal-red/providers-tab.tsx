'use client'

// ROYAL RED PROVIDERS panel (Round 7 upgrade) — mission control for the
// 96-provider matrix. Shares the SAME data source as the Settings cockpit
// (/api/royal-red/providers), so an edit in one reflects in the other
// immediately. Live status refreshes every 60 seconds; rows show measured
// probe latency, the last error, and a quick ADD KEY path that opens the same
// edit dialog the Settings page uses. Keys NEVER leave the server.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog } from '@/components/ui/dialog'
import { Activity, Loader2, RefreshCw, Search } from 'lucide-react'
import { ProviderEditDialog, type MatrixProvider } from './settings-tab'
import { cn } from '@/lib/utils'

interface MatrixData {
  registryVersion: string
  counts: { providers: number; withAdapter: number; withCost: number; byModality: Record<string, number> }
  status: { connected: number; keyed: number; noKey: number; disabled: number; errors: number }
  providers: MatrixProvider[]
  health: Record<string, { state: string; latencyMs: number | null; detail?: string }>
  breaker: Record<string, { failures: number; openForMs: number }>
  ledger: { summary: { totalCostUsd: number; totalCalls: number; totalTokensIn: number; totalTokensOut: number } }
}

const MODALITY_COLORS: Record<string, string> = {
  chat: 'bg-red-500/15 text-red-700 dark:text-red-300',
  vision: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  image: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  search: 'bg-cyan-600/15 text-cyan-700 dark:text-cyan-300',
  embedding: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  audio: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  video: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  rerank: 'bg-lime-500/15 text-lime-700 dark:text-lime-300',
}

type RowStatus = 'connected' | 'key-set' | 'no-key' | 'error' | 'disabled' | 'local'

function rowStatus(p: MatrixProvider): RowStatus {
  if (p.disabled) return 'disabled'
  if (!p.requiresKey) {
    if (p.health === 'reachable') return 'connected'
    if (p.health === 'unreachable' || p.health === 'breaker-open') return 'error'
    return 'local'
  }
  if (!p.keyConfigured) return 'no-key'
  if (p.health === 'unreachable' || p.health === 'breaker-open') return 'error'
  if (p.health === 'reachable') return 'connected'
  return 'key-set'
}

const STATUS_BADGE: Record<RowStatus, string> = {
  connected: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'key-set': 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'no-key': 'border-border text-muted-foreground',
  error: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
  disabled: 'border-border bg-muted text-muted-foreground line-through',
  local: 'border-cyan-600/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function ProvidersTab() {
  const [data, setData] = useState<MatrixData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [keysOnly, setKeysOnly] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [liveTick, setLiveTick] = useState(0)

  const load = useCallback(async (probe: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/royal-red/providers${probe ? '?probe=1' : ''}`)
      setData((await res.json()) as MatrixData)
    } catch {
      // honest error surface, no fake data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  // live status: refresh every 60 seconds without a probe sweep
  useEffect(() => {
    const t = setInterval(() => {
      void load(false)
      setLiveTick((x) => x + 1)
    }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const testOne = async (id: string) => {
    setTestingId(id)
    try {
      await fetch(`/api/royal-red/providers/${id}/test`, { method: 'POST' })
      await load(false)
    } finally {
      setTestingId(null)
    }
  }

  const providers = (data?.providers ?? []).filter((p) => {
    if (filter !== 'all' && !p.modalities.includes(filter)) return false
    if (keysOnly && p.keyConfigured !== true && p.requiresKey) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!p.label.toLowerCase().includes(q) && !p.id.includes(q)) return false
    }
    return true
  })
  const editProvider = data?.providers.find((p) => p.id === editId) ?? null

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4 font-mono">
        {/* summary strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: 'PROVIDERS', value: data?.counts.providers ?? '—' },
            { label: 'ADAPTER READY', value: data ? `${data.counts.withAdapter}/${data.counts.providers}` : '—' },
            { label: 'KEYED', value: data ? `${data.status.keyed}/${data.counts.providers}` : '—' },
            { label: 'ERRORS', value: data?.status.errors ?? '—' },
            { label: 'LEDGER SPEND', value: data ? `$${data.ledger.summary.totalCostUsd.toFixed(4)}` : '—' },
          ].map((s) => (
            <div key={s.label} className="rounded border border-red-500/20 bg-red-500/5 p-2">
              <div className="text-[10px] tracking-widest text-muted-foreground">{s.label}</div>
              <div className="text-lg font-semibold text-red-700 dark:text-red-300">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 font-mono text-[11px]" disabled={loading} onClick={() => void load(true)}>
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />} TEST ALL
          </Button>
          <div className="relative min-w-36 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter by name..." aria-label="Filter providers by name" className="h-7 bg-card pl-7 text-[11px]" />
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Switch checked={keysOnly} onCheckedChange={setKeysOnly} aria-label="Show only providers I have keys for" /> keys only
          </label>
          {['all', ...Object.keys(data?.counts.byModality ?? {})].map((m) => (
            <button
              key={m}
              onClick={() => setFilter(m)}
              className={`rounded px-2 py-0.5 text-[10px] tracking-wider uppercase transition-colors ${filter === m ? 'bg-red-500/20 text-red-700 dark:text-red-300' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {m}
            </button>
          ))}
          <span className="ml-auto hidden text-[9px] text-muted-foreground lg:inline" title="status auto-refreshes every 60 seconds">
            live / 60s{liveTick > 0 ? ` / tick ${liveTick}` : ''}
          </span>
        </div>

        {/* provider table */}
        <div className="max-h-[26rem] overflow-y-auto rounded border">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted/60 text-left text-[10px] tracking-widest text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-2 py-1.5">PROVIDER</th>
                <th className="px-2 py-1.5">MODALITIES</th>
                <th className="hidden px-2 py-1.5 sm:table-cell">COST (per 1M / unit)</th>
                <th className="px-2 py-1.5">STATUS</th>
                <th className="hidden px-2 py-1.5 md:table-cell">LAST SUCCESS</th>
                <th className="px-2 py-1.5 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const st = rowStatus(p)
                const probe = data?.health?.[p.id]
                return (
                  <tr key={p.id} className="border-t transition-colors hover:bg-red-500/5">
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{p.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.id} · {p.protocol === 'none' ? 'adapter pending (fail closed)' : p.protocol}
                        {p.local ? ' · LOCAL' : ''}
                      </div>
                      {p.lastError && (
                        <div className="max-w-52 truncate text-[9px] text-red-600 dark:text-red-400" title={p.lastError}>
                          {p.lastError}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {p.modalities.map((m) => (
                          <span key={m} className={`rounded px-1 py-0.5 text-[9px] ${MODALITY_COLORS[m] ?? 'bg-muted'}`}>{m}</span>
                        ))}
                      </div>
                    </td>
                    <td className="hidden px-2 py-1.5 text-muted-foreground sm:table-cell">
                      {p.cost.chatIn !== undefined ? `$${p.cost.chatIn}/$${p.cost.chatOut ?? 0}` : ''}
                      {p.cost.image !== undefined ? `$${p.cost.image}/img` : ''}
                      {p.cost.search !== undefined ? `$${p.cost.search}/call` : ''}
                      {p.cost.embedding !== undefined ? `$${p.cost.embedding}/1M` : ''}
                      {p.cost.audio !== undefined ? `$${p.cost.audio}/1k` : ''}
                      {p.cost.video !== undefined ? `$${p.cost.video}/s` : ''}
                      {Object.keys(p.cost).length === 0 ? <span className="text-amber-600">unknown</span> : <span className="ml-1 text-[9px]">{p.priceNote}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[9px] tracking-wider', STATUS_BADGE[st])}>
                        {st === 'connected' && probe?.latencyMs ? `connected ${probe.latencyMs}ms` : st}
                      </span>
                    </td>
                    <td className="hidden px-2 py-1.5 text-[10px] text-muted-foreground md:table-cell">{relTime(p.lastSuccessAt)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        {p.requiresKey && !p.keyConfigured && (
                          <Button size="sm" className="h-6 bg-red-600 px-2 text-[9px] text-white hover:bg-red-700" onClick={() => setEditId(p.id)}>
                            ADD KEY
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[9px]" onClick={() => setEditId(p.id)}>
                          EDIT
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[9px]" disabled={testingId === p.id} onClick={() => void testOne(p.id)}>
                          {testingId === p.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'TEST'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {data ? `${data.counts.providers} providers, ${data.status.keyed} keyed, ${data.status.noKey} awaiting keys.` : 'loading the matrix...'}{' '}
          Keys are stored AES-256-GCM encrypted at rest and are never returned by any API — only masked status. Health is measured, not guessed.
          Providers without an execution adapter can never be routed to (fail closed). EDIT opens the same dialog as the SETTINGS tab: one data source, two views.
        </p>

        {editProvider && (
          <Dialog open onOpenChange={(v) => { if (!v) setEditId(null) }}>
            <ProviderEditDialog provider={editProvider} onClose={() => setEditId(null)} onSaved={() => { void load(false) }} />
          </Dialog>
        )}
      </div>
    </ScrollArea>
  )
}
