'use client'

// ROYAL RED ROUTER panel — live view of the cost-aware routing brain.
// Left: a dry-run playground (what would this cost? who wins? who is blocked
// and why?). Right: the cost ledger tail — every real call with provider,
// tokens, cost, latency, outcome. Rotation events are shown verbatim.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Route, Play, SwitchCamera } from 'lucide-react'

interface Candidate {
  providerId: string
  model: string
  estimatedCostUsd: number
  tier: string
  local: boolean
  reason: string
  blocked?: string
}

interface DecideResponse {
  dryRun: boolean
  decision: {
    operation: string
    modality: string
    chosen: Candidate | null
    candidates: Candidate[]
    notes: string[]
  }
}

interface LedgerRow {
  id: string
  operation: string
  providerId: string
  model: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  outcome: string
  error: string | null
  attempt: number
  createdAt: string
}

const OUTCOME_COLOR: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
  switched: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'dry-run': 'bg-muted text-muted-foreground',
}

export function RouterTab() {
  const [operation, setOperation] = useState('flashcards.generate')
  const [modality, setModality] = useState('chat')
  const [maxCost, setMaxCost] = useState('0.50')
  const [preferLocal, setPreferLocal] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [result, setResult] = useState<DecideResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [spend, setSpend] = useState<number | null>(null)

  const loadLedger = useCallback(async () => {
    try {
      const res = await fetch('/api/royal-red/router/matrix')
      const j = (await res.json()) as { ledger: { recent: LedgerRow[]; summary: { totalCostUsd: number } } }
      setLedger(j.ledger.recent ?? [])
      setSpend(j.ledger.summary?.totalCostUsd ?? 0)
    } catch { /* honest empty state */ }
  }, [])

  useEffect(() => { void loadLedger() }, [loadLedger])

  const runDecide = useCallback(async (dryRun: boolean) => {
    setRunning(true)
    try {
      const res = await fetch('/api/royal-red/router/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation,
          modality,
          messages: [{ role: 'user', content: 'router panel preview request' }],
          maxTokens: 512,
          dryRun,
          policy: { maxCostUsd: parseFloat(maxCost) || 0, preferLocal, allowPaid: !freeOnly },
        }),
      })
      setResult((await res.json()) as DecideResponse)
      if (!dryRun) void loadLedger()
    } catch { /* keep last result */ } finally {
      setRunning(false)
    }
  }, [operation, modality, maxCost, preferLocal, freeOnly, loadLedger])

  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 p-4 font-mono lg:grid-cols-2">
        {/* -------- dry-run playground -------- */}
        <div className="space-y-3">
          <div className="rounded border border-red-500/20 bg-red-500/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] tracking-widest text-red-700 dark:text-red-300">
              <Route className="h-3.5 w-3.5" /> ROUTING PREVIEW
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">OPERATION</Label>
                <Input value={operation} onChange={(e) => setOperation(e.target.value)} className="h-7 text-[11px]" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">MODALITY</Label>
                <select value={modality} onChange={(e) => setModality(e.target.value)} className="h-7 w-full rounded border bg-background px-1 text-[11px]">
                  {['chat', 'vision', 'image', 'search', 'embedding', 'audio', 'video'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">MAX COST / CALL ($)</Label>
                <Input value={maxCost} onChange={(e) => setMaxCost(e.target.value)} className="h-7 text-[11px]" />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={preferLocal} onChange={(e) => setPreferLocal(e.target.checked)} /> prefer local</label>
                <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> free only</label>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={running} onClick={() => void runDecide(true)}><Play className="h-3 w-3" /> DRY RUN</Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={running} onClick={() => void runDecide(false)}><SwitchCamera className="h-3 w-3" /> EXECUTE (records ledger)</Button>
            </div>
          </div>

          {result && (
            <div className="rounded border">
              <div className="border-b bg-muted/40 px-2 py-1.5 text-[10px] tracking-widest text-muted-foreground">
                DECISION — {result.decision.operation} · {result.decision.modality} · {result.dryRun ? 'PREVIEW' : 'EXECUTED'}
              </div>
              <div className="divide-y">
                {result.decision.candidates.map((c) => (
                  <div key={c.providerId} className={`flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] ${c.blocked ? 'opacity-50' : ''}`}>
                    <div>
                      <span className="font-semibold">{c.providerId}</span>
                      <span className="ml-1 text-[9px] text-muted-foreground">{c.model}</span>
                      {result.decision.chosen?.providerId === c.providerId && <Badge className="ml-2 bg-red-500/15 text-red-700 dark:text-red-300" variant="secondary">CHOSEN</Badge>}
                      {c.blocked && <span className="ml-2 text-[10px] text-amber-600">{c.blocked}</span>}
                    </div>
                    <div className="whitespace-nowrap text-right text-[10px] text-muted-foreground">
                      {c.local ? '$0 local' : `$${c.estimatedCostUsd.toFixed(5)}`}
                    </div>
                  </div>
                ))}
                {!result.decision.candidates.length && (
                  <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">no candidates — fail closed</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* -------- cost ledger -------- */}
        <div className="space-y-3">
          <div className="rounded border border-red-500/20 bg-red-500/5 p-3 text-[11px]">
            <div className="mb-1 flex items-center justify-between">
              <span className="tracking-widest text-red-700 dark:text-red-300">COST LEDGER</span>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void loadLedger()}>refresh</Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              lifetime spend: <span className="font-semibold text-foreground">{spend === null ? '—' : `$${spend.toFixed(4)}`}</span> · every call is audit-logged with cost, latency, provider, modality, outcome
            </div>
          </div>
          <div className="overflow-hidden rounded border">
            <table className="w-full text-[10px]">
              <thead className="bg-muted/50 text-left tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">OPERATION</th>
                  <th className="px-2 py-1">PROVIDER</th>
                  <th className="px-2 py-1">TOKENS</th>
                  <th className="px-2 py-1">COST</th>
                  <th className="px-2 py-1">MS</th>
                  <th className="px-2 py-1">OUTCOME</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="max-w-[140px] truncate px-2 py-1" title={r.operation}>{r.operation}</td>
                    <td className="px-2 py-1">{r.providerId}</td>
                    <td className="px-2 py-1">{r.tokensIn}/{r.tokensOut}</td>
                    <td className="px-2 py-1">${r.costUsd.toFixed(6)}</td>
                    <td className="px-2 py-1">{r.latencyMs}</td>
                    <td className="px-2 py-1"><span className={`rounded px-1 py-0.5 ${OUTCOME_COLOR[r.outcome] ?? 'bg-muted'}`}>{r.outcome}{r.attempt > 1 ? ` #${r.attempt}` : ''}</span></td>
                  </tr>
                ))}
                {!ledger.length && (
                  <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">no calls recorded yet — run a dry-run or execute above</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Rotation is invisible to the user: if a provider fails or drops mid-stream, the turn resumes on the
            next candidate with the partial output preserved — same session, same memory, same artifacts. Switch
            events land in the ledger as outcome=switched. 5-switch contract proven in scripts/test-royalred-router.ts.
          </p>
        </div>
      </div>
    </ScrollArea>
  )
}
