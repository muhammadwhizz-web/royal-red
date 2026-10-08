'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeftRight,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
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
  Pencil,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  SunMoon,
  Terminal,
  Trash2,
  UserPlus,
  UserMinus,
  Users,
  Video,
  XCircle,
} from 'lucide-react'
import { useRoyalRed } from './store'
import type { ChatItem, ConsentPayload } from '@/lib/royal-red/types'
import { cn } from '@/lib/utils'

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="royalred-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-red-600 underline underline-offset-2 dark:text-red-400"
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
            <div className="royalred-table-wrap my-2 overflow-x-auto rounded-md border">
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
            className="break-all text-red-600 underline decoration-red-600/40 underline-offset-2 transition hover:decoration-red-500 dark:text-red-400"
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
    <div className="royalred-rise flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border/60 bg-muted/60 px-3.5 py-2 font-mono text-sm whitespace-pre-wrap shadow-sm">
        {body}
        {files.length > 0 && (
          <span className="mt-2 flex flex-wrap justify-end gap-1">
            {files.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded-full border border-red-600/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-300"
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
  const send = useRoyalRed((s) => s.send)
  const lastCommand = useRoyalRed((s) => s.lastCommand)
  const streaming = useRoyalRed((s) => s.streaming)
  return (
    <div
      role="alert"
      aria-live="polite"
      className="royalred-rise flex items-start gap-2.5 rounded-md border border-l-2 border-l-red-500/60 border-red-500/20 bg-red-500/5 px-2.5 py-2 font-mono text-xs"
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

// ── Phase 4: the kernel consent card ─────────────────────────────────────────
// One component renders every tier. T2 plan payloads get the four-option flow
// (approve / modify / type-a-rule / deny); T1 gets approve/deny; T3 gets
// per-action approve + the typed-rule override (NEVER a checkbox). The
// countdown is real: at 0 the kernel has already failed the request closed.
function ConsentCountdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)))
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))), 1000)
    return () => clearInterval(t)
  }, [expiresAt])
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-[10px] tabular-nums', left <= 20 ? 'text-red-500' : 'text-muted-foreground')}>
      <Clock className="h-3 w-3" />
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  )
}

function PlanStepsTable({ payload }: { payload: ConsentPayload }) {
  const plan = payload.plan
  if (!plan) return null
  const shown = plan.steps.slice(0, 14)
  return (
    <div className="mt-2 overflow-hidden rounded border border-border/70">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[10px] tracking-wider text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">OP</th>
            <th className="px-2 py-1.5 font-medium">FROM → TO</th>
            <th className="px-2 py-1.5 font-medium">CLASS</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.seq} className={cn('border-b border-border/40 last:border-0', !s.proposable && 'opacity-45 line-through', s.flagged && 'bg-red-500/5')}>
              <td className="px-2 py-1 text-muted-foreground">{s.seq}</td>
              <td className="px-2 py-1">
                <span className={cn('inline-flex items-center gap-1', s.op === 'trash' && 'text-red-600 dark:text-red-400')}>
                  {s.op === 'trash' && <Trash2 className="h-3 w-3" />}
                  {s.op}
                </span>
              </td>
              <td className="max-w-[340px] truncate px-2 py-1" title={`${s.from} → ${s.to || '.awon-trash'}`}>
                {s.from}
                <span className="text-muted-foreground"> → </span>
                {s.op === 'trash' ? '.awon-trash' : s.to}
              </td>
              <td className="px-2 py-1 text-muted-foreground">
                {s.class}
                {s.flagged && <span className="ml-1 rounded bg-red-500/15 px-1 text-[9px] tracking-wider text-red-600 dark:text-red-400">FLAG</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.steps.length > shown.length && (
        <p className="border-t border-border/40 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          + {plan.steps.length - shown.length} more steps (full plan in the journal)
        </p>
      )}
      {!plan.steps.some((s) => s.proposable) && (
        <p className="border-t border-border/40 bg-red-500/5 px-2 py-1.5 font-mono text-[10px] text-red-600 dark:text-red-400">
          every operation was refused by the dry-run - nothing can be proposed
        </p>
      )}
    </div>
  )
}

function ConsentCard({ item }: { item: Extract<ChatItem, { kind: 'consent' }> }) {
  const answerConsent = useRoyalRed((s) => s.answerConsent)
  const streaming = useRoyalRed((s) => s.streaming)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [ruleText, setRuleText] = useState('')
  const [modifyMode, setModifyMode] = useState(false)
  const [kept, setKept] = useState<Set<number>>(() => new Set((item.payload?.plan?.steps ?? []).filter((s) => s.proposable).map((s) => s.seq)))
  const pending = item.status === 'pending'
  const tierColor =
    item.tier === 1
      ? 'border-emerald-600/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
      : item.tier === 2
        ? 'border-amber-600/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
        : 'border-red-600/40 bg-red-500/5 text-red-700 dark:text-red-300'
  const TierIcon = item.tier === 3 ? ShieldAlert : ShieldCheck

  const sendModified = () => {
    const plan = item.payload?.plan
    if (!plan) return
    const steps = plan.steps.filter((s) => s.proposable && kept.has(s.seq))
    const byClass: Record<string, number> = {}
    for (const s of steps) byClass[s.class ?? 'other'] = (byClass[s.class ?? 'other'] ?? 0) + 1
    answerConsent(item.id, 'modify').then(() => {
      // the kernel re-plans from the kept steps; the decision row already went
      // through with the modified payload built here
      void fetch(`/api/royal-red/desktop/consent/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'modify',
          modifiedPayload: {
            ...item.payload,
            plan: {
              ...plan,
              steps,
              summary: { ...plan.summary, proposable: steps.length, flagged: steps.filter((s) => s.flagged).length, byClass },
            },
          },
        }),
      }).catch(() => null)
    })
  }

  const statusBadge = () => {
    if (pending) return null
    const map: Record<string, { label: string; cls: string }> = {
      approved: { label: item.decision === 'modify' ? 'APPROVED (MODIFIED)' : 'APPROVED', cls: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
      denied: { label: 'DENIED', cls: 'border-red-600/40 bg-red-500/10 text-red-600 dark:text-red-400' },
      expired: { label: 'EXPIRED (FAIL-CLOSED)', cls: 'border-border bg-muted/40 text-muted-foreground' },
      frozen: { label: 'FROZEN BY KILL SWITCH', cls: 'border-red-600/40 bg-red-500/10 text-red-600 dark:text-red-400' },
    }
    const b = map[item.status] ?? map.expired
    return <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-widest', b.cls)}>{b.label}</span>
  }

  return (
    <div
      role="group"
      aria-label={`Consent request: ${item.title}`}
      className={cn(
        'royalred-rise rounded-2xl border bg-card p-3 font-mono text-xs shadow-sm transition',
        item.tier === 3 && pending && 'border-red-600/40',
        item.tier === 2 && pending && 'border-amber-600/40',
        item.tier === 1 && pending && 'border-emerald-600/40',
        !pending && 'opacity-90',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.15em]', tierColor)}>
          <TierIcon className="h-3 w-3" />
          TIER {item.tier} · {item.tier === 1 ? 'READ' : item.tier === 2 ? 'WRITE' : 'DESTRUCTIVE'}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground/90" title={item.title}>
          {item.title}
        </span>
        {pending && item.expiresAt && <ConsentCountdown expiresAt={item.expiresAt} />}
        {statusBadge()}
      </div>

      {item.detail && <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p>}

      {item.payload?.kind === 'plan' && <PlanStepsTable payload={item.payload} />}
      {item.payload?.kind === 'single' && item.payload.step && (
        <div className="mt-2 rounded border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px]">
          <span className="text-red-600 dark:text-red-400">{item.payload.step.op}</span> <span className="text-foreground/85">{item.payload.step.from}</span>
          <span className="text-muted-foreground"> → .awon-trash (restorable, never deleted)</span>
        </div>
      )}
      {item.payload?.kind === 'shell' && item.payload.command && (
        <pre className="mt-2 max-h-32 overflow-auto rounded border border-border/70 bg-muted/40 p-2.5 text-[11px] whitespace-pre-wrap break-words text-foreground/85">
          $ {item.payload.command}
        </pre>
      )}
      {item.payload?.kind === 'undo' && item.payload.steps && (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded border border-border/70 bg-muted/30 p-2.5 font-mono text-[11px] text-muted-foreground">
          {item.payload.steps.slice(0, 12).map((s, i) => (
            <li key={i} className="truncate">
              ↩ {s}
            </li>
          ))}
          {item.payload.steps.length > 12 && <li>+ {item.payload.steps.length - 12} more</li>}
        </ul>
      )}

      {pending && streaming && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {item.tier === 1 ? (
            <>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'approve')}
                className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] tracking-widest text-emerald-700 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600/50 dark:text-emerald-300"
              >
                <Check className="mr-1 inline h-3 w-3" />APPROVE READ
              </button>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'deny')}
                className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-red-600/40 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-foreground/70"
              >
                <Ban className="mr-1 inline h-3 w-3" />DENY
              </button>
            </>
          ) : item.tier === 2 ? (
            <>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'approve')}
                className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] tracking-widest text-emerald-700 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-600/50 dark:text-emerald-300"
              >
                <Check className="mr-1 inline h-3 w-3" />APPROVE
              </button>
              {item.payload?.kind === 'plan' && (
                <button
                  type="button"
                  onClick={() => setModifyMode((v) => !v)}
                  aria-expanded={modifyMode}
                  className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-amber-600/40 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-600/50 dark:text-foreground/70 dark:hover:text-amber-300"
                >
                  <Pencil className="mr-1 inline h-3 w-3" />MODIFY
                </button>
              )}
              <button
                type="button"
                onClick={() => setRuleOpen((v) => !v)}
                aria-expanded={ruleOpen}
                className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-red-600/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-foreground/70"
              >
                <PenLineIcon className="mr-1 inline h-3 w-3" />TYPE A RULE
              </button>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'deny')}
                className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-red-600/40 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-foreground/70"
              >
                <Ban className="mr-1 inline h-3 w-3" />DENY
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'approve')}
                className="rounded border border-red-600/50 bg-red-500/10 px-2.5 py-1.5 text-[11px] tracking-widest text-red-700 transition hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-red-300"
              >
                <Check className="mr-1 inline h-3 w-3" />APPROVE THIS ACTION
              </button>
              <button
                type="button"
                onClick={() => setRuleOpen((v) => !v)}
                aria-expanded={ruleOpen}
                className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-red-600/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-foreground/70"
              >
                <PenLineIcon className="mr-1 inline h-3 w-3" />TYPE A RULE
              </button>
              <button
                type="button"
                onClick={() => void answerConsent(item.id, 'deny')}
                className="rounded border border-border bg-background/60 px-2.5 py-1.5 text-[11px] tracking-widest text-muted-foreground transition hover:border-red-600/40 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-foreground/70"
              >
                <Ban className="mr-1 inline h-3 w-3" />DENY
              </button>
            </>
          )}
        </div>
      )}

      {pending && streaming && modifyMode && item.payload?.kind === 'plan' && (
        <div className="mt-2 rounded border border-amber-600/40 bg-amber-500/5 p-2.5">
          <p className="mb-1.5 font-mono text-[10px] tracking-wider text-amber-700 dark:text-amber-300">EDIT THE PLAN - uncheck what should NOT run, then apply:</p>
          <ul className="max-h-36 space-y-1 overflow-auto">
            {item.payload.plan?.steps.filter((s) => s.proposable).map((s) => (
              <li key={s.seq} className="flex items-center gap-2 font-mono text-[11px]">
                <input
                  type="checkbox"
                  id={`kept-${item.id}-${s.seq}`}
                  checked={kept.has(s.seq)}
                  onChange={() =>
                    setKept((prev) => {
                      const nx = new Set(prev)
                      if (nx.has(s.seq)) nx.delete(s.seq)
                      else nx.add(s.seq)
                      return nx
                    })
                  }
                  className="h-3 w-3 accent-red-600"
                />
                <label htmlFor={`kept-${item.id}-${s.seq}`} className="min-w-0 flex-1 cursor-pointer truncate text-muted-foreground">
                  {s.op}: {s.from}
                  {s.to ? ` → ${s.to}` : ''}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={sendModified}
            className="mt-2 rounded border border-amber-600/50 bg-amber-500/10 px-2.5 py-1.5 text-[11px] tracking-widest text-amber-700 transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-600/50 dark:text-amber-300"
          >
            APPLY MODIFIED PLAN ({kept.size} OF {item.payload.plan?.steps.filter((s) => s.proposable).length})
          </button>
        </div>
      )}

      {pending && streaming && ruleOpen && (
        <div className="mt-2 rounded border border-red-600/40 bg-red-500/5 p-2.5">
          <p className="mb-1.5 font-mono text-[10px] leading-relaxed text-red-700 dark:text-red-300">
            permanent consent is ONLY created by typing the rule verbatim - there is no checkbox anywhere in this product.
            {item.payload?.kind === 'shell' && item.payload.command && <> type exactly: <span className="text-foreground">always allow shell_exec: {item.payload.command.slice(0, 60)}</span></>}
          </p>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder="always allow box_trash for Downloads/*.tmp"
              aria-label="Rule text (typed, required)"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-red-600/50"
            />
            <button
              type="button"
              disabled={ruleText.trim().length < 8}
              onClick={() => void answerConsent(item.id, 'rule', ruleText.trim())}
              className="rounded border border-red-600/50 bg-red-500/10 px-2.5 py-1.5 text-[11px] tracking-widest text-red-700 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-red-300"
            >
              SAVE RULE
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// tiny alias so the JSX above stays tidy
function PenLineIcon({ className }: { className?: string }) {
  return <Pencil className={className} />
}

function EventRow({ item }: { item: Extract<ChatItem, { kind: 'event' }> }) {
  const ToolIcon = TOOL_ICONS[toolIconKey(item.label)] ?? Terminal
  const [open, setOpen] = useState(false)
  const output = item.output ?? item.detail
  const expandable = Boolean(output && output.length > 90)
  const detail = item.detail ? stripMd(item.detail) : item.detail
  return (
    <div className="royalred-rise group/evt flex items-start gap-2.5 py-1 font-mono text-xs">
      <span className="mt-0.5 shrink-0">
        {item.status === 'run' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
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
                item.status === 'run' && 'animate-pulse text-red-600 dark:text-red-400',
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
          <pre className="royalred-detail mt-1.5 max-h-56 overflow-auto rounded-md border border-l-2 border-l-red-600/50 bg-muted/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            <DetailText text={output} />
          </pre>
        )}
      </div>
    </div>
  )
}

function ElapsedTimer() {
  const startedAt = useRoyalRed((s) => s.phaseStartedAt)
  // Date.now() is impure: the clock is seeded inside the effect, never in render
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!startedAt) return
    // the interval callback (an external clock) owns every setNow; the first
    // tick lands within one second, so the display starts at 0s exactly as before
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  if (!startedAt) return null
  const secs = Math.max(0, Math.round(((now ?? startedAt) - startedAt) / 1000))
  return <span className="tabular-nums text-muted-foreground/70">{secs}s</span>
}

// tiny telemetry line rendered after a finished turn: how long it took and how
// many tools ran (client-measured; cleared on the next send)
function TurnStatsLine() {
  const stats = useRoyalRed((s) => s.turnStats)
  if (!stats) return null
  return (
    <div
      className="royalred-rise flex items-center justify-center gap-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/70"
      aria-label="Turn statistics"
    >
      <span className="h-1 w-1 rounded-full bg-red-500/60" aria-hidden="true" />
      turn complete / {stats.secs}s / {stats.tools} tool{stats.tools === 1 ? '' : 's'}
    </div>
  )
}

function EmptyState() {
  const send = useRoyalRed((s) => s.send)
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
        <span className="royalred-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
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
              className="royalred-rise group rounded-2xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-red-600/40 hover:bg-red-500/5 hover:shadow-lg hover:shadow-red-500/5 focus-visible:ring-2 focus-visible:ring-red-600/40 focus-visible:outline-none"
            >
              <div className="mb-1.5 flex items-center gap-2 font-mono text-xs tracking-wider text-red-600 transition group-hover:text-red-500 dark:text-red-400">
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
  const items = useRoyalRed((s) => s.items)
  const streaming = useRoyalRed((s) => s.streaming)
  const phase = useRoyalRed((s) => s.phase)
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
        aria-label="ROYAL RED conversation"
      >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {items.map((item) => {
          if (item.kind === 'user') {
            return <UserBubble key={item.id} text={item.text} />
          }
          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="royalred-rise flex justify-start">
                <div className="group/msg relative max-w-[92%] rounded-2xl rounded-bl-md border border-l-2 border-l-red-600/50 bg-card/95 px-3.5 py-2.5 shadow-[0_10px_30px_-18px_rgba(239,68,68,0.4)]">
                  {item.fresh ? <Typewriter text={item.text} /> : <MarkdownBody text={item.text} />}
                  <CopyButton text={item.text} />
                </div>
              </div>
            )
          }
          if (item.kind === 'event' && item.label === 'error') {
            return <ErrorRow key={item.id} item={item} />
          }
          if (item.kind === 'consent') {
            return <ConsentCard key={item.id} item={item} />
          }
          return <EventRow key={item.id} item={item} />
        })}

        {streaming && phase && (
          <div className="flex items-center gap-2 py-1 font-mono text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
            <span className="royalred-breathe">{phase}</span>
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
          className="royalred-rise absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-red-600/50 bg-background/95 px-3.5 py-1.5 font-mono text-[10px] tracking-[0.2em] text-red-700 shadow-lg backdrop-blur transition hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-600/50 dark:text-red-300"
        >
          JUMP TO LATEST
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export function PlanRail() {
  const plan = useRoyalRed((s) => s.plan)
  if (!plan.length) return null
  const doneCount = plan.filter((p) => p.done).length
  const pct = Math.round((doneCount / plan.length) * 100)
  return (
    <div className="royalred-rail border-b bg-muted/30 px-4 py-2.5 sm:px-6">
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
                className="block h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
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
