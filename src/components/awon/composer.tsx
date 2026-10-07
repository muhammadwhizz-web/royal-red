'use client'

import { FormEvent, useCallback, useRef, useState } from 'react'
import {
  ArrowUp,
  Cpu,
  File as FileIcon,
  Film,
  FlaskConical,
  Hammer,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Search,
  Square,
  X,
} from 'lucide-react'
import { useAwon } from './store'
import { MODE_LABELS, type AwonMode } from '@/lib/awon/types'
import { cn } from '@/lib/utils'

const MODES: { id: AwonMode; icon: typeof Hammer; hint: string }[] = [
  { id: 'build', icon: Hammer, hint: 'Builder: sites, apps, products, verified to 10/10' },
  { id: 'research', icon: Search, hint: 'Research: live web search, page reader, sourced briefings' },
  { id: 'pc', icon: Cpu, hint: 'System: AWON accounts, diagnostics, workspace' },
  { id: 'ask', icon: FlaskConical, hint: 'Assist: general reasoning' },
]

// per-mode accent colors (match the session history dots)
const MODE_ACTIVE: Record<AwonMode, string> = {
  build: 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  research: 'border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  pc: 'border-violet-600/60 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  ask: 'border-sky-600/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])

type PendingUpload = { path: string; name: string; size: number; kind: 'image' | 'video' | 'file' }

function kindOf(name: string): PendingUpload['kind'] {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return 'file'
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

const KIND_ICON = { image: ImageIcon, video: Film, file: FileIcon } as const
const KIND_STYLE = {
  image: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  video: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  file: 'border-sky-600/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
} as const

// terminal-style command history shared across composer remounts
const cmdHistory: string[] = []

export function Composer() {
  const mode = useAwon((s) => s.mode)
  const setMode = useAwon((s) => s.setMode)
  const send = useAwon((s) => s.send)
  const streaming = useAwon((s) => s.streaming)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [uploading, setUploading] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // ArrowUp/Down walk the history; the in-progress draft is preserved
  const histIdxRef = useRef<number | null>(null)
  const draftRef = useRef('')

  const walkHistory = (dir: 1 | -1) => {
    if (!cmdHistory.length) return
    if (histIdxRef.current === null) {
      if (dir === 1) return
      draftRef.current = text
      histIdxRef.current = cmdHistory.length - 1
    } else {
      const next = histIdxRef.current + dir
      if (next >= cmdHistory.length) {
        histIdxRef.current = null
        setText(draftRef.current)
        if (taRef.current) taRef.current.style.height = 'auto'
        return
      }
      if (next < 0) return
      histIdxRef.current = next
    }
    setText(cmdHistory[histIdxRef.current])
    requestAnimationFrame(() => taRef.current?.setSelectionRange(9999, 9999))
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim() || streaming || uploading > 0) return
    const attachments = pending.map((p) => p.path)
    const full = attachments.length ? `${text}\n\n[attachments: ${attachments.join(', ')}]` : text
    setPending([])
    // remember the typed command (without the attachment suffix) for history
    const typed = text.trim()
    if (!cmdHistory.length || cmdHistory[cmdHistory.length - 1] !== typed) {
      cmdHistory.push(typed)
      if (cmdHistory.length > 100) cmdHistory.shift()
    }
    histIdxRef.current = null
    draftRef.current = ''
    void send(full)
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const stop = useAwon((s) => s.stop)

  const uploadFiles = useCallback((files: FileList | File[]) => {
    const list = [...files].slice(0, 6)
    if (!list.length) return
    setUploadError(null)
    setUploading((n) => n + list.length)
    for (const f of list) {
      const form = new FormData()
      form.append('file', f)
      fetch('/api/awon/upload', { method: 'POST', body: form })
        .then(async (res) => {
          const data = (await res.json()) as {
            ok?: boolean
            path?: string
            name?: string
            size?: number
            kind?: PendingUpload['kind']
            error?: string
          }
          if (!res.ok || !data.ok || !data.path) {
            setUploadError(data.error ?? `upload failed (${res.status})`)
            return
          }
          setPending((p) =>
            p.some((x) => x.path === data.path)
              ? p
              : [...p, { path: data.path!, name: data.name ?? data.path!, size: data.size ?? 0, kind: data.kind ?? kindOf(data.path!) }],
          )
        })
        .catch(() => setUploadError(`upload failed: ${f.name}`))
        .finally(() => setUploading((n) => n - 1))
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={onDrop}
      className="relative mt-auto border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      {/* drop overlay */}
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-emerald-500/70 bg-emerald-500/5 backdrop-blur-[1px]"
        >
          <span className="awon-breathe font-mono text-xs tracking-[0.3em] text-emerald-600 dark:text-emerald-400">
            DROP FILES INTO THE WORKSPACE
          </span>
        </div>
      )}
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
        {/* pending uploads + errors */}
        {(pending.length > 0 || uploading > 0 || uploadError) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {pending.map((p) => {
              const Icon = KIND_ICON[p.kind]
              return (
                <span
                  key={p.path}
                  className={cn(
                    'awon-rise inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]',
                    KIND_STYLE[p.kind],
                  )}
                  title={`${p.path} (${sizeLabel(p.size)})`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 opacity-60">{sizeLabel(p.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.name} from this command`}
                    onClick={() => setPending((q) => q.filter((x) => x.path !== p.path))}
                    className="shrink-0 rounded-full p-0.5 transition hover:bg-foreground/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
            {uploading > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                transferring {uploading}...
              </span>
            )}
            {uploadError && (
              <span className="inline-flex max-w-[280px] items-center gap-1.5 truncate rounded-full border border-red-500/40 bg-red-500/5 px-2.5 py-1 font-mono text-[11px] text-red-500">
                {uploadError}
              </span>
            )}
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {MODES.map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wider transition',
                  mode === m.id
                    ? MODE_ACTIVE[m.id]
                    : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                )}
                aria-pressed={mode === m.id}
              >
                <Icon className="h-3 w-3" />
                {MODE_LABELS[m.id]}
              </button>
            )
          })}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
                // only walk history when the caret is on the first line
                const caret = e.currentTarget.selectionStart ?? 0
                const firstLine = text.slice(0, caret).includes('\n')
                if (!firstLine) {
                  e.preventDefault()
                  walkHistory(-1)
                }
                return
              }
              if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) {
                const caret = e.currentTarget.selectionStart ?? 0
                const lastLine = text.slice(caret).includes('\n')
                if (!lastLine && histIdxRef.current !== null) {
                  e.preventDefault()
                  walkHistory(1)
                }
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="command AWON...  (/ to focus, drop files to attach)"
            aria-label="AWON command input"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border bg-card px-3.5 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-emerald-600/50 focus:ring-1 focus:ring-emerald-600/30"
          />
          {/* idle slot: attach button; streaming slot: stop button (no layout shift) */}
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop AWON"
              title="Stop the current turn"
              className="awon-rise flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-red-500/40 bg-red-500/5 text-red-500 transition hover:bg-red-500/15"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach files"
              title="Attach files: images, videos, code, data. They land in the workspace."
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition hover:border-emerald-600/40 hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={streaming || !text.trim() || uploading > 0}
            aria-label="Send command"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-emerald-600/50 bg-emerald-500/10 text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300"
          >
            <ArrowUp className="h-4.5 w-4.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="hidden font-mono text-[10px] text-muted-foreground sm:block">
            AWON runs sandboxed: files land in its workspace, shell is whitelisted, artifacts are previewed live.
          </p>
          <p className="hidden items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70 lg:flex">
            <kbd className="rounded border bg-muted/60 px-1 py-0.5 text-[9px]">&uarr;</kbd>
            <kbd className="rounded border bg-muted/60 px-1 py-0.5 text-[9px]">&darr;</kbd>
            history
            <span className="text-muted-foreground/40">·</span>
            <kbd className="rounded border bg-muted/60 px-1 py-0.5 text-[9px]">ctrl+k</kbd>
            palette
            <span className="text-muted-foreground/40">·</span>
            <kbd className="rounded border bg-muted/60 px-1 py-0.5 text-[9px]">ctrl+b</kbd>
            panel
          </p>
        </div>
      </div>
    </form>
  )
}
