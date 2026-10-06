'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Globe,
  Hammer,
  ImagePlus,
  Kanban,
  Loader2,
  ListTree,
  Newspaper,
  PanelRight,
  Search,
  ShieldCheck,
  SquareTerminal,
  SunMoon,
  Terminal,
  UserPlus,
  UserMinus,
  Users,
  Video,
  XCircle,
} from 'lucide-react'
import { useAwon } from './store'
import type { ChatItem } from '@/lib/awon/types'
import { cn } from '@/lib/utils'

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="awon-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 underline underline-offset-2 dark:text-emerald-400"
            />
          ),
          h1: (p) => <h1 {...p} className="mt-3 mb-1 font-mono text-base font-bold" />,
          h2: (p) => <h2 {...p} className="mt-3 mb-1 font-mono text-sm font-bold" />,
          h3: (p) => <h3 {...p} className="mt-2 mb-1 font-mono text-sm font-semibold" />,
          code: (p) => <code {...p} className="rounded bg-muted px-1 py-0.5 font-mono text-xs" />,
          pre: (p) => <CodeBlock {...p} />,
          ul: (p) => <ul {...p} className="my-1 list-disc space-y-1 pl-5" />,
          ol: (p) => <ol {...p} className="my-1 list-decimal space-y-1 pl-5" />,
          table: (p) => (
            <div className="awon-table-wrap my-2 overflow-x-auto rounded-md border">
              <table {...p} className="w-full border-collapse text-xs" />
            </div>
          ),
          th: (p) => (
            <th
              {...p}
              className="border-b bg-muted/60 px-2.5 py-1.5 text-left font-mono text-[11px] tracking-wide whitespace-nowrap"
            />
          ),
          td: (p) => (
            <td {...p} className="border-b px-2.5 py-1.5 align-top last:border-b-0 [&:nth-child(odd)]:bg-muted/20" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function Typewriter({ text }: { text: string }) {
  const short = text.length < 90
  const [n, setN] = useState(short ? text.length : 0)
  useEffect(() => {
    if (short) return
    let i = 0
    const step = Math.max(4, Math.round(text.length / 90))
    const t = setInterval(() => {
      i += step
      if (i >= text.length) {
        setN(text.length)
        clearInterval(t)
      } else {
        setN(i)
      }
    }, 24)
    return () => clearInterval(t)
  }, [text, short])
  return <MarkdownBody text={short ? text : text.slice(0, n)} />
}

// code block with hover copy: every pre in assistant messages is one click away
// from the clipboard
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="group/code relative my-2">
      <pre
        {...rest}
        ref={ref}
        className="overflow-x-auto rounded-md border bg-muted/50 p-3 pr-10 font-mono text-xs"
      >
        {children}
      </pre>
      <button
        type="button"
        aria-label={copied ? 'Copied code' : 'Copy code'}
        title="Copy code"
        onClick={() => {
          const text = ref.current?.textContent ?? ''
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
            .catch(() => {})
        }}
        className={cn(
          'absolute right-1.5 top-1.5 rounded-md border border-transparent bg-background/80 p-1 text-muted-foreground/0 backdrop-blur transition',
          'group-hover/code:text-muted-foreground/80 hover:!border-border hover:!text-foreground',
        )}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy message'}
      title="Copy message"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
      className={cn(
        'absolute right-1.5 top-1.5 rounded-md border border-transparent p-1 text-muted-foreground/0 transition',
        'group-hover/msg:text-muted-foreground/70 hover:!border-border hover:!bg-background hover:!text-foreground focus-visible:text-muted-foreground',
      )}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

const TOOL_ICONS: Record<string, typeof Globe> = {
  web_search: Globe,
  read_file: FileText,
  write_file: FileText,
  list_files: ListTree,
  shell: SquareTerminal,
  system_report: ShieldCheck,
  create_account: UserPlus,
  remove_account: UserMinus,
  list_accounts: Users,
  generate_image: ImagePlus,
  analyze_image: Eye,
  analyze_video: Video,
  read_page: Newspaper,
  // local console command rows
  stats: Gauge,
  theme: SunMoon,
  export: Download,
  panel: PanelRight,
  mode: ArrowLeftRight,
}

// event labels are the friendly TOOL_LABELS ("web search"), the icon map is
// keyed by tool name ("web_search") — normalize so the right icon always wins
// (previously every event row fell back to the generic Terminal icon)
const toolIconKey = (label: string): string => label.toLowerCase().replace(/\s+/g, '_')

// event detail lines are plain text; markdown emphasis from the model ("**x**",
// backticks) renders as literal asterisks, so strip it for readability
function stripMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

// renders tool output with bare URLs turned into real links (search results,
// video sources) so the OUTPUT panel is clickable, not a dead text dump
function DetailText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)\]]+)/g)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\/[^\s)\]]+$/.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-emerald-600 underline decoration-emerald-600/40 underline-offset-2 transition hover:decoration-emerald-500 dark:text-emerald-400"
            onClick={(e) => e.stopPropagation()}
          >
            {p.length > 64 ? `${p.slice(0, 61)}...` : p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

// user messages carry attachments as a trailing [attachments: ...] line;
// render them as chips instead of raw text
function UserBubble({ text }: { text: string }) {
  const m = text.match(/\n*\[attachments: ([^\]]+)\]\s*$/)
  const body = m ? text.slice(0, m.index).trimEnd() : text
  const files = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  return (
    <div className="awon-rise flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm border bg-muted/60 px-3.5 py-2 font-mono text-sm whitespace-pre-wrap">
        {body}
        {files.length > 0 && (
          <span className="mt-2 flex flex-wrap justify-end gap-1">
            {files.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300"
              >
                <FileText className="h-3 w-3" />
                {f}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

// hard failures (link down, model error) get a one-click RETRY of the last
// command; tool-level errors keep their own row without retry
function ErrorRow({ item }: { item: Extract<ChatItem, { kind: 'event' }> }) {
  const send = useAwon((s) => s.send)
  const lastCommand = useAwon((s) => s.lastCommand)
  const streaming = useAwon((s) => s.streaming)
  return (
    <div
      role="alert"
      aria-live="polite"
      className="awon-rise flex items-start gap-2.5 rounded-md border border-l-2 border-l-red-500/60 border-red-500/20 bg-red-500/5 px-2.5 py-2 font-mono text-xs"
    >
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
      <div className="min-w-0 flex-1">
        <span className="text-foreground/90">{item.label}</span>
        {item.detail && (
          <span className="mt-0.5 block break-words text-muted-foreground">{item.detail}</span>
        )}
      </div>
      {!streaming && lastCommand && (
        <button
          type="button"
          onClick={() => void send(lastCommand)}
          aria-label="Retry the last command"
          title="Retry the last command (r)"
          className="shrink-0 rounded border border-red-500/40 bg-background/60 px-2 py-1 text-[10px] tracking-widest text-red-500 transition hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/50"
        >
          RETRY
        </button>
      )}
    </div>
  )
}

function EventRow({ item }: { item: Extract<ChatItem, { kind: 'event' }> }) {
  const ToolIcon = TOOL_ICONS[toolIconKey(item.label)] ?? Terminal
  const [open, setOpen] = useState(false)
  const output = item.output ?? item.detail
  const expandable = Boolean(output && output.length > 90)
  const detail = item.detail ? stripMd(item.detail) : item.detail
  return (
    <div className="awon-rise group/evt flex items-start gap-2.5 py-1 font-mono text-xs">
      <span className="mt-0.5 shrink-0">
        {item.status === 'run' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
        )}
        {item.status === 'ok' && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        )}
        {item.status === 'err' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-foreground/90">
            <ToolIcon
              className={cn(
                'h-3 w-3 text-muted-foreground',
                item.status === 'run' && 'animate-pulse text-emerald-600 dark:text-emerald-400',
              )}
            />
            {item.label}
          </span>
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Collapse output' : 'Expand full output'}
              className="ml-auto inline-flex items-center gap-0.5 rounded border border-transparent px-1 py-0.5 text-[10px] text-muted-foreground/60 transition hover:border-border hover:text-foreground"
            >
              OUTPUT
              <ChevronDown
                className={cn('h-3 w-3 transition-transform duration-200', open && 'rotate-180')}
              />
            </button>
          )}
        </div>
        {detail && !expandable && (
          <span className="block truncate text-muted-foreground" title={detail}>
            <DetailText text={detail} />
          </span>
        )}
        {detail && expandable && !open && (
          <span className="block truncate text-muted-foreground" title={detail}>
            <DetailText text={detail} />
          </span>
        )}
        {output && expandable && open && (
          <pre className="awon-detail mt-1.5 max-h-56 overflow-auto rounded-md border border-l-2 border-l-emerald-600/50 bg-muted/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            <DetailText text={output} />
          </pre>
        )}
      </div>
    </div>
  )
}

function ElapsedTimer() {
  const startedAt = useAwon((s) => s.phaseStartedAt)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  if (!startedAt) return null
  const secs = Math.max(0, Math.round((now - startedAt) / 1000))
  return <span className="tabular-nums text-muted-foreground/70">{secs}s</span>
}

// tiny telemetry line rendered after a finished turn: how long it took and how
// many tools ran (client-measured; cleared on the next send)
function TurnStatsLine() {
  const stats = useAwon((s) => s.turnStats)
  if (!stats) return null
  return (
    <div
      className="awon-rise flex items-center justify-center gap-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/70"
      aria-label="Turn statistics"
    >
      <span className="h-1 w-1 rounded-full bg-emerald-500/60" aria-hidden="true" />
      turn complete / {stats.secs}s / {stats.tools} tool{stats.tools === 1 ? '' : 's'}
    </div>
  )
}

function EmptyState() {
  const send = useAwon((s) => s.send)
  const suggestions = [
    {
      title: 'Build a complete website',
      icon: Hammer,
      cmd: 'Build a website for a specialty coffee roastery: 5 pages, CMS admin panel, unique palette, dark and light mode, then verify it to 10/10.',
    },
    {
      title: 'Design a logo visually',
      icon: Eye,
      cmd: 'Generate a logo for a Linux backup tool called snapvault, look at it with vision, fix any flaws, and deliver the best version in a small gallery page.',
    },
    {
      title: 'Ship an HTML app',
      icon: Kanban,
      cmd: 'Build a Kanban board as a single-file HTML app with localStorage persistence and keyboard shortcuts, then score it to 10/10.',
    },
    {
      title: 'Watch a video',
      icon: Video,
      cmd: 'Watch the video at https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4 and tell me what happens in it.',
    },
    {
      title: 'Examine an attachment',
      icon: FolderOpen,
      cmd: 'Look at the files I attached with the paperclip (or drop them on the composer) and describe each one in detail.',
    },
    {
      title: 'Research anything',
      icon: Search,
      cmd: 'Research the current state of open-source computer-use agents and give me a sourced briefing.',
    },
  ]
  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.3em] text-muted-foreground">
        <span className="awon-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        SYSTEM ONLINE / ALL TOOLS READY
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {suggestions.map((s, i) => {
          const Icon = s.icon
          return (
            <button
              key={s.title}
              onClick={() => void send(s.cmd)}
              style={{ animationDelay: `${i * 70}ms` }}
              className="awon-rise group rounded-lg border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-600/40 hover:bg-emerald-500/5 hover:shadow-lg hover:shadow-emerald-500/5 focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:outline-none"
            >
              <div className="mb-1.5 flex items-center gap-2 font-mono text-xs tracking-wider text-emerald-600 transition group-hover:text-emerald-500 dark:text-emerald-400">
                <Icon className="h-3.5 w-3.5" />
                {s.title.toUpperCase()}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{s.cmd}</p>
            </button>
          )
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-muted-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>/help</Kbd> local commands
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>/</Kbd> focus command line
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>ctrl+k</Kbd> command palette
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>ctrl+b</Kbd> preview panel
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>ctrl+j</Kbd> sessions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>&uarr;</Kbd>
          <Kbd>&darr;</Kbd> command history
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>enter</Kbd> send
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>shift+enter</Kbd> newline
        </span>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] text-foreground/80">
      {children}
    </kbd>
  )
}

export function ChatStream() {
  const items = useAwon((s) => s.items)
  const streaming = useAwon((s) => s.streaming)
  const phase = useAwon((s) => s.phase)
  const scrollRef = useRef<HTMLDivElement>(null)
  // stick-to-bottom only while the reader is actually at the bottom; scrolling
  // up to read history during a stream no longer yanks the view back down
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [items, streaming, phase, atBottom])

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 py-4 sm:px-6"
        role="log"
        aria-live="polite"
        aria-label="AWON conversation"
      >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {items.map((item) => {
          if (item.kind === 'user') {
            return <UserBubble key={item.id} text={item.text} />
          }
          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="awon-rise flex justify-start">
                <div className="group/msg relative max-w-[92%] rounded-lg rounded-bl-sm border border-l-2 border-l-emerald-600/50 bg-card px-3.5 py-2.5">
                  {item.fresh ? <Typewriter text={item.text} /> : <MarkdownBody text={item.text} />}
                  <CopyButton text={item.text} />
                </div>
              </div>
            )
          }
          if (item.kind === 'event' && item.label === 'error') {
            return <ErrorRow key={item.id} item={item} />
          }
          return <EventRow key={item.id} item={item} />
        })}

        {streaming && phase && (
          <div className="flex items-center gap-2 py-1 font-mono text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
            <span className="awon-breathe">{phase}</span>
            <ElapsedTimer />
          </div>
        )}

        {!streaming && <TurnStatsLine />}

        {items.length === 0 && !streaming && <EmptyState />}
      </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label="Jump to the latest message"
          className="awon-rise absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-emerald-600/50 bg-background/95 px-3.5 py-1.5 font-mono text-[10px] tracking-[0.2em] text-emerald-700 shadow-lg backdrop-blur transition hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600/50 dark:text-emerald-300"
        >
          JUMP TO LATEST
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export function PlanRail() {
  const plan = useAwon((s) => s.plan)
  if (!plan.length) return null
  const doneCount = plan.filter((p) => p.done).length
  const pct = Math.round((doneCount / plan.length) * 100)
  return (
    <div className="awon-rail border-b bg-muted/30 px-4 py-2.5 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground">
            EXECUTION PLAN
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="tabular-nums">
              {doneCount}/{plan.length}
            </span>
            <span className="relative h-1 w-16 overflow-hidden rounded-full bg-border">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {plan.map((p) => (
            <span
              key={p.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
                p.done
                  ? 'border-emerald-600/40 bg-emerald-500/5 text-emerald-600 line-through decoration-emerald-600/50 dark:text-emerald-400'
                  : 'border-border bg-card text-foreground/80',
              )}
            >
              {p.done ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3 animate-[spin_6s_linear_infinite]" />}
              {p.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
