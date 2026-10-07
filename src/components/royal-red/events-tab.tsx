'use client'

// ROYAL RED EVENTS panel — the console surface of the durable session event
// log (DeepSeek-harness port #1). Shows the ordered typed log for the active
// session, the REPLAY PROJECTION (state folded from the log), and the
// append-only INTEGRITY check (contiguous per-session seqs).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useRoyalRed } from './store'

interface EventRow {
  seq: number
  sessionId: string
  runId: string | null
  type: string
  ignorable: boolean
  payload: Record<string, unknown>
  at: string
}

interface Projection {
  sessionState: string
  turns: number
  iterations: number
  says: number
  toolDispatches: number
  toolErrors: number
  artifactsWritten: number
  llmAttempts: number
  llmFailures: number
  rotations: number
  consentsAsked: number
  consentsDenied: number
  policyDecisions: { allow: number; deny: number; ask: number }
  verifyReceipts: number
  errors: number
  totalCostUsd: number
  modes: string[]
  unknownEventTypes: string[]
}

interface EventsResponse {
  count: number
  events: EventRow[]
  projection: Projection
  integrity: { ok: boolean; expected: number; actual: number }
}

const TYPE_COLOR: Record<string, string> = {
  'turn/': 'text-red-600 dark:text-red-400',
  'iteration/': 'text-red-600/80 dark:text-red-400/80',
  'llm/': 'text-amber-600 dark:text-amber-400',
  'assistant/': 'text-emerald-600 dark:text-emerald-400',
  'artifact/': 'text-emerald-600 dark:text-emerald-400',
  'tool/': 'text-amber-600 dark:text-amber-400',
  'consent/': 'text-violet-600 dark:text-violet-400',
  'policy/': 'text-violet-600 dark:text-violet-400',
  'verify/': 'text-emerald-600 dark:text-emerald-400',
  'sandbox/': 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

function typeColor(type: string): string {
  if (TYPE_COLOR[type]) return TYPE_COLOR[type]
  for (const k of Object.keys(TYPE_COLOR)) if (type.startsWith(k)) return TYPE_COLOR[k]
  return 'text-muted-foreground'
}

function payloadPreview(type: string, p: Record<string, unknown>): string {
  try {
    if (type === 'assistant/say' && typeof p.text === 'string') return p.text.slice(0, 120)
    if (type === 'policy/decision') return `${p.tool} → ${p.verdict} by ${p.layer}`
    if (type === 'llm/attempt') return `${p.operation} ${p.path}/${p.provider ?? ''} ${p.outcome}${p.switches ? ` · ${p.switches} switch` : ''}`
    if (type === 'llm/request-header') return `${p.operation} ${p.provider}`
    if (type === 'tool/result') return `${p.name} ok=${p.ok}`
    if (type === 'artifact/written') return `${p.name ?? ''} [${Array.isArray(p.files) ? (p.files as string[]).length : '?'} files]`
    if (type === 'iteration/started') return String(p.value ?? '')
    if (type === 'sandbox/mode') return `${p.mode} · ${Array.isArray(p.writableRoots) ? (p.writableRoots as string[]).length : '?'} roots`
    const s = JSON.stringify(p)
    return s.length > 120 ? s.slice(0, 117) + '…' : s
  } catch {
    return ''
  }
}

export function EventsTab() {
  const sessionId = useRoyalRed((s) => s.sessionId)
  const streaming = useRoyalRed((s) => s.streaming)
  const [data, setData] = useState<EventsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/royal-red/events?sessionId=${encodeURIComponent(sessionId)}&limit=500`, { cache: 'no-store' })
      const json = (await res.json()) as EventsResponse & { error?: string }
      if (json.error) throw new Error(json.error)
      setData(json)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  // follow a live stream: poll while the turn is streaming
  useEffect(() => {
    if (streaming && sessionId) {
      autoRef.current = setInterval(load, 2500)
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
      autoRef.current = null
    }
  }, [streaming, sessionId, load])

  if (!sessionId) {
    return (
      <ScrollArea className="h-full">
        <p className="px-4 py-6 font-mono text-xs text-muted-foreground">no active session — the durable event log is per-session.</p>
      </ScrollArea>
    )
  }

  const p = data?.projection

  return (
    <ScrollArea className="h-full">
      <div className="royalred-grid-bg space-y-5 px-4 py-4">
        {/* integrity + controls */}
        <section className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest ${
              data?.integrity.ok
                ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300'
            }`}
          >
            {data?.integrity.ok ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
            {data ? `LOG ${data.integrity.ok ? 'INTACT' : 'GAP'} · ${data.integrity.actual}/${data.integrity.expected} seq` : 'LOG …'}
          </span>
          <span className="rounded-full border bg-muted/40 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            APPEND-ONLY · {data?.count ?? 0} events
          </span>
          {streaming && <span className="rounded-full border border-red-600/50 bg-red-500/10 px-2.5 py-1 font-mono text-[10px] text-red-700 dark:text-red-300">FOLLOWING STREAM</span>}
          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" aria-label="Reload event log" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </section>
        {error && <p className="font-mono text-[11px] text-red-600 dark:text-red-400">event log error: {error}</p>}

        {/* replay projection */}
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">REPLAY PROJECTION (state folded from the log)</h3>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {[
              { k: 'turns', v: p?.turns },
              { k: 'iterations', v: p?.iterations },
              { k: 'says', v: p?.says },
              { k: 'artifacts', v: p?.artifactsWritten },
              { k: 'tools', v: p ? `${p.toolDispatches}${p.toolErrors ? `/${p.toolErrors} err` : ''}` : undefined },
              { k: 'llm calls', v: p ? `${p.llmAttempts}${p.llmFailures ? `/${p.llmFailures} err` : ''}` : undefined },
              { k: 'rotations', v: p?.rotations },
              { k: 'consents', v: p ? `${p.consentsAsked}${p.consentsDenied ? `/${p.consentsDenied} no` : ''}` : undefined },
              { k: 'policy', v: p ? `${p.policyDecisions.allow}✓ ${p.policyDecisions.deny}✗ ${p.policyDecisions.ask}?` : undefined },
              { k: 'receipts', v: p?.verifyReceipts },
              { k: 'cost', v: p ? `$${p.totalCostUsd.toFixed(4)}` : undefined },
              { k: 'errors', v: p?.errors },
            ].map((s) => (
              <div key={s.k} className="rounded border bg-background/70 p-2">
                <div className="font-mono text-sm text-foreground">{s.v ?? '—'}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{s.k}</div>
              </div>
            ))}
          </div>
          {p?.modes?.length ? (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">modes seen: {p.modes.join(', ')}</p>
          ) : null}
          {p?.unknownEventTypes?.length ? (
            <p className="mt-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
              ignorable (future-kernel) types: {p.unknownEventTypes.join(', ')}
            </p>
          ) : null}
        </section>

        {/* the ordered log */}
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">EVENT LOG (typed · seq-contiguous · replayable)</h3>
          <div className="max-h-[46vh] space-y-0.5 overflow-y-auto rounded border bg-background/70 p-2 [scrollbar-color:theme(colors.red.600)_transparent] [scrollbar-width:thin]">
            {[...(data?.events ?? [])].reverse().map((e) => (
              <div key={e.seq} className="flex items-baseline gap-2 font-mono text-[10px] leading-4">
                <span className="w-10 shrink-0 text-right text-muted-foreground/60">{e.seq}</span>
                <span className="w-14 shrink-0 text-muted-foreground/70">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</span>
                <span className={`w-36 shrink-0 truncate ${typeColor(e.type)}`}>{e.type}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{payloadPreview(e.type, e.payload)}</span>
              </div>
            ))}
            {data && !data.events.length && <p className="p-2 font-mono text-[11px] text-muted-foreground">log is empty — send a command to write the first events.</p>}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
