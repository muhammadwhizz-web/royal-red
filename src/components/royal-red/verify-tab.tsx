'use client'

// VERIFY tab (Phase 2.6): the honest score dashboard. Renders the receipts
// produced by the verification engine - per-constraint pass/fail with
// evidence, the independent critique (labeled by independence mode), visual
// regression diffs, cms panel proof and the competitor benchmark matrix.
// Every number on this screen has a receipt behind it; nothing is inflated.

import { useState } from 'react'
import { useRoyalRed } from './store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  BadgeCheck,
  Ban,
  Check,
  ChevronDown,
  CircleSlash,
  Cpu,
  Eye,
  Gauge,
  HelpCircle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ScanEye,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Trophy,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- receipt payload shapes (mirror the kernel modules) ----

interface LedgerData {
  items?: { cid: string; category: string; text: string; assertion: string; weight: number }[]
  verdicts?: { cid: string; verdict: string; evidence: string; method: string }[]
  passed?: number
  failed?: number
  unclear?: number
}
interface CritiqueData {
  critique?: {
    status: string
    mode: string
    provider: string
    model: string
    score: number
    perConstraint?: { cid: string; verdict: string; evidence: string }[]
    deductions?: string[]
    summary: string
  }
  builderScore?: number | null
  delta?: number
  disagree?: boolean
  honestScore?: number | null
}
interface VisualData {
  runId?: string
  shots?: { viewport: string; ok: boolean; relFile?: string; hash?: string; error?: string }[]
  diffs?: {
    viewport: string
    baselineRun: string | null
    hamming: number
    similarity: number
    changedPct: number
    verdict: string
    changedRegions?: { tile: number; row: number; col: number; delta: number }[]
  }[]
}
interface CmsData {
  cmsUrl?: string
  steps?: { step: string; pass: boolean; detail: string; shot?: string }[]
  status?: string
  summary?: string
}
interface BenchmarkData {
  categoryLabel?: string
  royalRedTotal?: number
  competitorAvg?: number
  matrix?: { id: string; label: string; max: number }[]
  royalRed?: { accessible: boolean; total: number; scores: Record<string, number>; error?: string }
  competitors?: { label: string; accessible: boolean; total: number; url: string; error?: string }[]
  verdict?: { wins: string[]; losses: string[] }
}
interface ProviderRow {
  id: string
  provider: string
  label: string
  baseUrl: string
  model: string
  keyHint: string | null
  hasKey: boolean
  active: boolean
}

const CATEGORIES = [
  'saas-landing',
  'ecommerce',
  'portfolio',
  'blog',
  'restaurant',
  'docs',
  'dashboard',
  'agency',
  'event',
  'nonprofit',
]

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: typeof Check; label: string }> = {
    pass: { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', icon: Check, label: 'PASS' },
    fail: { cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30', icon: X, label: 'FAIL' },
    partial: { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30', icon: TriangleAlert, label: 'PARTIAL' },
    error: { cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30', icon: Ban, label: 'ERROR' },
    unverified: { cls: 'bg-muted text-muted-foreground border-border', icon: CircleSlash, label: 'UNVERIFIED' },
    run: { cls: 'bg-muted text-muted-foreground border-border', icon: Loader2, label: 'RUNNING' },
    new: { cls: 'bg-muted text-muted-foreground border-border', icon: Eye, label: 'NEW BASELINE' },
    identical: { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', icon: Check, label: 'IDENTICAL' },
    minor: { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30', icon: TriangleAlert, label: 'MINOR' },
    changed: { cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30', icon: TriangleAlert, label: 'CHANGED' },
  }
  const m = map[status] ?? map.unverified
  const Icon = m.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider', m.cls)}>
      <Icon className={cn('h-2.5 w-2.5', status === 'run' && 'animate-spin')} />
      {m.label}
    </span>
  )
}

function SectionHeader({ icon: Icon, title, right }: { icon: typeof ScanEye; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        {title}
      </h3>
      {right}
    </div>
  )
}

function shotUrl(relFile?: string): string | null {
  if (!relFile) return null
  const parts = relFile.split('/')
  if (parts.length !== 3) return null
  return `/api/royal-red/verify-shot?run=${encodeURIComponent(parts[1])}&name=${encodeURIComponent(parts[2])}`
}

function LedgerSection({ data }: { data: LedgerData }) {
  const items = data.items ?? []
  const verdicts = new Map((data.verdicts ?? []).map((v) => [v.cid, v]))
  if (!items.length) {
    return <p className="font-mono text-[10px] text-muted-foreground">no constraint ledger for this session. constraints appear when a substantive build command runs.</p>
  }
  return (
    <div className="space-y-1">
      {items.map((it) => {
        const v = verdicts.get(it.cid)
        const verdict = v?.verdict ?? 'unverified'
        return (
          <div key={it.cid} className="rounded border bg-muted/30 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  <span className="text-red-700 dark:text-red-300">[{it.cid}]</span>{' '}
                  <span className="uppercase">{it.category}</span>
                  {it.weight === 2 ? ' · MUST' : ''}
                </p>
                <p className="text-[11px] leading-snug">{it.text}</p>
              </div>
              <StatusPill status={verdict} />
            </div>
            {v?.evidence && (
              <p className={cn('mt-1 border-l-2 pl-2 font-mono text-[9.5px] leading-relaxed break-words',
                v.verdict === 'pass' ? 'border-emerald-500/40 text-muted-foreground' : v.verdict === 'fail' ? 'border-red-500/40 text-red-600 dark:text-red-300' : 'border-amber-500/40 text-amber-700 dark:text-amber-300')}>
                {v.method === 'deterministic' ? 'kernel: ' : v.method === 'critic' ? 'critic: ' : ''}{v.evidence}
              </p>
            )}
          </div>
        )
      })}
      <div className="flex gap-2 pt-1 font-mono text-[10px] text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-400">{data.passed ?? 0} pass</span>
        <span className="text-red-500">{data.failed ?? 0} fail</span>
        <span>{data.unclear ?? 0} unclear</span>
      </div>
    </div>
  )
}

function CritiqueSection({ data }: { data: CritiqueData }) {
  const c = data.critique
  if (!c) return <p className="font-mono text-[10px] text-muted-foreground">no critique receipt yet.</p>
  const independent = c.mode === 'independent-provider'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{c.score.toFixed(1)}</span>
        <span className="font-mono text-[10px] text-muted-foreground">critic</span>
        {typeof data.builderScore === 'number' && (
          <>
            <span className="font-mono text-[10px] text-muted-foreground">vs builder {data.builderScore}/10</span>
            <StatusPill status={data.disagree ? 'changed' : 'pass'} />
          </>
        )}
      </div>
      <p className="font-mono text-[9.5px] leading-relaxed text-muted-foreground">
        {independent ? 'INDEPENDENT PROVIDER' : 'SAME-FAMILY, FRESH CONTEXT'} · {c.provider}/{c.model}
        {!independent && ' · configure a second-model key below for a fully independent critic'}
      </p>
      {c.status !== 'ok' && <p className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-300">{c.summary}</p>}
      {!!c.deductions?.length && (
        <ul className="space-y-1">
          {c.deductions.map((d, i) => (
            <li key={i} className="border-l-2 border-amber-500/40 pl-2 text-[11px] leading-snug text-amber-800 dark:text-amber-200">{d}</li>
          ))}
        </ul>
      )}
      {c.status === 'ok' && <p className="text-[11px] leading-snug text-muted-foreground">{c.summary}</p>}
      {typeof data.honestScore === 'number' && (
        <p className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">honest score: {data.honestScore}/10 (min of judges)</p>
      )}
    </div>
  )
}

function VisualSection({ data }: { data: VisualData }) {
  const shots = data.shots ?? []
  const diffs = new Map((data.diffs ?? []).map((d) => [d.viewport, d]))
  if (!shots.length) return <p className="font-mono text-[10px] text-muted-foreground">no visual receipts yet.</p>
  return (
    <div className="grid grid-cols-3 gap-2">
      {shots.map((s) => {
        const d = diffs.get(s.viewport)
        const url = shotUrl(s.relFile)
        return (
          <div key={s.viewport} className="rounded border bg-muted/30 p-1.5">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="font-mono text-[9px] uppercase text-muted-foreground">{s.viewport}</span>
              {s.ok ? <StatusPill status={d?.verdict ?? 'unverified'} /> : <StatusPill status="error" />}
            </div>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border">
                {/* proof screenshots come from the kernel's own API paths - plain <img> is deliberate */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${s.viewport} screenshot of the verified artifact`} className="h-20 w-full object-cover object-top" loading="lazy" />
              </a>
            ) : (
              <div className="flex h-20 items-center justify-center rounded border border-dashed font-mono text-[9px] text-muted-foreground">
                {s.error?.slice(0, 60) ?? 'no shot'}
              </div>
            )}
            {s.ok && d && (
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-muted-foreground">
                {d.baselineRun ? `hamming ${d.hamming}/64 · ${d.changedPct}% regions` : 'new baseline stored'}
              </p>
            )}
            {d?.changedRegions?.length ? (
              <div className="mt-1 grid grid-cols-8 gap-[1px]">
                {Array.from({ length: 64 }).map((_, t) => {
                  const changed = d.changedRegions?.some((r) => r.tile === t)
                  return <span key={t} className={cn('aspect-square rounded-[1px]', changed ? 'bg-red-500/70' : 'bg-muted')} />
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function CmsSection({ data }: { data: CmsData }) {
  const steps = data.steps ?? []
  if (!steps.length) return <p className="font-mono text-[10px] text-muted-foreground">this artifact ships no cms page, so there is no panel to proof.</p>
  return (
    <div className="space-y-1">
      {steps.map((s) => (
        <div key={s.step} className="flex items-start gap-2 rounded border bg-muted/30 p-1.5">
          {s.pass ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">{s.step.replace(/-/g, ' ')}</p>
            <p className="text-[10.5px] leading-snug">{s.detail}</p>
          </div>
          {s.shot && shotUrl(s.shot) && (
            <a href={shotUrl(s.shot)!} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- kernel-generated proof screenshot paths */}
              <img src={shotUrl(s.shot)!} alt={`proof screenshot for ${s.step}`} className="h-10 w-16 rounded border object-cover object-top" loading="lazy" />
            </a>
          )}
        </div>
      ))}
      {data.cmsUrl && (
        <p className="truncate font-mono text-[9px] text-muted-foreground">panel: {data.cmsUrl.replace(/^https?:\/\//, '')}</p>
      )}
    </div>
  )
}

function BenchmarkSection({ data }: { data: BenchmarkData }) {
  if (!data.matrix) return <p className="font-mono text-[10px] text-muted-foreground">no benchmark receipt yet. run one from the button above.</p>
  const accessible = (data.competitors ?? []).filter((c) => c.accessible)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{data.royalRedTotal ?? 0}<span className="text-[11px] text-muted-foreground">/60</span></span>
        <span className="font-mono text-[10px] text-muted-foreground">vs {accessible.length} competitors avg {data.competitorAvg}/60</span>
        <span className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{data.categoryLabel}</span>
      </div>
      {(data.verdict?.wins?.length || data.verdict?.losses?.length) ? (
        <div className="grid gap-1 sm:grid-cols-2">
          <div>
            <p className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-emerald-600 dark:text-emerald-400"><Trophy className="h-3 w-3" /> wins</p>
            {(data.verdict?.wins ?? []).map((w, i) => <p key={i} className="text-[10px] leading-snug text-muted-foreground">{w}</p>)}
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase text-red-500"><TriangleAlert className="h-3 w-3" /> losses</p>
            {(data.verdict?.losses ?? []).map((l, i) => <p key={i} className="text-[10px] leading-snug text-muted-foreground">{l}</p>)}
          </div>
        </div>
      ) : null}
      <div className="max-h-48 overflow-y-auto rounded border">
        <table className="w-full font-mono text-[9.5px]">
          <thead className="sticky top-0 bg-muted/70 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1 font-normal">check</th>
              <th className="px-1 py-1 text-right font-normal">ROYAL RED</th>
              <th className="px-1 py-1 text-right font-normal">avg</th>
            </tr>
          </thead>
          <tbody>
            {(data.matrix ?? []).map((m) => {
              const mine = data.royalRed?.scores?.[m.id]
              const avg = accessible.length ? accessible.reduce((s, c) => s + (c.scores?.[m.id] ?? 0), 0) / accessible.length : null
              return (
                <tr key={m.id} className="border-t border-border/60">
                  <td className="px-2 py-1 text-muted-foreground">{m.label}</td>
                  <td className={cn('px-1 py-1 text-right', typeof mine === 'number' && mine >= m.max * 0.99 ? 'text-emerald-600 dark:text-emerald-400' : typeof mine === 'number' && mine === 0 ? 'text-red-500' : '')}>
                    {typeof mine === 'number' ? Math.round(mine) : '-'}
                  </td>
                  <td className="px-1 py-1 text-right text-muted-foreground">{avg !== null ? Math.round(avg * 10) / 10 : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-0.5">
        {(data.competitors ?? []).slice(0, 10).map((c) => (
          <p key={c.url} className="truncate font-mono text-[9px] text-muted-foreground">
            {c.accessible ? <Check className="mr-1 inline h-2.5 w-2.5 text-emerald-600" /> : <X className="mr-1 inline h-2.5 w-2.5 text-red-500" />}
            {c.label} · {c.accessible ? `${Math.round(c.total)}/60` : c.error ?? 'inaccessible'}
          </p>
        ))}
      </div>
    </div>
  )
}

// ---- critic model (provider) config ----

function ProviderConfig() {
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ provider: 'openai', label: '', baseUrl: '', model: '', apiKey: '' })
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/royal-red/providers')
      if (res.ok) {
        const data = (await res.json()) as { providers: ProviderRow[] }
        setProviders(data.providers)
      }
    } catch {}
    setLoaded(true)
  }
  const submit = async () => {
    setErr(null)
    if (!form.label.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      setErr('label, base url and model are required')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/royal-red/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, activate: true }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setErr(data.error ?? `failed (${res.status})`)
        return
      }
      setForm({ provider: 'openai', label: '', baseUrl: '', model: '', apiKey: '' })
      await load()
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (p: ProviderRow) => {
    setBusy(true)
    try {
      await fetch('/api/royal-red/providers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, active: !p.active }) })
      await load()
    } finally {
      setBusy(false)
    }
  }
  const remove = async (p: ProviderRow) => {
    setBusy(true)
    try {
      await fetch(`/api/royal-red/providers?id=${p.id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <button onClick={() => void load()} className="flex w-full items-center gap-2 rounded border border-dashed p-2 font-mono text-[10px] text-muted-foreground transition-colors hover:border-red-500/40 hover:text-foreground">
        <KeyRound className="h-3.5 w-3.5" /> configure a second-model critic (BYO key)
      </button>
    )
  }

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded border bg-muted/30 p-2">
          <Cpu className={cn('h-3.5 w-3.5 shrink-0', p.active ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px]">{p.label} <span className="font-mono text-[9px] text-muted-foreground">{p.provider}/{p.model}</span></p>
            <p className="truncate font-mono text-[9px] text-muted-foreground">{p.baseUrl} · key {p.keyHint ?? 'none'}</p>
          </div>
          <button onClick={() => void toggle(p)} disabled={busy} aria-label={p.active ? 'deactivate critic model' : 'activate critic model'} className={cn('rounded px-1.5 py-1 font-mono text-[9px]', p.active ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-muted text-muted-foreground hover:text-foreground')}>
            {p.active ? 'ACTIVE' : 'USE'}
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button aria-label={`remove ${p.label}`} className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-mono">remove critic model?</AlertDialogTitle>
                <AlertDialogDescription>
                  {p.label} will be deleted with its stored key. Critique falls back to the local model with fresh context.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void remove(p)}>remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ))}
      <details className="rounded border border-dashed p-2">
        <summary className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <Plus className="h-3 w-3" /> add critique provider
        </summary>
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={form.provider} onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}>
              <SelectTrigger className="h-7 font-mono text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">openai-compatible</SelectItem>
                <SelectItem value="anthropic">anthropic</SelectItem>
                <SelectItem value="custom">custom gateway</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-7 font-mono text-[10px]" placeholder="label (e.g. gpt-5 critic)" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <Input className="h-7 font-mono text-[10px]" placeholder="base url (https://api.openai.com/v1)" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          <Input className="h-7 font-mono text-[10px]" placeholder="model id" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
          <Input className="h-7 font-mono text-[10px]" type="password" placeholder="api key (stored AES-256-GCM encrypted)" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
          {err && <p className="font-mono text-[9px] text-red-500">{err}</p>}
          <Button size="sm" className="h-7 w-full font-mono text-[10px]" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'save provider'}
          </Button>
          <p className="font-mono text-[8.5px] leading-relaxed text-muted-foreground">
            the key never leaves the server after storage; only a masked hint is ever displayed. the critic model is used EXCLUSIVELY for verification, never for building.
          </p>
        </div>
      </details>
    </div>
  )
}

export function VerifyTab() {
  const receipts = useRoyalRed((s) => s.verifyReceipts)
  const verifying = useRoyalRed((s) => s.verifying)
  const constraints = useRoyalRed((s) => s.constraints)
  const artifact = useRoyalRed((s) => s.artifact)
  const rerunVerification = useRoyalRed((s) => s.rerunVerification)
  const [benchCat, setBenchCat] = useState('saas-landing')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ ledger: true, critique: true })

  const toggleSection = (k: string) => setOpenSections((o) => ({ ...o, [k]: !o[k] }))

  const ledger = receipts.ledger
  const critique = receipts.critique
  const visual = receipts.visual
  const cms = receipts.cms
  const benchmark = receipts.benchmark
  const honest = (critique?.data as CritiqueData | undefined)?.honestScore

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3 pb-8">
        {/* honest score banner */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> VERIFICATION 2.0
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {artifact ? (
                  <>proof-testing <span className="text-foreground">{artifact.name}</span>{typeof honest === 'number' ? <> · honest score <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">{honest}/10</span></> : ''}</>
                ) : (
                  'no artifact selected. receipts appear after a build turn or /verify.'
                )}
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 border-emerald-500/40 font-mono text-[10px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" disabled={verifying || !artifact} onClick={() => void rerunVerification()}>
              {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              re-run
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(['ledger', 'critique', 'visual', 'cms', 'benchmark'] as const).map((k) => {
              const r = receipts[k]
              if (!r && k !== 'ledger') return null
              const label = k === 'benchmark' && !r ? null : k
              if (!label) return null
              return (
                <StatusPill key={k} status={r?.status ?? (k === 'ledger' ? 'unverified' : 'run')} />
              )
            })}
            <div className="ml-auto flex items-center gap-1">
              <Select value={benchCat} onValueChange={setBenchCat}>
                <SelectTrigger className="h-6 w-36 font-mono text-[9px]" aria-label="benchmark category"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="font-mono text-[10px]">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 font-mono text-[9px]" disabled={verifying || !artifact} onClick={() => void rerunVerification(benchCat)}>
                <Gauge className="h-3 w-3" /> 10-site matrix
              </Button>
            </div>
          </div>
        </div>

        {/* constraint ledger */}
        <section className="space-y-2">
          <button onClick={() => toggleSection('ledger')} className="flex w-full items-center justify-between" aria-expanded={openSections.ledger}>
            <SectionHeader icon={ScanEye} title={`CONSTRAINT LEDGER${constraints.length ? ` (${constraints.length})` : ''}`} />
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', openSections.ledger && 'rotate-180')} />
          </button>
          {openSections.ledger && <LedgerSection data={(ledger?.data as LedgerData | undefined) ?? {}} />}
        </section>

        {/* adversarial critique */}
        <section className="space-y-2">
          <button onClick={() => toggleSection('critique')} className="flex w-full items-center justify-between" aria-expanded={openSections.critique}>
            <SectionHeader icon={BadgeCheck} title="ADVERSARIAL CRITIQUE" />
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', openSections.critique && 'rotate-180')} />
          </button>
          {openSections.critique && <CritiqueSection data={(critique?.data as CritiqueData | undefined) ?? {}} />}
        </section>

        {/* visual regression */}
        <section className="space-y-2">
          <SectionHeader icon={Eye} title="VISUAL REGRESSION" />
          <VisualSection data={(visual?.data as VisualData | undefined) ?? {}} />
        </section>

        {/* cms proof */}
        <section className="space-y-2">
          <SectionHeader icon={KeyRound} title="CMS PANEL PROOF" />
          <CmsSection data={(cms?.data as CmsData | undefined) ?? {}} />
        </section>

        {/* benchmark */}
        <section className="space-y-2">
          <SectionHeader icon={Trophy} title="COMPETITOR BENCHMARK" />
          <BenchmarkSection data={(benchmark?.data as BenchmarkData | undefined) ?? {}} />
        </section>

        {/* critic model config */}
        <section className="space-y-2">
          <SectionHeader icon={Cpu} title="CRITIC MODEL" />
          <ProviderConfig />
        </section>

        <p className="flex items-start gap-1.5 border-t pt-3 font-mono text-[9px] leading-relaxed text-muted-foreground">
          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
          deterministic checks run in the kernel; semantic verdicts are labeled by their judge. the displayed score is always the minimum across judges. fail closed: missing receipts show as unverified, never as pass.
        </p>
      </div>
    </ScrollArea>
  )
}
