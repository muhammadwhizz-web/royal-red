'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  Film,
  FolderTree,
  GitCompare,
  HardDrive,
  History,
  ImageIcon,
  Layers,
  Loader2,
  Monitor,
  MonitorPlay,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { useRoyalRed, type PanelTab } from './store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EventsTab } from './events-tab'
import { MemoryTab } from './memory-tab'
import { AgentsTab } from './agents-tab'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VerifyTab } from './verify-tab'
import { DesktopTab } from './desktop-tab'
import { ProvidersTab } from './providers-tab'
import { SettingsTab } from './settings-tab'
import { RouterTab } from './router-tab'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i
// mirror of the server TEXT_EDIT_EXTS allowlist (server lib imports fs, cannot
// be pulled into the client)
const TEXT_EDIT_FILE = /\.(txt|md|json|csv|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|svg|xml|ya?ml|toml|ini|conf|env|log|rs|go|c|cpp|h|java|rb|php|sql)$/i

function sizeLabel(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

// line diff via LCS (bounded so the DP table stays small): returns unified rows
// with line numbers, ready for red/green rendering
const DIFF_LINE_CAP = 1200
type DiffRow = { type: 'add' | 'del' | 'same'; text: string; oldNo: number | null; newNo: number | null }
type VersionRow = {
  versionId: string
  artifactId: string
  artifactName: string
  version: number
  note: string | null
  createdAt: string
}

function diffLines(a: string, b: string): DiffRow[] {
  const A = a.split('\n')
  const B = b.split('\n')
  if (A.length > DIFF_LINE_CAP || B.length > DIFF_LINE_CAP) {
    A.length = Math.min(A.length, DIFF_LINE_CAP)
    B.length = Math.min(B.length, DIFF_LINE_CAP)
    A.push('... truncated at 1200 lines for the diff engine')
    B.push('... truncated at 1200 lines for the diff engine')
  }
  const n = A.length
  const m = B.length
  const dp = new Int32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = A[i] === B[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  const push = (type: DiffRow['type'], text: string) => {
    rows.push({
      type,
      text,
      oldNo: type === 'add' ? null : oldNo++,
      newNo: type === 'del' ? null : newNo++,
    })
  }
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i])
      i++
      j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      push('del', A[i])
      i++
    } else {
      push('add', B[j])
      j++
    }
  }
  while (i < n) {
    push('del', A[i++])
  }
  while (j < m) {
    push('add', B[j++])
  }
  return rows
}

// unified diff with 2 lines of context around every change
function DiffView({ oldText, newText, label }: { oldText: string; newText: string; label: string }) {
  const rows = useMemo(() => diffLines(oldText, newText), [oldText, newText])
  const adds = rows.filter((r) => r.type === 'add').length
  const dels = rows.filter((r) => r.type === 'del').length
  const show = rows.map((r, i) => {
    if (r.type !== 'same') return true
    for (let k = Math.max(0, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) {
      if (rows[k].type !== 'same') return true
    }
    return false
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-1.5 font-mono text-[10px]">
        <span className="tracking-[0.2em] text-muted-foreground">DIFF {label}</span>
        <span className="rounded-full border border-emerald-600/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">+{adds}</span>
        <span className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">-{dels}</span>
        <span className="ml-auto text-muted-foreground/70">red = previous / green = current</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2 font-mono text-[11px] leading-[1.45]">
          {rows.map((r, i) => {
            if (!show[i]) {
              const prevShown = i > 0 && show[i - 1]
              return prevShown ? (
                <div key={i} className="select-none py-0.5 text-center text-muted-foreground/40">...</div>
              ) : null
            }
            const rowCls =
              r.type === 'add'
                ? 'border-l-2 border-l-red-500/70 bg-red-500/10 text-red-800 dark:text-red-200'
                : r.type === 'del'
                  ? 'border-l-2 border-l-red-500/60 bg-red-500/10 text-red-800 dark:text-red-200'
                  : 'border-l-2 border-l-transparent'
            return (
              <div key={i} className={cn('flex gap-2 rounded-sm px-1', rowCls)}>
                <span className="w-8 shrink-0 select-none text-right text-muted-foreground/45 tabular-nums">{r.oldNo ?? ''}</span>
                <span className="w-8 shrink-0 select-none text-right text-muted-foreground/45 tabular-nums">{r.newNo ?? ''}</span>
                <span className="w-3 shrink-0 select-none text-muted-foreground/60">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ''}</span>
                <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{r.text || ' '}</span>
              </div>
            )
          })}
          {adds + dels === 0 && (
            <p className="p-3 text-center text-muted-foreground">identical to the previous artifact.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// workspace file icon: images, videos, code, data, everything else
function wsIcon(p: string): { Icon: typeof FileText; cls: string } {
  if (IMAGE_FILE.test(p)) return { Icon: ImageIcon, cls: 'text-emerald-600 dark:text-emerald-400' }
  if (/\.(mp4|webm|mov|mkv|avi|mp3|wav)$/i.test(p)) return { Icon: Film, cls: 'text-violet-600 dark:text-violet-400' }
  if (/\.(py|js|ts|sh|json|html|css|rs|go|c|cpp)$/i.test(p)) return { Icon: FileCode2, cls: 'text-sky-600 dark:text-sky-400' }
  return { Icon: FileText, cls: 'text-muted-foreground' }
}

interface WsFile {
  path: string
  size: number
}

// inline inspector + editor for a single workspace file: images render,
// text files open in an editable buffer with save/revert, binaries point at
// the download. All traffic stays inside the sandboxed file route.
function WorkspaceFileDialog({
  path,
  onClose,
  onChanged,
}: {
  path: string
  onClose: () => void
  onChanged: () => void
}) {
  const isImage = IMAGE_FILE.test(path)
  const editable = TEXT_EDIT_FILE.test(path)
  const [body, setBody] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isImage || !editable) {
      setPhase('ready')
      return
    }
    let alive = true
    setPhase('loading')
    fetch(`/api/royal-red/workspace/file?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(d.error ?? `HTTP ${res.status}`)
        }
        const text = await res.text()
        if (!alive) return
        setBody(text)
        setDraft(text)
        setDirty(false)
        setPhase('ready')
      })
      .catch((e) => {
        if (!alive) return
        setErrMsg((e as Error).message)
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [path, isImage, editable])

  const save = async () => {
    setPhase('saving')
    setErrMsg(null)
    try {
      const res = await fetch(`/api/royal-red/workspace/file?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: draft,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setBody(draft)
      setDirty(false)
      setPhase('ready')
      toast({ title: 'Saved to workspace', description: path })
      onChanged()
    } catch (e) {
      setErrMsg((e as Error).message)
      setPhase('error')
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2 font-mono text-sm">
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="truncate" title={path}>{path}</span>
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px]">
            sandboxed workspace file / {isImage ? 'image asset' : editable ? 'text file, editable' : 'binary, download only'}
          </DialogDescription>
        </DialogHeader>
        {isImage ? (
          <div className="flex max-h-[60vh] items-center justify-center overflow-auto rounded-md border bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
            {/* workspace file preview: arbitrary user-produced binaries, so plain <img> is deliberate */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/royal-red/workspace/file?path=${encodeURIComponent(path)}`}
              alt={`Workspace file ${path}`}
              className="max-h-[56vh] max-w-full rounded object-contain"
            />
          </div>
        ) : editable ? (
          <div className="flex flex-col gap-2">
            {phase === 'loading' && (
              <div className="flex h-48 items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading file...
              </div>
            )}
            {phase !== 'loading' && (
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setDirty(true)
                }}
                spellCheck={false}
                aria-label={`Edit ${path}`}
                className="h-[50vh] w-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none transition focus:border-red-600/50 focus:ring-1 focus:ring-red-600/30"
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {phase === 'error'
                  ? null
                  : `${draft.length.toLocaleString()} chars${dirty ? ' / unsaved changes' : ''}`}
                {errMsg && <span className="text-red-500">{errMsg}</span>}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 font-mono text-xs"
                  disabled={!dirty || phase === 'saving'}
                  onClick={() => {
                    setDraft(body ?? '')
                    setDirty(false)
                  }}
                >
                  revert
                </Button>
                <Button
                  size="sm"
                  className="h-8 border-red-600/50 bg-red-500/10 font-mono text-red-700 hover:bg-red-500/20 dark:text-red-300"
                  disabled={!dirty || phase === 'saving'}
                  onClick={() => void save()}
                >
                  {phase === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <HardDrive className="h-5 w-5 text-muted-foreground/50" />
            <p className="font-mono text-xs text-muted-foreground">
              binary file: the sandbox does not render it inline.
            </p>
            <Button asChild size="sm" variant="outline" className="font-mono text-xs">
              <a
                href={`/api/royal-red/workspace/file?path=${encodeURIComponent(path)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-3.5 w-3.5" /> download to inspect
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// the user-files half of the sandbox: uploads from the composer plus anything
// the agent wrote via write_file. list / inspect / edit / download / delete,
// all sandbox scoped.
function WorkspaceBrowser() {
  const [files, setFiles] = useState<WsFile[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [inspect, setInspect] = useState<string | null>(null)
  // search + sort (client-side; the sandbox list stays small)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'size'>('name')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/royal-red/workspace')
      if (res.ok) {
        const data = (await res.json()) as { files: WsFile[] }
        setFiles(data.files ?? [])
      } else {
        setFiles([])
      }
    } catch {
      setFiles([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (p: string) => {
    if (busy) return
    setBusy(p)
    try {
      const res = await fetch(`/api/royal-red/workspace?path=${encodeURIComponent(p)}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'File removed', description: p })
        await load()
      } else {
        toast({ title: 'Delete failed', variant: 'destructive' })
      }
    } finally {
      setBusy(null)
    }
  }

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const list = (files ?? []).filter((f) => !q || f.path.toLowerCase().includes(q))
    return sort === 'name' ? [...list].sort((a, b) => a.path.localeCompare(b.path)) : [...list].sort((a, b) => b.size - a.size)
  }, [files, q, sort])

  if (files === null) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> reading workspace...
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1.5">
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          {q ? `${visible.length} OF ${files.length} FILES` : `${files.length} FILE${files.length === 1 ? '' : 'S'} / SANDBOXED`}
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={sort === 'name' ? 'Sort by size' : 'Sort by name'}
            aria-pressed={sort === 'size'}
            title={sort === 'name' ? 'Sorted by name, click for size' : 'Sorted by size, click for name'}
            disabled={!files.length}
            onClick={() => setSort((s) => (s === 'name' ? 'size' : 'name'))}
          >
            {sort === 'name' ? <ArrowDownAZ className="h-3 w-3" /> : <ArrowDownWideNarrow className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Download the whole workspace as zip"
            title="Download workspace as .zip"
            disabled={!files.length}
            onClick={() => window.open('/api/royal-red/workspace/zip', '_blank')}
          >
            <Archive className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Refresh workspace files" onClick={() => void load()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </span>
      </div>
      {files.length > 3 && (
        <div className="border-b px-2 py-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter workspace files..."
              aria-label="Filter workspace files by path"
              className="h-7 border-input bg-card pl-7 font-mono text-[11px]"
            />
          </div>
        </div>
      )}
      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <HardDrive className="h-5 w-5 text-muted-foreground/50" />
          <p className="font-mono text-xs text-muted-foreground">
            workspace is empty. drop files on the composer or command ROYAL RED to write some.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center font-mono text-xs text-muted-foreground">
          no files match {'"'}{query.trim()}{'"'}.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {visible.map((f) => {
              const { Icon, cls } = wsIcon(f.path)
              return (
                <div
                  key={f.path}
                  className="group flex items-center gap-2 rounded border border-transparent px-2 py-1.5 font-mono text-[11px] transition hover:border-border hover:bg-muted/40"
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', cls)} />
                  <span className="min-w-0 flex-1 truncate" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{sizeLabel(f.size)}</span>
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      onClick={() => setInspect(f.path)}
                      aria-label={`Inspect ${f.path}`}
                      title="Inspect / edit"
                      className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                    <a
                      href={`/api/royal-red/workspace/file?path=${encodeURIComponent(f.path)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${f.path}`}
                      title="Open / download"
                      className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => void remove(f.path)}
                      disabled={busy === f.path}
                      aria-label={`Delete ${f.path}`}
                      className="rounded p-1 text-muted-foreground transition hover:bg-background hover:text-red-500"
                    >
                      {busy === f.path ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
      {inspect && (
        <WorkspaceFileDialog path={inspect} onClose={() => setInspect(null)} onChanged={() => void load()} />
      )}
    </div>
  )
}

function FilesTab() {
  const artifact = useRoyalRed((s) => s.artifact)
  const refreshKey = useRoyalRed((s) => s.previewKey)
  // scope lives in the store so /files workspace can deep-link into it
  const scope = useRoyalRed((s) => s.filesScope)
  const setScope = useRoyalRed((s) => s.setFilesScope)

  useEffect(() => {
    const id = artifact?.id
    if (!id) return
    // fetch full contents when any non-image entry is an empty tombstone
    const incomplete = artifact?.files.some((f) => !f.content && !IMAGE_FILE.test(f.path))
    if (!incomplete) return
    void (async () => {
      try {
        const res = await fetch(`/api/royal-red/artifact-file/${id}`)
        if (res.ok) {
          const data = (await res.json()) as { files: { path: string; content: string }[] }
          useRoyalRed.setState((st) => ({
            artifact: st.artifact && st.artifact.id === id ? { ...st.artifact, files: data.files } : st.artifact,
          }))
        }
      } catch {}
    })()
     
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: preview reloads only when artifact id / pending-file set / refresh key change
  }, [artifact?.id, artifact?.files.length, artifact?.files.some((f) => !f.content && !IMAGE_FILE.test(f.path)), refreshKey])

  if (scope === 'workspace') {
    return (
      <div className="flex h-full flex-col">
        <ScopeToggle scope={scope} setScope={setScope} artifactCount={artifact?.files.length ?? 0} />
        <WorkspaceBrowser />
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <ScopeToggle scope={scope} setScope={setScope} artifactCount={artifact?.files.length ?? 0} />
      {!artifact ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center font-mono text-xs text-muted-foreground">
          no artifact yet. command ROYAL RED to build something.
        </div>
      ) : (
        <ArtifactFileView artifact={artifact} />
      )}
    </div>
  )
}

function ScopeToggle({
  scope,
  setScope,
  artifactCount,
}: {
  scope: 'artifact' | 'workspace'
  setScope: (s: 'artifact' | 'workspace') => void
  artifactCount: number
}) {
  return (
    <div className="flex gap-1 border-b px-3 py-1.5">
      <button
        onClick={() => setScope('artifact')}
        aria-pressed={scope === 'artifact'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] tracking-wider transition',
          scope === 'artifact'
            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Layers className="h-3 w-3" />
        ARTIFACT{artifactCount > 0 ? ` (${artifactCount})` : ''}
      </button>
      <button
        onClick={() => setScope('workspace')}
        aria-pressed={scope === 'workspace'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] tracking-wider transition',
          scope === 'workspace'
            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FolderTree className="h-3 w-3" />
        WORKSPACE
      </button>
    </div>
  )
}

function ArtifactFileView({
  artifact,
}: {
  artifact: { id: string; entry: string; files: { path: string; content: string }[] }
}) {
  const activeFile = useRoyalRed((s) => s.activeFile)
  const setActiveFile = useRoyalRed((s) => s.setActiveFile)
  const refreshKey = useRoyalRed((s) => s.previewKey)
  const [copied, setCopied] = useState(false)
  // version history: session-wide immutable snapshots, fetched lazily on first use
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  // diff state carries its own artifact+path key, so switching files/artifacts
  // invalidates it by comparison instead of a setState-in-effect reset
  const [diff, setDiff] = useState<{
    artifactId: string
    path: string
    open: boolean
    prevContent: string | null
    err: string | null
    label: string
    versionId: string
  } | null>(null)
  const current = artifact.files.find((f) => f.path === activeFile) ?? artifact.files[0]
  const isImage = current ? IMAGE_FILE.test(current.path) : false
  const diffActive =
    !!diff && diff.open && diff.artifactId === artifact.id && diff.path === current?.path

  const runDiff = (row: VersionRow) => {
    if (!current) return
    const key = { artifactId: artifact.id, path: current.path }
    const label = `v${row.version} · ${row.artifactName}`
    setDiff({ ...key, open: true, prevContent: null, err: null, label, versionId: row.versionId })
    void (async () => {
      let prevContent: string | null = null
      try {
        const res = await fetch(`/api/royal-red/artifact-version/${row.versionId}?path=${encodeURIComponent(key.path)}`)
        if (res.ok) {
          const data = (await res.json()) as { content: string }
          prevContent = data.content
        }
      } catch {}
      if (prevContent === null) {
        setDiff({ ...key, open: true, prevContent: null, err: `version ${label} has no readable copy of this file`, label, versionId: row.versionId })
        return
      }
      setDiff({ ...key, open: true, prevContent, err: null, label, versionId: row.versionId })
    })()
  }

  const loadVersions = () => {
    if (versions) return Promise.resolve(versions)
    return fetch(`/api/royal-red/artifact-versions/${artifact.id}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ versions: VersionRow[] }>) : { versions: [] }))
      .then((data) => {
        setVersions(data.versions)
        return data.versions
      })
      .catch(() => {
        setVersions([])
        return [] as VersionRow[]
      })
  }

  const openDiff = () => {
    if (!current || isImage) return
    if (diff && diff.open && diff.artifactId === artifact.id && diff.path === current.path) {
      setDiff({ ...diff, open: false })
      return
    }
    void loadVersions().then((rows) => {
      if (!rows.length) return
      // default target: newest snapshot that is not the current artifact's latest
      const latestOfCurrent = rows.find((v) => v.artifactId === artifact.id)
      const target = rows.find((v) => v.versionId !== latestOfCurrent?.versionId) ?? rows[rows.length - 1]
      if (target) runDiff(target)
    })
  }

  return (
    <>
      <div className="flex flex-wrap gap-1 border-b px-3 py-2">
        {artifact.files.map((f) => (
          <button
            key={f.path}
            onClick={() => setActiveFile(f.path)}
            className={cn(
              'flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] transition',
              current?.path === f.path
                ? 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {IMAGE_FILE.test(f.path) && <ImageIcon className="h-3 w-3" />}
            {f.path}
          </button>
        ))}
      </div>
      {current && (
        <div className="flex items-center justify-end gap-1 border-b bg-muted/20 px-2 py-1">
          <span className="mr-auto font-mono text-[10px] text-muted-foreground">
            {isImage ? 'binary asset' : `${current.content.length} chars`}
            {versions && versions.length > 0 && (
              <span className="ml-2 text-muted-foreground/60" title="immutable version snapshots on record">
                {versions.length} version{versions.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {!isImage && current.content && versions === null && (
            <button
              type="button"
              onClick={openDiff}
              title="Diff this file against a previous build version"
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider transition border-border text-muted-foreground hover:border-red-600/40 hover:text-foreground"
            >
              <History className="h-3 w-3" />
              HISTORY DIFF
            </button>
          )}
          {!isImage && current.content && versions !== null && versions.length > 1 && (
            <select
              aria-label="Diff against version"
              value={diffActive ? (diff?.versionId ?? '') : ''}
              onChange={(e) => {
                const row = versions.find((v) => v.versionId === e.target.value)
                if (row) runDiff(row)
                else setDiff(null)
              }}
              className="h-6 rounded border border-border bg-background px-1 font-mono text-[10px] text-foreground transition hover:border-red-600/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-600/40"
            >
              <option value="">DIFF VS...</option>
              {versions.map((v) => (
                <option key={v.versionId} value={v.versionId}>
                  v{v.version} · {v.artifactName}
                  {v.note && v.note !== 'backfill v1' ? ` · ${v.note}` : ''}
                </option>
              ))}
            </select>
          )}
          {!isImage && current.content && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Copy file content"
              onClick={() => {
                void navigator.clipboard
                  .writeText(current.content)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                  .catch(() => {})
              }}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Download this file"
            title="Download this file"
            onClick={() => window.open(`/api/royal-red/preview/${artifact.id}/${current.path}`, '_blank')}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      )}
      {isImage && current ? (
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
          {/* checkerboard backdrop makes transparent PNGs readable */}
          {/* artifact-hosted preview: plain <img> is deliberate (dynamic immutable snapshot paths) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${artifact.id}/${current.path}/${refreshKey}`}
            src={`/api/royal-red/preview/${artifact.id}/${current.path}`}
            alt={`Artifact asset ${current.path}`}
            className="max-h-full max-w-full rounded border object-contain shadow-lg"
          />
        </div>
      ) : diffActive && diff?.err ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <GitCompare className="h-5 w-5 text-muted-foreground/50" />
          <p className="font-mono text-xs text-muted-foreground">{diff.err}</p>
        </div>
      ) : diffActive && diff?.prevContent !== null && diff?.prevContent !== undefined ? (
        <DiffView oldText={diff.prevContent} newText={current?.content ?? ''} label={diff.label} />
      ) : (
        <ScrollArea className="flex-1">
          <pre className="p-4 font-mono text-[11px] leading-relaxed text-foreground/90">
            {current?.content ?? '// loading file...'}
          </pre>
        </ScrollArea>
      )}
    </>
  )
}

function ArtifactSwitcher() {
  const artifacts = useRoyalRed((s) => s.artifacts)
  const currentId = useRoyalRed((s) => s.artifact?.id)
  const selectArtifact = useRoyalRed((s) => s.selectArtifact)
  if (artifacts.length <= 1) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`Switch artifact (${artifacts.length} in session)`}
          title={`${artifacts.length} artifacts in this session`}
        >
          <Layers className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          SESSION ARTIFACTS ({artifacts.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {artifacts.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onClick={() => selectArtifact(a.id)}
            className={cn(
              'gap-2 font-mono text-xs',
              a.id === currentId && 'bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {typeof a.score === 'number' && (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] tracking-wider',
                  a.score >= 10
                    ? 'border-red-600/50 bg-red-500/10'
                    : 'border-amber-600/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                )}
              >
                {a.score}/10
              </span>
            )}
            {a.id === currentId && <Check className="h-3 w-3 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// preview device widths: the website-builder vision needs real responsive
// verification, so artifacts render in desktop / tablet / mobile frames
const DEVICES = [
  { id: 'desktop', icon: Monitor, label: 'Desktop width' },
  { id: 'tablet', icon: Tablet, label: 'Tablet width (768px)' },
  { id: 'mobile', icon: Smartphone, label: 'Mobile width (390px)' },
] as const
type DeviceId = (typeof DEVICES)[number]['id']
const DEVICE_W: Record<DeviceId, number | null> = { desktop: null, tablet: 768, mobile: 390 }

// skeleton shown while the artifact iframe loads: the preview reads as dead
// white space otherwise, especially on first paint of a heavy page
function PreviewSkeleton() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 backdrop-blur-[2px]">
      <Loader2 className="h-4 w-4 animate-spin text-red-500" />
      <span className="royalred-breathe font-mono text-[11px] tracking-[0.25em] text-muted-foreground">
        RENDERING PREVIEW
      </span>
    </div>
  )
}

function PreviewTab() {
  const artifact = useRoyalRed((s) => s.artifact)
  const previewKey = useRoyalRed((s) => s.previewKey)
  const [device, setDevice] = useState<DeviceId>('desktop')
  // skeleton state derived by comparing against the key we last saw load;
  // every artifact switch/refresh bumps previewKey, so no effect is needed
  const [loadedKey, setLoadedKey] = useState<number | null>(null)
  const frameLoading = loadedKey !== previewKey
  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-muted-foreground">
        artifacts you command into existence render here.
      </div>
    )
  }
  const src = `/api/royal-red/preview/${artifact.id}/${artifact.entry}`
  const frameW = DEVICE_W[device]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
          <MonitorPlay className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate">{artifact.name}</span>
          {typeof artifact.score === 'number' && (
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] tracking-wider transition-all',
                artifact.score >= 10
                  ? 'royalred-score-glow border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'border-amber-600/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
              )}
            >
              SCORE {artifact.score}/10
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label="Preview device width">
            {DEVICES.map((d) => {
              const Icon = d.icon
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDevice(d.id)}
                  aria-label={d.label}
                  aria-pressed={device === d.id}
                  title={d.label}
                  className={cn(
                    'rounded p-1 transition',
                    device === d.id
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" />
                </button>
              )
            })}
          </div>
          <ArtifactSwitcher />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Reload preview"
            onClick={() => useRoyalRed.setState((st) => ({ previewKey: st.previewKey + 1 }))}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Download artifact as zip"
            title="Download as .zip"
            onClick={() => window.open(`/api/royal-red/artifact-download/${artifact.id}`, '_blank')}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Open in new tab"
            onClick={() => window.open(src, '_blank')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {frameW ? (
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2 sm:p-4">
          <div
            className="mx-auto flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-xl border-2 border-border bg-background shadow-xl"
            style={{ maxWidth: frameW }}
          >
            <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
                {device.toUpperCase()} / {frameW}PX
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              <iframe
                key={previewKey}
                src={src}
                title="ROYAL RED artifact preview"
                onLoad={() => setLoadedKey(previewKey)}
                className="absolute inset-0 h-full w-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
              {frameLoading && <PreviewSkeleton />}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <iframe
            key={previewKey}
            src={src}
            title="ROYAL RED artifact preview"
            onLoad={() => setLoadedKey(previewKey)}
            className="absolute inset-0 h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
          {frameLoading && <PreviewSkeleton />}
        </div>
      )}
      {artifact.review && (
        <div className="max-h-24 shrink-0 overflow-y-auto border-t bg-muted/30 px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
          {artifact.review}
        </div>
      )}
    </div>
  )
}

interface Account {
  id: string
  username: string
  role: string
  note?: string | null
}
interface AuditRow {
  id: string
  action: string
  detail?: string | null
  ok: boolean
  createdAt: string
}
interface WsStats {
  files: number
  bytes: number
  byKind: Record<string, number>
  kindBytes: Record<string, number>
}

const WS_KIND_COLOR: Record<string, string> = {
  image: 'bg-emerald-500',
  media: 'bg-violet-500',
  code: 'bg-sky-500',
  data: 'bg-amber-500',
  other: 'bg-muted-foreground/50',
}

function SystemTab() {
  const send = useRoyalRed((s) => s.send)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [diag, setDiag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wsStats, setWsStats] = useState<WsStats | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/royal-red/accounts')
      if (res.ok) {
        const data = (await res.json()) as { accounts: Account[]; audit: AuditRow[] }
        setAccounts(data.accounts)
        setAudit(data.audit)
      }
    } catch {}
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/royal-red/workspace?stats=1')
      if (res.ok) {
        const data = (await res.json()) as { stats?: WsStats }
        setWsStats(data.stats ?? null)
      }
    } catch {}
  }, [])

  useEffect(() => {
    void load()
    void loadStats()
  }, [load, loadStats])

  const createAccount = async () => {
    if (!username.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/royal-red/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_account', username, role }),
      })
      if (res.ok) {
        toast({ title: 'ROYAL RED account created', description: `${username} [${role}]` })
        setUsername('')
        await load()
        void send(`list_accounts audit: the System console just created account "${username}" with role ${role}. Confirm it in one line.`)
      } else {
        const data = (await res.json()) as { error?: string }
        toast({ title: 'Failed', description: data.error ?? 'error', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const removeAccount = async (u: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/royal-red/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_account', username: u }),
      })
      if (res.ok) {
        toast({ title: 'ROYAL RED account removed', description: u })
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const runDiag = async (id: string) => {
    setDiag('running...')
    try {
      const res = await fetch('/api/royal-red/pc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: id }),
      })
      const data = (await res.json()) as { output?: string; error?: string }
      setDiag(data.output ?? `error: ${data.error}`)
    } catch (e) {
      setDiag(`error: ${(e as Error).message}`)
    }
  }

  const diagnostics = [
    { id: 'kernel', label: 'kernel + host' },
    { id: 'uptime', label: 'uptime + load' },
    { id: 'cpu', label: 'cpu top' },
    { id: 'mem', label: 'memory' },
    { id: 'disk', label: 'disk' },
    { id: 'whoami', label: 'runtime identity' },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> ROYAL RED ACCOUNTS ({accounts.length})
          </h3>
          <div className="mb-2 flex gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="h-9 font-mono text-xs"
              aria-label="New account username"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              aria-label="Account role"
              className="h-9 rounded-md border bg-card px-2 font-mono text-xs"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <Button
              size="sm"
              className="h-9 border-red-600/50 bg-red-500/10 font-mono text-red-700 hover:bg-red-500/20 dark:text-red-300"
              disabled={busy || !username.trim()}
              onClick={() => void createAccount()}
            >
              <UserPlus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded border bg-card px-2.5 py-1.5 font-mono text-xs"
              >
                <span>
                  {a.username} <span className="text-muted-foreground">[{a.role}]</span>
                </span>
                <button
                  onClick={() => void removeAccount(a.username)}
                  disabled={busy}
                  aria-label={`Remove account ${a.username}`}
                  className="text-muted-foreground transition hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!accounts.length && (
              <p className="font-mono text-xs text-muted-foreground">no accounts yet.</p>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center justify-between gap-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">
            <span className="flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5" /> WORKSPACE
            </span>
            <button
              onClick={() => void loadStats()}
              aria-label="Refresh workspace stats"
              title="Refresh workspace stats"
              className="rounded p-1 transition hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </h3>
          {wsStats ? (
            <div className="rounded border bg-card p-3 font-mono text-xs">
              <div className="mb-2.5 flex items-baseline justify-between">
                <span className="tabular-nums">
                  {wsStats.files} file{wsStats.files === 1 ? '' : 's'}
                </span>
                <span className="tabular-nums text-muted-foreground">{sizeLabel(wsStats.bytes)}</span>
              </div>
              <div className="space-y-1.5">
                {(['image', 'media', 'code', 'data', 'other'] as const).map((k) => {
                  const n = wsStats.byKind[k] ?? 0
                  if (!n) return null
                  const pct = Math.max(4, Math.round(((wsStats.kindBytes[k] ?? 0) / Math.max(1, wsStats.bytes)) * 100))
                  return (
                    <div key={k} className="flex items-center gap-2 text-[10px]">
                      <span className="w-10 shrink-0 text-muted-foreground">{k}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn('block h-full rounded-full transition-all duration-500', WS_KIND_COLOR[k])}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{n}</span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2.5 border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
                uploads plus everything the agent writes. browse it in the FILES tab.
              </p>
            </div>
          ) : (
            <p className="font-mono text-[10px] text-muted-foreground">reading workspace stats...</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> SYSTEM DIAGNOSTICS (EXPLICIT CONSENT)
          </h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {diagnostics.map((d) => (
              <button
                key={d.id}
                onClick={() => void runDiag(d.id)}
                className="rounded border px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-red-600/40 hover:text-foreground"
              >
                {d.label}
              </button>
            ))}
          </div>
          {diag !== null && (
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap">
              {diag}
            </pre>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-muted-foreground">
            <FileCode2 className="h-3.5 w-3.5" /> AUDIT LOG
          </h3>
          <div className="space-y-1">
            {audit.map((r) => (
              <div key={r.id} className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
                  {r.ok ? 'ok' : 'err'}
                </span>
                <span>{r.action}</span>
                <span className="truncate">{r.detail}</span>
              </div>
            ))}
            {!audit.length && <p className="font-mono text-[10px] text-muted-foreground">clean.</p>}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}

export function RightPanel() {
  const artifact = useRoyalRed((s) => s.artifact)
  const panelTab = useRoyalRed((s) => s.panelTab)
  const setPanelTab = useRoyalRed((s) => s.setPanelTab)
  return (
    <Tabs
      value={panelTab}
      onValueChange={(v) => setPanelTab(v as PanelTab)}
      className="flex h-full flex-col"
    >
      <TabsList className="seg mx-3 mt-3 grid w-auto grid-cols-11 gap-1 p-1">
        {(
          [
            { id: 'preview', label: 'PREVIEW' },
            { id: 'files', label: artifact ? `FILES (${artifact.files.length})` : 'FILES' },
            { id: 'verify', label: 'VERIFY' },
            { id: 'system', label: 'SYSTEM' },
            { id: 'desktop', label: 'DESKTOP' },
            { id: 'providers', label: 'PROVIDERS' },
            { id: 'router', label: 'ROUTER' },
            { id: 'events', label: 'EVENTS' },
            { id: 'memory', label: 'MEMORY' },
            { id: 'agents', label: 'AGENTS' },
            { id: 'settings', label: 'SETTINGS' },
          ] as const
        ).map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className={cn(
              'seg-item font-mono text-[11px] tracking-wider text-muted-foreground transition-all data-[state=active]:text-red-700 dark:data-[state=active]:text-red-300',
            )}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="preview" className="mt-0 min-h-0 flex-1">
        <PreviewTab />
      </TabsContent>
      <TabsContent value="files" className="mt-0 min-h-0 flex-1">
        <FilesTab />
      </TabsContent>
      <TabsContent value="verify" className="mt-0 min-h-0 flex-1">
        <VerifyTab />
      </TabsContent>
      <TabsContent value="system" className="mt-0 min-h-0 flex-1">
        <SystemTab />
      </TabsContent>
      <TabsContent value="desktop" className="mt-0 min-h-0 flex-1">
        <DesktopTab />
      </TabsContent>
      <TabsContent value="providers" className="mt-0 min-h-0 flex-1">
        <ProvidersTab />
      </TabsContent>
      <TabsContent value="router" className="mt-0 min-h-0 flex-1">
        <RouterTab />
      </TabsContent>
      <TabsContent value="events" className="mt-0 min-h-0 flex-1">
        <EventsTab />
      </TabsContent>
      <TabsContent value="memory" className="mt-0 min-h-0 flex-1">
        <MemoryTab />
      </TabsContent>
      <TabsContent value="agents" className="mt-0 min-h-0 flex-1">
        <AgentsTab />
      </TabsContent>
      <TabsContent value="settings" className="mt-0 min-h-0 flex-1">
        <SettingsTab />
      </TabsContent>
    </Tabs>
  )
}
