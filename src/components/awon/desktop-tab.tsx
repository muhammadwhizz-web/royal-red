'use client'

// DESKTOP tab - the AWON Box mission control (Phase 4).
// Everything here reads the honest state: what the runtime really is, what is
// mounted, what runs, what waits for consent, what can be undone, and what the
// kill switch will do. The ABORT button is always rendered - a kill switch
// that hides when things look calm is not a kill switch.
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Ban,
  CircleSlash,
  Cpu,
  Eye,
  FolderTree,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useAwon } from './store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/use-toast'

interface DesktopState {
  runtime: { kind: string; name: string; description: string; active: boolean }
  boxRoot: string
  boxHome: string
  mounts: { virtual: string; mode: string; label: string; exists: boolean }[]
  runs: { id: string; status: string; tool: string; total: number; done: number; undoable: number; startedAt: string; endedAt: string | null; abortReason: string | null }[]
  consentQueue: { id: string; tier: number; title: string; detail?: string; createdAt: string; expiresAt: string }[]
  journal: { id: string; runId: string; seq: number; op: string; from: string; to: string; createdAt: string }[]
  trash: { files: number; bytes: number; oldest: string | null }
  screen: { displays: number; children: number; input: boolean }
  processes: { label: string; startedAt: number; pid?: number }[]
  audit: { id: string; action: string; detail: string | null; ok: boolean; createdAt: string }[]
}

function bytesLabel(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function SectionHeader({ icon: Icon, title, right }: { icon: typeof Eye; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <h3 className="flex-1 font-mono text-xs tracking-[0.2em] text-muted-foreground">{title}</h3>
      {right}
    </div>
  )
}

function timeAgo(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime()
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export function DesktopTab() {
  const sessionId = useAwon((s) => s.sessionId)
  const answerConsent = useAwon((s) => s.answerConsent)
  const [state, setState] = useState<DesktopState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAbort, setConfirmAbort] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/awon/desktop/state${sessionId ? `?sessionId=${sessionId}` : ''}`)
      if (res.ok) setState((await res.json()) as DesktopState)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 2500)
    return () => clearInterval(t)
  }, [refresh])

  const abort = async () => {
    setConfirmAbort(false)
    setBusy('abort')
    try {
      const res = await fetch('/api/awon/desktop/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId ?? undefined }),
      })
      const data = (await res.json()) as { runsAborted: number; frozen: number; killed: number }
      toast({
        title: 'KILL SWITCH EXECUTED',
        description: `${data.runsAborted} run(s) aborted, ${data.frozen} consent(s) frozen, ${data.killed} process(es) signaled`,
      })
      await refresh()
    } catch (e) {
      toast({ title: 'Abort failed', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const undoRun = async (runId: string) => {
    if (!sessionId) return
    setBusy(runId)
    try {
      const res = await fetch('/api/awon/desktop/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, runId }),
      })
      const data = (await res.json()) as { ok: boolean; lines?: string[]; error?: string }
      toast({ title: data.ok ? 'Undo complete' : 'Undo not possible', description: data.ok ? `${data.lines?.length ?? 0} steps reversed` : data.error })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const activeRun = state?.runs.find((r) => r.status === 'running')
  const hasPending = (state?.consentQueue.length ?? 0) > 0

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* RUN + ABORT: the kill switch is always on screen */}
        <section>
          <SectionHeader
            icon={Activity}
            title="ACTIVE RUN"
            right={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                aria-label="Kill switch: abort all box activity, freeze pending consents"
                className="h-7 gap-1.5 rounded px-2.5 font-mono text-[10px] tracking-[0.2em]"
                disabled={busy === 'abort'}
                onClick={() => setConfirmAbort(true)}
              >
                {busy === 'abort' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                ABORT
              </Button>
            }
          />
          {confirmAbort && (
            <div className="mb-2 rounded border border-red-600/40 bg-red-500/5 p-2.5" role="alertdialog" aria-label="Confirm kill switch">
              <p className="font-mono text-[11px] leading-relaxed text-red-600 dark:text-red-300">
                THE KILL SWITCH: stops the action queue, SIGTERMs every supervised process (box exec, Xvfb), freezes every pending consent forever, writes an audit row. Files already moved stay journaled and undoable. This cannot be un-done for consents.
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button type="button" size="sm" variant="destructive" className="h-7 rounded px-2.5 font-mono text-[10px] tracking-widest" onClick={() => void abort()}>
                  CONFIRM ABORT
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 rounded px-2.5 font-mono text-[10px] tracking-widest" onClick={() => setConfirmAbort(false)}>
                  CANCEL
                </Button>
              </div>
            </div>
          )}
          {activeRun ? (
            <div className="rounded border border-amber-600/40 bg-amber-500/5 p-2.5">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                <span className="font-semibold">{activeRun.id}</span>
                <span className="text-muted-foreground">({activeRun.tool})</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${activeRun.total ? Math.round((activeRun.done / activeRun.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {activeRun.done}/{activeRun.total}
                </span>
              </div>
            </div>
          ) : (
            <p className="rounded border border-border/60 bg-muted/20 p-2.5 font-mono text-[11px] text-muted-foreground">
              no active box run. the kill switch still works: it freezes any pending consent queue instantly.
            </p>
          )}
          {hasPending && (
            <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
              <ShieldAlert className="h-3 w-3" />
              {state?.consentQueue.length} consent request(s) waiting in the chat - each has its own 120s clock
            </p>
          )}
        </section>

        {/* BOX: the honest runtime identity */}
        <section>
          <SectionHeader icon={Cpu} title="AWON BOX" />
          <div className="space-y-1.5 rounded border border-border/60 bg-muted/20 p-2.5 font-mono text-[11px]">
            <div>
              <span className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-bold tracking-widest', state?.runtime.kind === 'container' ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                {state?.runtime.kind === 'container' ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                {state?.runtime.kind === 'container' ? 'CONTAINER' : 'PATH PRISON — userland isolation, not kernel-level'}
              </span>
            </div>
            <p className="leading-relaxed text-muted-foreground">{state?.runtime.description}</p>
            <p className="text-muted-foreground">
              enforced by this same Node process, not by the kernel - if this process is compromised, the prison is compromised with it.
            </p>
            <p className="text-muted-foreground">
              root <span className="text-foreground/80">{state?.boxRoot}</span>
            </p>
            <div>
              <p className="mb-1 flex items-center gap-1 text-muted-foreground">
                <FolderTree className="h-3 w-3" /> mounts (host filesystem is NOT mounted)
              </p>
              {state?.mounts.map((m) => (
                <p key={m.virtual} className="ml-4 flex items-center gap-2 text-muted-foreground">
                  <span className={cn('rounded px-1 text-[9px] font-bold', m.mode === 'rw' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-border text-muted-foreground')}>{m.mode.toUpperCase()}</span>
                  <span className="text-foreground/80">{m.virtual}</span>
                  {!m.exists && <span className="text-[9px] text-red-500">(missing)</span>}
                </p>
              ))}
            </div>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Trash2 className="h-3 w-3" /> trash: {state?.trash.files ?? 0} files, {bytesLabel(state?.trash.bytes ?? 0)}
              {state?.trash.oldest && <> · oldest {timeAgo(state.trash.oldest)} (7-day TTL, purge is manual)</>}
            </p>
          </div>
        </section>

        {/* CONSENT QUEUE (FIFO) */}
        <section>
          <SectionHeader icon={ShieldCheck} title="CONSENT QUEUE (FIFO)" />
          {state?.consentQueue.length ? (
            <div className="space-y-1.5">
              {state.consentQueue.map((c, i) => (
                <div key={c.id} className="rounded border border-border/60 bg-card p-2 font-mono text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">#{i + 1}</span>
                    <span className={cn('rounded px-1 text-[9px] font-bold', c.tier === 3 ? 'bg-red-500/15 text-red-600 dark:text-red-400' : c.tier === 2 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>T{c.tier}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground/85">{c.title}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">waiting for your answer in chat · expires {timeAgo(c.expiresAt).replace(' ago', '') === '0s' ? 'soon' : `in ≤120s`}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">queue empty.</p>
          )}
        </section>

        {/* RECENT RUNS + UNDO */}
        <section>
          <SectionHeader icon={Undo2} title="RECENT RUNS · UNDO" />
          {state?.runs.length ? (
            <div className="space-y-1.5">
              {state.runs.map((r) => (
                <div key={r.id} className={cn('flex items-center gap-2 rounded border p-2 font-mono text-[11px]', r.status === 'aborted' ? 'border-red-600/30 bg-red-500/5' : 'border-border/60 bg-card')}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className={cn(r.status === 'aborted' ? 'text-red-600 dark:text-red-400' : r.status === 'running' ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400')}>{r.status.toUpperCase()}</span>{' '}
                      <span className="text-foreground/85">{r.id}</span> <span className="text-muted-foreground">· {r.tool} · {r.done}/{r.total} · {timeAgo(r.startedAt)}</span>
                    </p>
                    {r.abortReason && <p className="truncate text-[10px] text-muted-foreground">abort: {r.abortReason}</p>}
                  </div>
                  {r.undoable > 0 && (
                    <Button type="button" size="sm" variant="outline" className="h-6 shrink-0 gap-1 rounded px-2 font-mono text-[10px] tracking-widest" disabled={busy === r.id} onClick={() => void undoRun(r.id)}>
                      {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                      UNDO {r.undoable}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">no runs yet.</p>
          )}
          {state?.journal.length ? (
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
              journal: {state.journal.length} undoable entr{state.journal.length === 1 ? 'y' : 'ies'} · trash restore window 7 days · rm does not exist in the box
            </p>
          ) : null}
        </section>

        {/* SCREEN (virtual display) */}
        <section>
          <SectionHeader icon={Eye} title="TARGET: VIRTUAL SCREEN (no real apps installed yet)" />
          <div className="rounded border border-border/60 bg-muted/20 p-2.5 font-mono text-[11px] text-muted-foreground">
            <p>
              Xvfb displays: <span className="text-foreground/85">{state?.screen.displays ?? 0}</span> · supervised processes: <span className="text-foreground/85">{state?.screen.children ?? 0}</span>
            </p>
            <p className="mt-1 flex items-start gap-1.5">
              <MouseHint /> input backend: <span className={state?.screen.input ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{state?.screen.input ? 'available' : 'NOT INSTALLED - click/type fail closed honestly'}</span>
            </p>
            <p className="mt-1 text-[10px]">any click, keystroke or screenshot here happens on a virtual Xvfb display with NO real applications installed - never on your desktop. nothing in the box can touch your physical screen, pointer, or keyboard.</p>
          </div>
        </section>

        {/* PROCESSES */}
        <section>
          <SectionHeader icon={Cpu} title="SUPERVISED PROCESSES" />
          {state?.processes.length ? (
            <div className="space-y-1">
              {state.processes.map((p, i) => (
                <p key={`${p.label}-${i}`} className="font-mono text-[10px] text-muted-foreground">
                  <span className="text-foreground/80">{p.label}</span> pid {p.pid ?? '?'} · {timeAgo(p.startedAt)}
                </p>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">none running.</p>
          )}
        </section>

        {/* ACTIVITY (audit tail) */}
        <section>
          <SectionHeader
            icon={Activity}
            title="ACTIVITY"
            right={
              <button type="button" onClick={() => void refresh()} aria-label="Refresh desktop state" className="rounded border border-transparent p-0.5 text-muted-foreground transition hover:border-border hover:text-foreground">
                <RefreshCw className="h-3 w-3" />
              </button>
            }
          />
          <div className="space-y-1">
            {state?.audit.map((r) => (
              <div key={r.id} className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                {r.action.startsWith('desktop.abort') ? <CircleSlash className={cn('h-3 w-3', r.ok ? 'text-red-500' : 'text-muted-foreground')} /> : r.action.startsWith('desktop.') ? <Ban className={cn('h-3 w-3', r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')} /> : null}
                <span className={cn(r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>{r.ok ? 'ok' : 'err'}</span>
                <span className="text-foreground/75">{r.action}</span>
                <span className="min-w-0 flex-1 truncate">{r.detail}</span>
                <span className="shrink-0">{timeAgo(r.createdAt)}</span>
              </div>
            ))}
            {!state?.audit.length && <p className="font-mono text-[10px] text-muted-foreground">clean.</p>}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}

function MouseHint() {
  return null
}
