'use client'

import { useEffect } from 'react'
import {
  ArrowLeftRight,
  Download,
  FileDown,
  FlaskConical,
  FolderTree,
  Gauge,
  Hammer,
  History,
  KeyRound,
  Moon,
  PanelRight,
  Plus,
  Rss,
  ScanEye,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useRoyalRed } from './store'
import { MODE_LABELS, type RoyalRedMode } from '@/lib/royal-red/types'

const MODE_ICONS: Record<RoyalRedMode, typeof Hammer> = {
  build: Hammer,
  research: Search,
  pc: Terminal,
  ask: FlaskConical,
}

// Ctrl+K / Cmd+K launcher: the OS-within-OS surface for quick actions,
// mode switches and recent sessions. Pure client; never touches the chat loop.
export function CommandPalette() {
  const sessions = useRoyalRed((s) => s.sessions)
  const setSessionsOpen = useRoyalRed((s) => s.setSessionsOpen)
  const loadSession = useRoyalRed((s) => s.loadSession)
  const reset = useRoyalRed((s) => s.reset)
  const mode = useRoyalRed((s) => s.mode)
  const setMode = useRoyalRed((s) => s.setMode)
  const sessionId = useRoyalRed((s) => s.sessionId)
  const sessionTitle = useRoyalRed((s) => s.sessionTitle)
  const open = useRoyalRed((s) => s.paletteOpen)
  const { resolvedTheme, setTheme } = useTheme()

  const setOpen = (v: boolean) => useRoyalRed.setState({ paletteOpen: v })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useRoyalRed.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  const recent = sessions.slice(0, 8)

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="type a command or search sessions..." />
      <CommandList className="font-mono">
        <CommandEmpty>nothing matches.</CommandEmpty>
        <CommandGroup heading="ACTIONS">
          <CommandItem onSelect={() => run(reset)}>
            <Plus className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            new session
          </CommandItem>
          <CommandItem onSelect={() => run(() => setSessionsOpen(true))}>
            <History className="h-3.5 w-3.5" />
            open session history
          </CommandItem>
          <CommandItem onSelect={() => run(() => void useRoyalRed.getState().send('/stats'))}>
            <Gauge className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            console stats
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))
            }
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
            switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
          </CommandItem>
          {sessionId && (
            <>
              <CommandItem
                onSelect={() =>
                  run(() => window.open(`/api/royal-red/session/${sessionId}/export`, '_blank'))
                }
              >
                <Download className="h-3.5 w-3.5" />
                export current session as markdown
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(() =>
                    window.open(`/api/royal-red/session/${sessionId}/export?format=pdf`, '_blank'),
                  )
                }
              >
                <FileDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                export current session as pdf
              </CommandItem>
            </>
          )}
          <CommandItem
            onSelect={() =>
              run(() => useRoyalRed.setState((st) => ({ panelHidden: !st.panelHidden })))
            }
          >
            <PanelRight className="h-3.5 w-3.5" />
            toggle preview panel
            <span className="ml-auto text-[10px] text-muted-foreground">ctrl+b</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                const st = useRoyalRed.getState()
                if (!st.artifact) return
                void st.rerunVerification()
              })
            }
          >
            <ScanEye className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            proof-test current artifact (verification 2.0)
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => useRoyalRed.setState({ panelTab: 'verify' }))
            }
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            open the verification dashboard
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="PANELS">
          {(
            [
              { id: 'preview', label: 'preview the live artifact', icon: PanelRight },
              { id: 'files', label: 'workspace files', icon: FolderTree },
              { id: 'verify', label: 'verification dashboard (receipts)', icon: ShieldCheck },
              { id: 'system', label: 'system: box, consent, undo journal', icon: Gauge },
              { id: 'desktop', label: 'desktop mission control (kill switch)', icon: ScanEye },
              { id: 'providers', label: 'providers: api keys + health', icon: KeyRound },
              { id: 'router', label: 'router: matrix + rotation drill', icon: ArrowLeftRight },
              { id: 'events', label: 'event log: replay + integrity', icon: Rss },
            ] as const
          ).map((t) => (
            <CommandItem
              key={t.id}
              onSelect={() =>
                run(() =>
                  useRoyalRed.setState({ panelTab: t.id, panelHidden: false }),
                )
              }
            >
              <t.icon className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              {t.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="MODES">
          {(Object.keys(MODE_LABELS) as RoyalRedMode[]).map((m) => {
            const Icon = MODE_ICONS[m]
            return (
              <CommandItem key={m} onSelect={() => run(() => setMode(m))}>
                <Icon className="h-3.5 w-3.5" />
                {MODE_LABELS[m].toLowerCase()}
                {mode === m && (
                  <span className="ml-auto text-[10px] text-red-600 dark:text-red-400">
                    active
                  </span>
                )}
              </CommandItem>
            )
          })}
        </CommandGroup>
        {recent.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="RECENT SESSIONS">
              {recent.map((s) => (
                <CommandItem key={s.id} onSelect={() => run(() => void loadSession(s.id))}>
                  <span className="min-w-0 truncate">
                    {s.pinned ? '· ' : ''}
                    {s.title}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {s.mode}
                  </span>
                </CommandItem>
              ))}
              <CommandItem onSelect={() => run(() => setSessionsOpen(true))}>
                <span className="text-muted-foreground">see all sessions...</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
        {sessionId && sessionTitle && (
          <>
            <CommandSeparator />
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
              current: {sessionTitle}
            </div>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
