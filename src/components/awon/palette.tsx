'use client'

import { useEffect } from 'react'
import {
  Download,
  FileDown,
  FlaskConical,
  Gauge,
  Hammer,
  History,
  Moon,
  PanelRight,
  Plus,
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
import { useAwon } from './store'
import { MODE_LABELS, type AwonMode } from '@/lib/awon/types'

const MODE_ICONS: Record<AwonMode, typeof Hammer> = {
  build: Hammer,
  research: Search,
  pc: Terminal,
  ask: FlaskConical,
}

// Ctrl+K / Cmd+K launcher: the OS-within-OS surface for quick actions,
// mode switches and recent sessions. Pure client; never touches the chat loop.
export function CommandPalette() {
  const sessions = useAwon((s) => s.sessions)
  const setSessionsOpen = useAwon((s) => s.setSessionsOpen)
  const loadSession = useAwon((s) => s.loadSession)
  const reset = useAwon((s) => s.reset)
  const mode = useAwon((s) => s.mode)
  const setMode = useAwon((s) => s.setMode)
  const sessionId = useAwon((s) => s.sessionId)
  const sessionTitle = useAwon((s) => s.sessionTitle)
  const open = useAwon((s) => s.paletteOpen)
  const { resolvedTheme, setTheme } = useTheme()

  const setOpen = (v: boolean) => useAwon.setState({ paletteOpen: v })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useAwon.getState().paletteOpen)
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
            <Plus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            new session
          </CommandItem>
          <CommandItem onSelect={() => run(() => setSessionsOpen(true))}>
            <History className="h-3.5 w-3.5" />
            open session history
          </CommandItem>
          <CommandItem onSelect={() => run(() => void useAwon.getState().send('/stats'))}>
            <Gauge className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
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
                  run(() => window.open(`/api/awon/session/${sessionId}/export`, '_blank'))
                }
              >
                <Download className="h-3.5 w-3.5" />
                export current session as markdown
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(() =>
                    window.open(`/api/awon/session/${sessionId}/export?format=pdf`, '_blank'),
                  )
                }
              >
                <FileDown className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                export current session as pdf
              </CommandItem>
            </>
          )}
          <CommandItem
            onSelect={() =>
              run(() => useAwon.setState((st) => ({ panelHidden: !st.panelHidden })))
            }
          >
            <PanelRight className="h-3.5 w-3.5" />
            toggle preview panel
            <span className="ml-auto text-[10px] text-muted-foreground">ctrl+b</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                const st = useAwon.getState()
                if (!st.artifact) return
                void st.rerunVerification()
              })
            }
          >
            <ScanEye className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            proof-test current artifact (verification 2.0)
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => useAwon.setState({ panelTab: 'verify' }))
            }
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            open the verification dashboard
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="MODES">
          {(Object.keys(MODE_LABELS) as AwonMode[]).map((m) => {
            const Icon = MODE_ICONS[m]
            return (
              <CommandItem key={m} onSelect={() => run(() => setMode(m))}>
                <Icon className="h-3.5 w-3.5" />
                {MODE_LABELS[m].toLowerCase()}
                {mode === m && (
                  <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">
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
