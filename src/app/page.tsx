'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sun,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Signature } from '@/components/royal-red/signature'
import { BootOverlay } from '@/components/royal-red/boot-overlay'
import { ChatStream, PlanRail } from '@/components/royal-red/chat-stream'
import { Composer } from '@/components/royal-red/composer'
import { RightPanel } from '@/components/royal-red/right-panel'
import { CommandPalette } from '@/components/royal-red/palette'
import { useRoyalRed } from '@/components/royal-red/store'
import type { ChatItem } from '@/lib/royal-red/types'
import { MODE_LABELS, type RoyalRedMode, type SessionSummary } from '@/lib/royal-red/types'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Toggle dark or light mode"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}

// /theme is a local slash command handled in the store, which has no React
// context; this always-mounted bridge performs the actual toggle for it and
// rewrites the placeholder event row with the ACTUAL new theme
function ThemeCommandBridge() {
  const request = useRoyalRed((s) => s.themeToggleRequest)
  const { resolvedTheme, setTheme } = useTheme()
  useEffect(() => {
    if (!request) return
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    useRoyalRed.setState((st) => ({
      items: st.items.map((i): ChatItem =>
        i.kind === 'event' && i.label === 'theme' && i.detail === 'theme switching...'
          ? { ...i, detail: `console surface switched to ${next} mode` }
          : i,
      ),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: the bridge re-runs only when a new theme request lands
  }, [request])
  return null
}

const MODE_DOT: Record<string, string> = {
  build: 'bg-emerald-500',
  research: 'bg-amber-500',
  pc: 'bg-violet-500',
  ask: 'bg-sky-500',
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// per-mode chip colors for the sessions filter row (matches composer accents)
const MODE_CHIP: Record<'all' | RoyalRedMode, string> = {
  all: 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  build: 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  research: 'border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  pc: 'border-violet-600/60 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  ask: 'border-sky-600/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

// hairline group label for the sessions sheet (PINNED / TODAY / ...)
function GroupLabel({ text }: { text: string }) {
  return (
    <div className="mb-1 mt-2 flex items-center gap-1.5 px-3 font-mono text-[9px] tracking-[0.25em] text-muted-foreground/70 first:mt-0">
      {text}
      <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
    </div>
  )
}

function SessionsSheet() {
  const sessions = useRoyalRed((s) => s.sessions)
  const sessionsOpen = useRoyalRed((s) => s.sessionsOpen)
  const sessionsHasMore = useRoyalRed((s) => s.sessionsHasMore)
  const sessionsLoadingMore = useRoyalRed((s) => s.sessionsLoadingMore)
  const setSessionsOpen = useRoyalRed((s) => s.setSessionsOpen)
  const refreshSessions = useRoyalRed((s) => s.refreshSessions)
  const loadSession = useRoyalRed((s) => s.loadSession)
  const sessionId = useRoyalRed((s) => s.sessionId)
  const reset = useRoyalRed((s) => s.reset)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | RoyalRedMode>('all')
  const sentinelRef = useRef<HTMLDivElement>(null)

  const refreshList = async () => {
    await refreshSessions()
  }

  const togglePin = async (id: string, pinned: boolean) => {
    try {
      const res = await fetch(`/api/royal-red/session/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      })
      if (res.ok) await refreshList()
    } catch {}
  }

  // fetch ONLY when the sheet opens; depending on `sessions` here caused an
  // infinite refetch loop (set sessions -> effect re-runs -> fetch -> set ...)
  useEffect(() => {
    if (!sessionsOpen) return
    void refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: fetch ONLY when the sheet opens (see comment above)
  }, [sessionsOpen])

  // infinite scroll: the sentinel sits at the bottom of the list; the observer
  // reads the store via getState so no stale-closure re-subscription is needed
  useEffect(() => {
    if (!sessionsOpen) return
    const el = sentinelRef.current
    if (!el) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void useRoyalRed.getState().loadMoreSessions()
      },
      {
        root: el.closest('[data-radix-scroll-area-viewport]') ?? null,
        rootMargin: '240px',
      },
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [sessionsOpen, sessionsHasMore])

  const deleteSession = async (id: string, title: string) => {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/royal-red/session/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Session deleted', description: title })
        // deleting the open session returns the console to a clean slate
        if (useRoyalRed.getState().sessionId === id) reset()
        await refreshList()
      } else {
        toast({ title: 'Delete failed', variant: 'destructive' })
      }
    } finally {
      setBusyId(null)
    }
  }

  const commitRename = async (id: string) => {
    const title = renameText.trim()
    setRenaming(null)
    if (!title) return
    try {
      const res = await fetch(`/api/royal-red/session/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        if (useRoyalRed.getState().sessionId === id) useRoyalRed.setState({ sessionTitle: title })
        await refreshList()
      }
    } catch {}
  }

  const q = filter.trim().toLowerCase()
  const visible = sessions.filter(
    (s) =>
      (!q || s.title.toLowerCase().includes(q)) && (modeFilter === 'all' || s.mode === modeFilter),
  )
  const pinnedList = visible.filter((s) => s.pinned)
  const unpinned = visible.filter((s) => !s.pinned)

  // date buckets so long histories scan like a real OS file index
  const DAY = 86400000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const t0 = startOfToday.getTime()
  const buckets: { label: string; items: SessionSummary[] }[] = [
    { label: 'TODAY', items: [] },
    { label: 'YESTERDAY', items: [] },
    { label: 'THIS WEEK', items: [] },
    { label: 'EARLIER', items: [] },
  ]
  for (const s of unpinned) {
    const ts = new Date(s.updatedAt).getTime()
    if (ts >= t0) buckets[0].items.push(s)
    else if (ts >= t0 - DAY) buckets[1].items.push(s)
    else if (ts >= t0 - 6 * DAY) buckets[2].items.push(s)
    else buckets[3].items.push(s)
  }
  const groups = [
    pinnedList.length ? { label: `PINNED (${pinnedList.length})`, items: pinnedList } : null,
    ...buckets.filter((b) => b.items.length),
  ].filter((g): g is { label: string; items: SessionSummary[] } => g !== null)

  const renderRow = (s: SessionSummary) => {
    const dot = MODE_DOT[s.mode] ?? 'bg-sky-500'
    const active = s.id === sessionId
    return (
      <div
        key={s.id}
        className={cn(
          'group relative rounded-md transition hover:bg-muted focus-within:bg-muted',
          active && 'bg-muted/60 ring-1 ring-red-600/30',
        )}
      >
        {renaming === s.id ? (
          <div className="p-2">
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(s.id)
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={() => void commitRename(s.id)}
              aria-label="Rename session"
              className="w-full rounded border border-red-600/50 bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-red-600/40"
            />
            <p className="mt-1 px-0.5 font-mono text-[9px] text-muted-foreground">enter to save / esc to cancel</p>
          </div>
        ) : (
          <button
            onClick={() => void loadSession(s.id)}
            className="w-full px-3 py-2 pr-14 text-left"
            aria-label={`Open session ${s.title}`}
          >
            <div className="flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs transition group-hover:text-foreground">{s.title}</span>
            </div>
            <div className="ml-3.5 font-mono text-[10px] text-muted-foreground">
              {s.mode} {relTime(s.updatedAt)}
            </div>
          </button>
        )}
        {renaming !== s.id && (
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              onClick={() => void togglePin(s.id, !s.pinned)}
              disabled={busyId === s.id}
              aria-label={s.pinned ? `Unpin session ${s.title}` : `Pin session ${s.title}`}
              title={s.pinned ? 'Unpin' : 'Pin to top'}
              className={cn(
                'rounded p-1 transition hover:bg-background',
                s.pinned
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={busyId === s.id}
                  aria-label={`Export session ${s.title}`}
                  title="Export session"
                  className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                >
                  <Download className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                {([
                  { fmt: 'md', label: 'MARKDOWN', icon: FileText },
                  { fmt: 'pdf', label: 'PDF', icon: FileDown },
                  { fmt: 'csv', label: 'CSV', icon: FileSpreadsheet },
                ] as const).map(({ fmt, label, icon: Icon }) => (
                  <DropdownMenuItem
                    key={fmt}
                    onClick={() => window.open(`/api/royal-red/session/${s.id}/export?format=${fmt}`, '_blank')}
                    className="gap-2 font-mono text-[11px]"
                  >
                    <Icon className="h-3 w-3 text-red-600 dark:text-red-400" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => {
                setRenaming(s.id)
                setRenameText(s.title)
              }}
              disabled={busyId === s.id}
              aria-label={`Rename session ${s.title}`}
              title="Rename"
              className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => void deleteSession(s.id, s.title)}
              disabled={busyId === s.id}
              aria-label={`Delete session ${s.title}`}
              title="Delete session and its artifacts"
              className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-red-500"
            >
              {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Sheet open={sessionsOpen} onOpenChange={setSessionsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Session history">
          <History className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="font-mono text-sm tracking-[0.25em]">SESSIONS</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-64px)]">
          <div className="p-2">
            <button
              onClick={() => {
                reset()
                setSessionsOpen(false)
                toast({ title: 'New session', description: 'ROYAL RED is listening.' })
              }}
              className="mb-2 flex w-full items-center gap-2 rounded-md border border-red-600/40 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-700 transition hover:bg-red-500/15 dark:text-red-300"
            >
              <Plus className="h-3.5 w-3.5" /> NEW SESSION
            </button>
            <Separator className="mb-2" />
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter sessions..."
                aria-label="Filter sessions by title"
                className="h-8 border-input bg-card pl-8 font-mono text-xs"
              />
            </div>
            <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter sessions by mode">
              {(['all', 'build', 'research', 'pc', 'ask'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModeFilter(m)}
                  aria-pressed={modeFilter === m}
                  className={cn(
                    'rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider transition',
                    modeFilter === m
                      ? MODE_CHIP[m]
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            {(filter.trim() || modeFilter !== 'all') && (
              <p className="px-3 pb-1 font-mono text-[10px] text-muted-foreground">
                {visible.length} of {sessions.length} sessions
              </p>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <GroupLabel text={g.label} />
                {g.items.map(renderRow)}
              </div>
            ))}
            {sessionsHasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-3 font-mono text-[10px] text-muted-foreground">
                {sessionsLoadingMore ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> loading more sessions...
                  </>
                ) : (
                  'scroll for older sessions'
                )}
              </div>
            )}
            {(filter.trim() || modeFilter !== 'all') && !visible.length && (
              <p className="p-3 font-mono text-xs text-muted-foreground">
                no sessions match {'"'}{filter.trim() || modeFilter}{'"'}.
              </p>
            )}
            {!sessions.length && (
              <p className="p-3 font-mono text-xs text-muted-foreground">no sessions yet.</p>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

export default function RoyalRedConsole() {
  const mode = useRoyalRed((s) => s.mode)
  const streaming = useRoyalRed((s) => s.streaming)
  const artifact = useRoyalRed((s) => s.artifact)
  const sessionTitle = useRoyalRed((s) => s.sessionTitle)
  const panelHidden = useRoyalRed((s) => s.panelHidden)
  const setPanelHidden = useRoyalRed((s) => s.setPanelHidden)
  const composerRef = useRef<HTMLDivElement>(null)

  // warm the sessions list (page 0 + cursor state for infinite scroll)
  useEffect(() => {
    void useRoyalRed.getState().refreshSessions()
  }, [])

  // press / anywhere to jump to the command line (vi style), unless typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ctrl+b: focus mode, chat fills the console (desktop); ctrl+j: sessions
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'b') {
          e.preventDefault()
          setPanelHidden(!useRoyalRed.getState().panelHidden)
          return
        }
        if (k === 'j') {
          e.preventDefault()
          useRoyalRed.setState({ sessionsOpen: !useRoyalRed.getState().sessionsOpen })
          return
        }
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      const ta = composerRef.current?.querySelector('textarea')
      ta?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPanelHidden])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <BootOverlay />
      <CommandPalette />
      <ThemeCommandBridge />
      <div className="royalred-scanlines pointer-events-none fixed inset-0 z-40 opacity-40" aria-hidden="true" />

      {/* top bar */}
      <header className="z-30 flex shrink-0 items-center justify-between border-b bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Signature />
          <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.3em] text-muted-foreground lg:inline">
            OS WITHIN OS / LINUX
          </span>
          {sessionTitle && (
            <span
              className="hidden min-w-0 items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 font-mono text-[10px] sm:inline-flex"
              title={sessionTitle}
            >
              <span className="h-1 w-1 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
              <span className="max-w-[220px] truncate text-foreground/80">{sessionTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest sm:flex ${
              streaming
                ? 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-border text-muted-foreground'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${streaming ? 'animate-pulse bg-red-500' : 'bg-muted-foreground/40'}`} />
            {MODE_LABELS[mode]}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 md:inline-flex"
            aria-label={panelHidden ? 'Show preview panel' : 'Hide preview panel'}
            aria-pressed={panelHidden}
            title={`${panelHidden ? 'Show' : 'Hide'} preview panel (Ctrl+B)`}
            onClick={() => setPanelHidden(!panelHidden)}
          >
            {panelHidden ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Open command palette"
            title="Command palette (Ctrl+K)"
            onClick={() => useRoyalRed.setState({ paletteOpen: true })}
          >
            <Terminal className="h-4 w-4" />
          </Button>
          <SessionsSheet />
          <ThemeToggle />
        </div>
      </header>

      {/* main area: ctrl+b collapses the preview panel for full-width focus */}
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="chat" defaultSize={55} minSize={30}>
          <div ref={composerRef} className="royalred-grid-bg flex h-full min-h-0 flex-col">
            <PlanRail />
            <div className="royalred-fade-top min-h-0 flex-1">
              <ChatStream />
            </div>
            <Composer />
          </div>
        </ResizablePanel>
        {!panelHidden && (
          <>
            <ResizableHandle withHandle className="hidden md:flex" />
            <ResizablePanel id="preview" defaultSize={45} minSize={25} className="hidden md:block">
              <RightPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* mobile artifact chip */}
      {artifact && (
        <button
          onClick={() => window.open(`/api/royal-red/preview/${artifact.id}/${artifact.entry}`, '_blank')}
          className="fixed bottom-36 right-4 z-30 max-w-[70vw] truncate rounded-full border border-red-600/50 bg-background/95 px-3.5 py-2 font-mono text-[11px] shadow-lg backdrop-blur md:hidden"
        >
          ARTIFACT: {artifact.name}
          {typeof artifact.score === 'number' ? ` / ${artifact.score}/10` : ''}
        </button>
      )}

      {/* sticky footer line */}
      <footer className="z-30 shrink-0 border-t bg-background px-4 py-1.5 text-center font-mono text-[10px] tracking-[0.25em] text-muted-foreground sm:px-6">
        <span className="sm:hidden"> ROYAL RED // KERNEL v1.3</span>
        <span className="hidden sm:inline">
           ROYAL RED // KERNEL v1.3 / SANDBOXED / EVERYTHING IT BUILDS IS PROOF-TESTED: LEDGER · CRITIC · SCREENSHOTS · CMS
        </span>
      </footer>
    </div>
  )
}
