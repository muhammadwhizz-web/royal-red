'use client'

import { create } from 'zustand'
import { toast } from '@/hooks/use-toast'
import type {
  ArtifactView,
  AwonMode,
  AwonSseEvent,
  ChatItem,
  ConsentPayload,
  LedgerItemView,
  PlanItem,
  SessionSummary,
} from '@/lib/awon/types'
import { MODE_LABELS, TOOL_LABELS } from '@/lib/awon/types'

let itemSeq = 0
const nextId = () => `i${++itemSeq}_${Date.now().toString(36)}`

const HELP_MARKDOWN = `### local command line

| command | what it does |
| --- | --- |
| /help | this cheat sheet |
| /new | fresh session, console resets |
| /sessions | open the session history sheet |
| /theme | flip dark / light mode |
| /export | download the current session as markdown |
| /export pdf | transcript as a paginated PDF |
| /export csv | transcript as a spreadsheet |
| /pdf, /csv | quick aliases for the exporters |
| /stats | console telemetry card (sessions, artifacts, workspace) |
| /plan | the current execution plan as a card |
| /verify | proof-test the current artifact (ledger, critique, screenshots, cms) |
| /verify benchmark <category> | also run the 10-site competitor matrix (saas-landing, portfolio, docs...) |
| /about | what this console is, version and modes |
| /files | jump to the FILES tab |
| /files workspace | FILES tab, workspace scope |
| /system | jump to the SYSTEM tab |
| /desktop | jump to the DESKTOP mission control tab |
| /preview | jump to the PREVIEW tab |

Mode shortcuts with no arguments switch the console instantly:
\`/build\` \`/research\` \`/pc\` \`/ask\`

With arguments they dispatch straight to the agent, like
\`/ask why is the sky blue\`.

Keyboard: \`ctrl+b\` toggles the preview panel, \`ctrl+j\` opens sessions,
\`ctrl+k\` opens the palette, \`/\` focuses this command line.

Everything else you type goes to the agent. Drop files on the composer or use
the paperclip to attach them; shell, fs, eyes, ears and the web reader are all
sandboxed.`

// shared by /export, /pdf and /csv: open the exporter for the active session
function exportTranscript(fmt: 'md' | 'pdf' | 'csv', push: (item: ChatItem) => void) {
  const sid = useAwon.getState().sessionId
  const typed = fmt === 'md' ? '/export' : `/${fmt}`
  if (!sid) {
    push({ kind: 'user', id: nextId(), text: typed })
    push({
      kind: 'event',
      id: nextId(),
      label: 'export',
      detail: 'no session to export yet; run a command first',
      status: 'err',
    })
    return
  }
  const label = fmt === 'md' ? 'markdown' : fmt.toUpperCase()
  push({ kind: 'user', id: nextId(), text: typed })
  window.open(`/api/awon/session/${sid}/export${fmt === 'md' ? '' : `?format=${fmt}`}`, '_blank')
  push({ kind: 'event', id: nextId(), label: 'export', detail: `${label} transcript opened in a new tab`, status: 'ok' })
}

// local slash commands: handled client side without touching the chat loop.
// Mode words WITH arguments fall through to the server (it parses the prefix);
// bare mode words switch the console locally. Returns true when consumed.
function handleLocalCommand(raw: string, push: (item: ChatItem) => void): boolean {
  const text = raw.trim()
  if (!text.startsWith('/')) return false
  const [cmd, rest] = [text.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '', text.slice(1 + text.slice(1).split(/\s+/)[0]?.length ?? 0).trim()]

  // mode words with arguments: server dispatch (unchanged path)
  if (['build', 'research', 'pc', 'ask'].includes(cmd) && rest) return false

  switch (cmd) {
    case 'help': {
      push({ kind: 'user', id: nextId(), text })
      push({ kind: 'assistant', id: nextId(), text: HELP_MARKDOWN })
      return true
    }
    case 'new': {
      useAwon.getState().reset()
      toast({ title: 'New session', description: 'AWON is listening.' })
      return true
    }
    case 'sessions': {
      push({ kind: 'user', id: nextId(), text })
      useAwon.setState({ sessionsOpen: true })
      return true
    }
    case 'theme': {
      push({ kind: 'user', id: nextId(), text })
      useAwon.setState({ themeToggleRequest: Date.now() })
      // placeholder detail: the ThemeCommandBridge (React context) rewrites it
      // with the ACTUAL new theme once next-themes resolves
      push({
        kind: 'event',
        id: nextId(),
        label: 'theme',
        detail: 'theme switching...',
        status: 'ok',
      })
      return true
    }
    case 'stats': {
      push({ kind: 'user', id: nextId(), text })
      const rowId = nextId()
      push({ kind: 'event', id: rowId, label: 'stats', detail: 'gathering console telemetry...', status: 'run' })
      void (async () => {
        const st = useAwon.getState()
        let ws: { files: number; bytes: number; byKind: Record<string, number> } | null = null
        try {
          const res = await fetch('/api/awon/workspace?stats=1')
          if (res.ok) {
            const data = (await res.json()) as { stats?: typeof ws }
            ws = data.stats ?? null
          }
        } catch {}
        const art = st.artifact
        const done = st.plan.filter((p) => p.done).length
        const kindMix = ws
          ? (['image', 'media', 'code', 'data', 'other'] as const)
              .filter((k) => (ws!.byKind[k] ?? 0) > 0)
              .map((k) => `${k} ${ws!.byKind[k]}`)
              .join(' / ')
          : ''
        const size =
          ws === null
            ? 'unavailable'
            : ws.bytes >= 1048576
              ? `${(ws.bytes / 1048576).toFixed(1)}MB`
              : `${Math.round(ws.bytes / 1024)}KB`
        const md = [
          '### console stats',
          '',
          '| metric | value |',
          '| --- | --- |',
          `| sessions on record | ${st.sessions.length} |`,
          `| current session | ${st.sessionTitle || 'none (fresh)'} |`,
          `| console mode | ${MODE_LABELS[st.mode]} |`,
          `| plan progress | ${st.plan.length ? `${done}/${st.plan.length} steps done` : 'no active plan'} |`,
          `| artifacts this session | ${st.artifacts.length}${art && typeof art.score === 'number' ? ` (latest scored ${art.score}/10)` : ''} |`,
          `| workspace | ${ws === null ? 'unavailable' : `${ws.files} file${ws.files === 1 ? '' : 's'}, ${size}`} |`,
          `| workspace mix | ${kindMix || (ws ? 'empty' : 'n/a')} |`,
          '',
          'type /help for every console command.',
        ].join('\n')
        useAwon.setState((s2) => ({
          items: s2.items.map((i): ChatItem => (i.id === rowId ? { kind: 'assistant', id: rowId, text: md } : i)),
        }))
      })()
      return true
    }
    case 'export': {
      const fmt = rest.toLowerCase()
      if (fmt === 'pdf') {
        exportTranscript('pdf', push)
        return true
      }
      if (fmt === 'csv') {
        exportTranscript('csv', push)
        return true
      }
      exportTranscript('md', push)
      return true
    }
    case 'pdf':
      exportTranscript('pdf', push)
      return true
    case 'csv':
      exportTranscript('csv', push)
      return true
    case 'plan': {
      push({ kind: 'user', id: nextId(), text })
      const plan = useAwon.getState().plan
      const md = plan.length
        ? [
            '### execution plan',
            '',
            '| # | step | status |',
            '| --- | --- | --- |',
            ...plan.map((p, i) => `| ${i + 1} | ${p.title.replace(/\|/g, '/')} | ${p.done ? 'done' : 'pending'} |`),
            '',
            `${plan.filter((p) => p.done).length} of ${plan.length} steps complete.`,
          ].join('\n')
        : 'no active plan. plans appear here while the builder works.'
      push({ kind: 'assistant', id: nextId(), text: md })
      return true
    }
    case 'about': {
      push({ kind: 'user', id: nextId(), text })
      push({
        kind: 'assistant',
        id: nextId(),
        text: [
          '### about this console',
          '',
          '| | |',
          '| --- | --- |',
          '| kernel | AWON V1.0, linux native |',
          '| shape | an operating system for agents, living inside this page |',
          '| modes | builder, research, system, assist |',
          '| senses | image generation, vision checks, video watching, web search, page reading |',
          '| hands | sandboxed shell, workspace filesystem, account management |',
          '| memory | every session, artifact and workspace file survives reloads |',
          '',
          'it plans, builds, verifies its own work to a score, and ships artifacts',
          'you can preview, diff and download. type /help for the command line.',
        ].join('\n'),
      })
      return true
    }
    case 'verify': {
      push({ kind: 'user', id: nextId(), text })
      const st = useAwon.getState()
      if (!st.artifact) {
        push({ kind: 'event', id: nextId(), label: 'verify', detail: 'no artifact to verify yet; run a build first', status: 'err' })
        return true
      }
      const benchArg = rest.toLowerCase().startsWith('benchmark') ? rest.toLowerCase().split(/\s+/)[1] : undefined
      push({ kind: 'event', id: nextId(), label: 'verify', detail: benchArg ? `running verification 2.0 + ${benchArg} benchmark on ${st.artifact.name}...` : `running verification 2.0 on ${st.artifact.name}...`, status: 'run' })
      void st.rerunVerification(benchArg).then(() => {
        useAwon.setState((s2) => ({
          items: s2.items.filter((i) => !(i.kind === 'event' && i.label === 'verify' && i.status === 'run' && i.detail?.startsWith('running verification'))),
        }))
      })
      return true
    }
    case 'files': {
      push({ kind: 'user', id: nextId(), text })
      const arg = rest.toLowerCase()
      const scope = arg === 'workspace' || arg === 'ws' ? 'workspace' : arg === 'artifact' ? 'artifact' : null
      useAwon.setState(scope ? { panelTab: 'files', filesScope: scope } : { panelTab: 'files' })
      push({
        kind: 'event',
        id: nextId(),
        label: 'panel',
        detail: scope ? `FILES tab opened on ${scope.toUpperCase()} scope` : 'right panel switched to FILES',
        status: 'ok',
      })
      return true
    }
    case 'system':
    case 'desktop':
    case 'preview': {
      push({ kind: 'user', id: nextId(), text })
      const tab = cmd === 'system' ? 'system' : cmd === 'desktop' ? 'desktop' : 'preview'
      useAwon.setState({ panelTab: tab })
      push({ kind: 'event', id: nextId(), label: 'panel', detail: `right panel switched to ${tab.toUpperCase()}`, status: 'ok' })
      return true
    }
    case 'build':
    case 'research':
    case 'pc':
    case 'ask': {
      push({ kind: 'user', id: nextId(), text })
      useAwon.getState().setMode(cmd as AwonMode)
      push({ kind: 'event', id: nextId(), label: 'mode', detail: `console mode set to ${MODE_LABELS[cmd as AwonMode]}`, status: 'ok' })
      return true
    }
    default:
      // unknown slash word: never send it to the model (it is not a command)
      push({ kind: 'user', id: nextId(), text })
      push({
        kind: 'event',
        id: nextId(),
        label: 'unknown command',
        detail: `"/${cmd}" is not a console command. type /help for the list.`,
        status: 'err',
      })
      return true
  }
}

interface TurnStats {
  secs: number
  tools: number
}

// verification receipts (Phase 2): latest per kind, rendered in the VERIFY tab
export interface VerifyReceipt {
  kind: string
  status: string
  summary?: string
  data?: unknown
  at: number
}

export interface AwonState {
  booted: boolean
  themeToggleRequest: number
  streaming: boolean
  phase: string | null
  phaseStartedAt: number | null
  sessionId: string | null
  sessionTitle: string
  sessions: SessionSummary[]
  sessionsCursor: string | null
  sessionsHasMore: boolean
  sessionsLoadingMore: boolean
  items: ChatItem[]
  mode: AwonMode
  plan: PlanItem[]
  artifact: ArtifactView | null
  artifacts: ArtifactView[]
  activeFile: string | null
  previewKey: number
  panelTab: 'preview' | 'files' | 'verify' | 'system' | 'desktop'
  filesScope: 'artifact' | 'workspace'
  panelHidden: boolean
  systemOpen: boolean
  sessionsOpen: boolean
  paletteOpen: boolean
  lastCommand: string | null
  turnStats: TurnStats | null
  constraints: LedgerItemView[]
  verifyReceipts: Record<string, VerifyReceipt>
  verifying: boolean

  setBooted: () => void
  setMode: (m: AwonMode) => void
  setSystemOpen: (v: boolean) => void
  setSessionsOpen: (v: boolean) => void
  setSessions: (s: SessionSummary[]) => void
  refreshSessions: () => Promise<void>
  loadMoreSessions: () => Promise<void>
  setActiveFile: (p: string | null) => void
  setPanelTab: (t: 'preview' | 'files' | 'verify' | 'system' | 'desktop') => void
  setFilesScope: (s: 'artifact' | 'workspace') => void
  setPanelHidden: (v: boolean) => void
  selectArtifact: (id: string) => void
  reset: () => void
  loadSession: (id: string) => Promise<void>
  loadVerifications: (sessionId: string) => Promise<void>
  rerunVerification: (benchmark?: string) => Promise<void>
  applyEvent: (e: AwonSseEvent) => void
  answerConsent: (id: string, decision: 'approve' | 'deny' | 'modify' | 'rule', ruleText?: string) => Promise<void>
  send: (text: string) => Promise<void>
  stop: () => void
}

let activeAbort: AbortController | null = null
// per-turn telemetry, filled by the SSE handlers (client-side only)
let turnStart = 0
let turnToolCount = 0

const SESSION_PAGE = 50

async function refreshSessions(set: (p: Partial<AwonState>) => void) {
  try {
    const res = await fetch(`/api/awon/session?limit=${SESSION_PAGE}`)
    const data = (await res.json()) as { sessions: SessionSummary[]; nextCursor: string | null }
    set({
      sessions: data.sessions ?? [],
      sessionsCursor: data.nextCursor ?? null,
      sessionsHasMore: !!data.nextCursor,
    })
  } catch {}
}

export const useAwon = create<AwonState>((set, get) => ({
  booted: false,
  themeToggleRequest: 0,
  streaming: false,
  phase: null,
  phaseStartedAt: null,
  sessionId: null,
  sessionTitle: '',
  sessions: [],
  sessionsCursor: null,
  sessionsHasMore: false,
  sessionsLoadingMore: false,
  items: [],
  mode: 'build',
  plan: [],
  artifact: null,
  artifacts: [],
  activeFile: null,
  previewKey: 0,
  panelTab: 'preview',
  filesScope: 'artifact',
  panelHidden: false,
  systemOpen: false,
  sessionsOpen: false,
  paletteOpen: false,
  lastCommand: null,
  turnStats: null,
  constraints: [],
  verifyReceipts: {},
  verifying: false,

  setBooted: () => set({ booted: true }),
  setMode: (m) => set({ mode: m }),
  setSystemOpen: (v) => set({ systemOpen: v }),
  setSessionsOpen: (v) => set({ sessionsOpen: v }),
  setSessions: (s) => set({ sessions: s }),
  refreshSessions: () => refreshSessions(set),
  loadMoreSessions: async () => {
    const st = get()
    if (!st.sessionsCursor || st.sessionsLoadingMore || st.sessionsHasMore === false) return
    set({ sessionsLoadingMore: true })
    try {
      const res = await fetch(`/api/awon/session?limit=${SESSION_PAGE}&cursor=${encodeURIComponent(st.sessionsCursor)}`)
      const data = (await res.json()) as { sessions: SessionSummary[]; nextCursor: string | null }
      const fresh = (data.sessions ?? []).filter((s) => !st.sessions.some((x) => x.id === s.id))
      set({
        sessions: [...st.sessions, ...fresh],
        sessionsCursor: data.nextCursor ?? null,
        sessionsHasMore: !!data.nextCursor,
        sessionsLoadingMore: false,
      })
    } catch {
      set({ sessionsLoadingMore: false })
    }
  },
  setActiveFile: (p) => set({ activeFile: p }),
  setPanelTab: (t) => set({ panelTab: t }),
  setFilesScope: (s) => set({ filesScope: s }),
  setPanelHidden: (v) => set({ panelHidden: v }),

  selectArtifact: (id) => {
    const st = get()
    const pick = st.artifacts.find((a) => a.id === id)
    if (!pick) return
    set({
      artifact: pick,
      activeFile: pick.entry,
      previewKey: st.previewKey + 1,
      panelTab: 'preview',
    })
  },

  reset: () =>
    set({
      sessionId: null,
      sessionTitle: '',
      items: [],
      plan: [],
      artifact: null,
      artifacts: [],
      activeFile: null,
      streaming: false,
      phase: null,
      panelTab: 'preview',
      filesScope: 'artifact',
      lastCommand: null,
      constraints: [],
      verifyReceipts: {},
      verifying: false,
    }),

  loadSession: async (id) => {
    try {
      const res = await fetch(`/api/awon/session/${id}`)
      if (!res.ok) return
      const data = (await res.json()) as {
        session: { id: string; title: string; mode: string }
        messages: { id: string; role: string; content: string; meta: PlanItemMeta | null }[]
        artifacts: ArtifactView[]
      }
      const items: ChatItem[] = []
      for (const m of data.messages) {
        if (m.role === 'user') items.push({ kind: 'user', id: m.id, text: m.content })
        else if (m.content && m.content !== '(working)') items.push({ kind: 'assistant', id: m.id, text: m.content })
        // restore tool event rows so reloaded sessions keep their audit trail
        const meta = m.meta as
          | { tools?: { name: string; ok: boolean; summary: string; output?: string }[] }
          | null
        for (const t of meta?.tools ?? []) {
          items.push({
            kind: 'event',
            id: `${m.id}:tool:${t.name}:${items.length}`,
            label: TOOL_LABELS[t.name] ?? t.name,
            detail: t.summary,
            output: t.output,
            status: t.ok ? 'ok' : 'err',
          })
        }
      }
      const latest = data.artifacts[0] ?? null
      set({
        sessionId: data.session.id,
        sessionTitle: data.session.title,
        mode: (['build', 'research', 'pc', 'ask'].includes(data.session.mode)
          ? data.session.mode
          : 'ask') as AwonMode,
        items,
        plan: latestPlanFromMeta(data.messages),
        artifacts: data.artifacts,
        artifact: latest,
        activeFile: latest?.entry ?? null,
        previewKey: get().previewKey + 1,
        panelTab: latest ? 'preview' : get().panelTab,
        sessionsOpen: false,
      })
      // restore persisted verification receipts alongside the chat history
      void get().loadVerifications(id)
    } catch {}
  },

  loadVerifications: async (sessionId) => {
    try {
      const res = await fetch(`/api/awon/verify?sessionId=${encodeURIComponent(sessionId)}&constraints=1`)
      if (!res.ok) return
      const data = (await res.json()) as {
        verifications: { kind: string; status: string; data: unknown; createdAt: string }[]
        constraints?: LedgerItemView[]
      }
      // latest receipt per kind from persisted history
      const byKind: Record<string, VerifyReceipt> = {}
      for (const v of data.verifications ?? []) {
        if (byKind[v.kind]) continue
        byKind[v.kind] = { kind: v.kind, status: v.status, data: v.data, summary: undefined, at: new Date(v.createdAt).getTime() }
      }
      set({ verifyReceipts: byKind })
      // restore the ledger card into the chat when the session has constraints
      const cs = data.constraints ?? []
      if (cs.length) {
        set({ constraints: cs })
        const st = get()
        const hasCard = st.items.some((i) => i.kind === 'assistant' && i.text.includes('constraint ledger ('))
        if (!hasCard) {
          const md = [
            `### constraint ledger (${cs.length})`,
            '',
            'extracted from your command before the build; graded per constraint in the VERIFY tab.',
            '',
            '| id | type | requirement |',
            '| --- | --- | --- |',
            ...cs.map((c) => `| ${c.cid} | ${c.category}${c.weight === 2 ? ' · must' : ''} | ${c.text.replace(/\|/g, '/').slice(0, 90)} |`),
          ].join('\n')
          set({ items: [...st.items, { kind: 'assistant', id: nextId(), text: md }] })
        }
      }
    } catch {}
  },

  rerunVerification: async (benchmark) => {
    const st = get()
    if (!st.sessionId || !st.artifact || st.verifying) return
    set({ verifying: true, panelTab: 'verify' })
    try {
      const res = await fetch('/api/awon/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: st.sessionId, artifactId: st.artifact.id, benchmark }),
      })
      if (!res.ok) {
        toast({ title: 'Verification failed', description: `the kernel returned ${res.status}` })
        return
      }
      const data = (await res.json()) as Record<string, { status?: string; summary?: string } | null>
      const receipts: Record<string, VerifyReceipt> = {}
      const labels: Record<string, string> = { ledger: 'constraint ledger', critique: 'adversarial critique', visual: 'visual regression', cms: 'cms panel', benchmark: 'competitor benchmark' }
      for (const [kind, r] of Object.entries(data)) {
        if (!r) continue
        receipts[kind] = { kind, status: String(r.status ?? 'unverified'), summary: r.summary, data: r, at: Date.now() }
      }
      set((s2) => ({ verifyReceipts: { ...s2.verifyReceipts, ...receipts }, verifying: false }))
      toast({ title: 'Verification complete', description: Object.keys(receipts).map((k) => labels[k] ?? k).join(' · ') })
    } catch (e) {
      set({ verifying: false })
      toast({ title: 'Verification error', description: (e as Error).message.slice(0, 120) })
    }
  },

  applyEvent: (e) => {
    const s = get()
    switch (e.type) {
      case 'session':
        set({ sessionId: e.id, sessionTitle: e.title })
        void refreshSessions(set)
        break
      case 'phase':
        set({ phase: e.value, phaseStartedAt: Date.now() })
        break
      case 'mode':
        set({ mode: e.value })
        break
      case 'say': {
        const item: ChatItem = {
          kind: 'assistant',
          id: nextId(),
          text: e.text,
          fresh: true,
        }
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push(item)
        set({ items })
        break
      }
      case 'plan':
        set({ plan: e.plan })
        break
      case 'constraints': {
        set({ constraints: e.items })
        // the ledger is a product surface: show the extracted constraints in
        // the chat stream BEFORE the build starts (acceptance-test receipt)
        if (e.items.length) {
          const md = [
            `### constraint ledger (${e.items.length})`,
            '',
            'the kernel extracted these testable constraints from your command. the verification engine will grade the finished artifact against each one and report per-constraint receipts.',
            '',
            '| id | type | requirement |',
            '| --- | --- | --- |',
            ...e.items.map((c) => `| ${c.cid} | ${c.category}${c.weight === 2 ? ' · must' : ''} | ${c.text.replace(/\|/g, '/').slice(0, 90)} |`),
            '',
            'full receipts land in the VERIFY tab when the build finishes.',
          ].join('\n')
          const items = s.items.filter((i) => i.kind !== 'phase')
          items.push({ kind: 'assistant', id: nextId(), text: md, fresh: true })
          set({ items })
        }
        break
      }
      case 'verify': {
        const receipt: VerifyReceipt = {
          kind: e.kind,
          status: e.status,
          summary: e.summary,
          data: e.data,
          at: Date.now(),
        }
        set((st) => ({
          verifyReceipts: { ...st.verifyReceipts, [e.kind]: receipt },
          verifying: e.status === 'run',
        }))
        // stream a compact audit row into the chat too
        if (e.status !== 'run') {
          const items = s.items.filter((i) => i.kind !== 'phase')
          items.push({
            kind: 'event',
            id: nextId(),
            label: `verify ${e.kind}`,
            detail: e.summary,
            status: e.status === 'pass' ? 'ok' : e.status === 'error' || e.status === 'fail' ? 'err' : 'ok',
          })
          set({ items })
        }
        break
      }
      case 'tool_start': {
        const item: ChatItem = {
          kind: 'event',
          id: nextId(),
          label: e.label,
          status: 'run',
        }
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push(item)
        set({ items })
        break
      }
      case 'tool_end': {
        turnToolCount++
        const items = [...s.items]
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]
          if (it.kind === 'event' && it.status === 'run') {
            items[i] = {
              ...it,
              kind: 'event',
              label: it.label,
              detail: e.summary,
              output: e.output,
              status: e.ok ? 'ok' : 'err',
            }
            break
          }
        }
        set({ items })
        break
      }
      case 'artifact': {
        // merge: keep local file contents for known paths, add new paths as empty
        // (the Files tab fetches full contents for anything missing)
        const prevFiles = s.artifact && s.artifact.id === e.id ? s.artifact.files : []
        const byPath = new Map(prevFiles.map((f) => [f.path, f.content]))
        const merged = e.files.map((p) => ({ path: p, content: byPath.get(p) ?? '' }))
        const next: ArtifactView = {
          id: e.id,
          name: e.name,
          entry: e.entry,
          score: e.score,
          review: e.review,
          files: merged,
        }
        // upsert into the session artifact list (newest first), keep other artifacts intact
        const rest = s.artifacts.filter((a) => a.id !== e.id)
        const prior = s.artifacts.find((a) => a.id === e.id)
        const mergedFull: ArtifactView = {
          ...next,
          files: next.files.length ? next.files : (prior?.files ?? []),
        }
        set({
          artifact: mergedFull,
          artifacts: [mergedFull, ...rest],
          activeFile: e.entry,
          previewKey: s.previewKey + 1,
          panelTab: s.panelTab === 'system' ? 'preview' : s.panelTab,
        })
        break
      }
      case 'error': {
        const item: ChatItem = {
          kind: 'event',
          id: nextId(),
          label: 'error',
          detail: e.message,
          status: 'err',
        }
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push(item)
        set({ items })
        break
      }
      case 'done':
        set((st) => ({
          streaming: false,
          phase: null,
          turnStats:
            turnStart > 0
              ? {
                  secs: Math.round(((Date.now() - turnStart) / 1000) * 10) / 10,
                  tools: turnToolCount,
                }
              : st.turnStats,
        }))
        turnStart = 0
        void refreshSessions(set)
        break
      // ── Phase 4: permitted PC control ───────────────────────────────
      case 'consent_request': {
        const item: ChatItem = {
          kind: 'consent',
          id: e.id,
          tier: e.tier,
          title: e.title,
          detail: e.detail,
          payload: (e.payload ?? undefined) as ConsentPayload | undefined,
          status: 'pending',
          expiresAt: e.expiresAt,
        }
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push(item)
        set({ items })
        break
      }
      case 'consent_result': {
        const items = s.items.map((i) =>
          i.kind === 'consent' && i.id === e.id
            ? { ...i, status: e.status as 'approved' | 'denied' | 'expired' | 'frozen' }
            : i,
        )
        set({ items })
        break
      }
      case 'desktop_plan':
        // the plan arrives with its consent card; nothing extra to render here
        break
      case 'desktop_step': {
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push({
          kind: 'event',
          id: nextId(),
          label: `step ${e.seq} · ${e.op}`,
          detail: e.detail,
          status: e.ok ? 'ok' : 'err',
        })
        set({ items })
        break
      }
      case 'desktop_run': {
        const items = s.items.filter((i) => i.kind !== 'phase')
        items.push({
          kind: 'event',
          id: nextId(),
          label: e.status === 'running' ? `run ${e.runId} started` : e.status === 'aborted' ? `run ${e.runId} ABORTED` : `run ${e.runId} done`,
          detail: e.status === 'running' ? `0/${e.total} actions` : `${e.executed ?? 0}/${e.total} actions executed`,
          status: e.status === 'aborted' ? 'err' : 'ok',
        })
        set({ items })
        break
      }
    }
  },

  answerConsent: async (id, decision, ruleText) => {
    // optimistic: the card flips immediately; the kernel resolves the paused turn
    const items = get().items.map((i) =>
      i.kind === 'consent' && i.id === id ? { ...i, status: decision === 'deny' ? 'denied' : 'approved', decision } : i,
    )
    set({ items })
    try {
      const res = await fetch(`/api/awon/desktop/consent/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ruleText }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string }
        // the kernel refused (late answer, already expired/frozen): show truth
        const reverted = get().items.map((i) =>
          i.kind === 'consent' && i.id === id
            ? { ...i, status: (data.status as 'expired' | 'frozen' | 'denied') ?? 'expired', decision: undefined }
            : i,
        )
        set({ items: reverted })
        toast({ title: 'Consent not applied', description: data.error ?? 'the request is no longer answerable' })
      }
    } catch (e) {
      toast({ title: 'Consent error', description: (e as Error).message.slice(0, 120) })
    }
  },

  send: async (text) => {
    const s = get()
    if (!text.trim() || s.streaming) return
    // local slash commands never touch the SSE loop
    if (text.trim().startsWith('/')) {
      const consumed = handleLocalCommand(text, (item) => {
        const st = get()
        set({ items: [...st.items.filter((i) => i.kind !== 'phase'), item] })
      })
      if (consumed) return
    }
    turnStart = Date.now()
    turnToolCount = 0
    const userItem: ChatItem = { kind: 'user', id: nextId(), text }
    set({
      items: [...s.items, userItem],
      streaming: true,
      phase: 'dispatching',
      phaseStartedAt: Date.now(),
      systemOpen: false,
      sessionsOpen: false,
      lastCommand: text,
      turnStats: null,
    })
    activeAbort = new AbortController()
    try {
      const res = await fetch('/api/awon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: s.sessionId, message: text, mode: s.mode }),
        signal: activeAbort.signal,
      })
      if (!res.ok || !res.body) {
        get().applyEvent({ type: 'error', message: `AWON link failed (${res.status})` })
        get().applyEvent({ type: 'done' })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          try {
            const evt = JSON.parse(line.slice(6)) as AwonSseEvent
            get().applyEvent(evt)
          } catch {}
        }
      }
      // fetch artifact file contents for Files tab
      const art = get().artifact
      if (art && art.files.length === 0 && s.sessionId) {
        try {
          const res2 = await fetch(`/api/awon/session/${get().sessionId}`)
          if (res2.ok) {
            const data = (await res2.json()) as { artifacts: ArtifactView[] }
            const match = data.artifacts.find((a) => a.id === art.id)
            if (match) set({ artifact: match })
          }
        } catch {}
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      if (aborted) {
        const stopped: ChatItem = {
          kind: 'event',
          id: nextId(),
          label: 'stopped by user',
          detail: 'the current turn was cut loose; history and artifacts are safe.',
          status: 'ok',
        }
        set((st) => ({ items: [...st.items.filter((i) => i.kind !== 'phase'), stopped] }))
      } else {
        get().applyEvent({ type: 'error', message: (e as Error).message })
      }
    } finally {
      set({ streaming: false, phase: null, phaseStartedAt: null })
      activeAbort = null
    }
  },

  stop: () => {
    activeAbort?.abort()
    // any tool row still spinning is now interrupted; the server loop stops too
    // (chat route wires req.signal into the agent loop)
    set((st) => ({
      items: st.items.map((i) =>
        i.kind === 'event' && i.status === 'run'
          ? { ...i, status: 'err' as const, detail: i.detail ?? 'interrupted by user' }
          : i,
      ),
    }))
  },
}))

type PlanItemMeta = { plan?: PlanItem[] } | null

function latestPlanFromMeta(
  messages: { role: string; meta: PlanItemMeta | null }[],
): PlanItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.meta?.plan?.length) return m.meta.plan
  }
  return []
}
