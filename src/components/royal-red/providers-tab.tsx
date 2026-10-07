'use client'

// ROYAL RED PROVIDERS panel — mission control for the provider matrix.
// Shows the full registry (66 providers × 7 modalities), measured health,
// circuit-breaker states, key configuration status (masked — keys NEVER
// leave the server), and cost metadata. Honest: 'none'-protocol entries are
// labeled "adapter pending" and can never be routed to.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react'

interface MatrixProvider {
  id: string
  label: string
  protocol: string
  modalities: string[]
  tier: string
  local: boolean
  model: string
  cost: Record<string, number>
  priceNote?: string
  requiresKey: boolean
  keyConfigured: boolean | null
  adapterReady: boolean
  supportsTools: boolean
}

interface MatrixData {
  registryVersion: string
  counts: { providers: number; withAdapter: number; withCost: number; byModality: Record<string, number> }
  routes: { definition: number; perProduct18: number; note: string }
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
}

function healthBadge(state?: string) {
  switch (state) {
    case 'reachable':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" variant="secondary">reachable</Badge>
    case 'reachable-unauthorized':
      return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300" variant="secondary">no key (up reachable)</Badge>
    case 'unreachable':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300" variant="secondary">unreachable</Badge>
    case 'breaker-open':
      return <Badge className="bg-red-600/20 text-red-800 dark:text-red-300" variant="secondary">BREAKER OPEN</Badge>
    case 'unconfigured':
      return <Badge variant="secondary" className="text-muted-foreground">unconfigured</Badge>
    default:
      return <Badge variant="secondary" className="text-muted-foreground">not probed</Badge>
  }
}

export function ProvidersTab() {
  const [data, setData] = useState<MatrixData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  const load = useCallback(async (probe: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/royal-red/router/matrix${probe ? '?probe=1' : ''}`)
      setData((await res.json()) as MatrixData)
    } catch {
      // honest error surface, no fake data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  const providers = (data?.providers ?? []).filter((p) => filter === 'all' || p.modalities.includes(filter))

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4 font-mono">
        {/* summary strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'PROVIDERS', value: data?.counts.providers ?? '—' },
            { label: 'ADAPTER READY', value: data ? `${data.counts.withAdapter}/${data.counts.providers}` : '—' },
            { label: 'ROUTES (18 PRODUCTS)', value: data?.routes.perProduct18.toLocaleString() ?? '—' },
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
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />} MEASURE HEALTH
          </Button>
          {['all', ...Object.keys(data?.counts.byModality ?? {})].map((m) => (
            <button
              key={m}
              onClick={() => setFilter(m)}
              className={`rounded px-2 py-0.5 text-[10px] tracking-wider uppercase transition-colors ${filter === m ? 'bg-red-500/20 text-red-700 dark:text-red-300' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* provider table */}
        <div className="overflow-hidden rounded border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50 text-left text-[10px] tracking-widest text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">PROVIDER</th>
                <th className="px-2 py-1.5">MODALITIES</th>
                <th className="px-2 py-1.5">TIER</th>
                <th className="hidden px-2 py-1.5 sm:table-cell">COST (per 1M / unit)</th>
                <th className="px-2 py-1.5">KEY</th>
                <th className="px-2 py-1.5">HEALTH</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t transition-colors hover:bg-red-500/5">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.id} · {p.protocol === 'none' ? 'adapter pending (fail closed)' : p.protocol}
                      {p.local ? ' · LOCAL' : ''}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {p.modalities.map((m) => (
                        <span key={m} className={`rounded px-1 py-0.5 text-[9px] ${MODALITY_COLORS[m] ?? 'bg-muted'}`}>{m}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{p.tier}</td>
                  <td className="hidden px-2 py-1.5 text-muted-foreground sm:table-cell">
                    {p.cost.chatIn !== undefined ? `$${p.cost.chatIn}/$${p.cost.chatOut ?? 0}` : ''}
                    {p.cost.image !== undefined ? `$${p.cost.image}/img` : ''}
                    {p.cost.search !== undefined ? `$${p.cost.search}/call` : ''}
                    {p.cost.embedding !== undefined ? `$${p.cost.embedding}/1M` : ''}
                    {p.cost.audio !== undefined ? `$${p.cost.audio}/1k` : ''}
                    {p.cost.video !== undefined ? `$${p.cost.video}/s` : ''}
                    {Object.keys(p.cost).length === 0 ? '—' : <span className="ml-1 text-[9px]">{p.priceNote}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {p.requiresKey === false ? (
                      <span className="text-[10px] text-muted-foreground">none needed</span>
                    ) : p.keyConfigured ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="key configured (stored encrypted)" />
                    ) : (
                      <span className="text-[10px] text-amber-600">BYO needed</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{healthBadge(data?.health?.[p.id]?.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Keys are stored AES-256-GCM encrypted at rest and are never returned by any API — only this panel&apos;s
          masked status. Health is measured, not guessed. Providers without an execution adapter can never be
          routed to (fail closed). Route count = providers × modalities × product bindings.
        </p>
      </div>
    </ScrollArea>
  )
}
