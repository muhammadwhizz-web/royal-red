'use client'

// ROYAL RED SETTINGS cockpit (Round 7).
//
// The single place the user configures everything: 96 providers and their
// keys, routing preferences, connectors, MCP servers, skills, general
// settings, data and privacy, security, and the About ledger. Every change is
// saved immediately, every mutation writes an audit row server side, and keys
// are NEVER rendered: masked hints only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------- shared shapes ----------------

export interface MatrixProvider {
  id: string
  label: string
  protocol: string
  modalities: string[]
  tier: string
  local: boolean
  model: string
  defaultModel: string
  baseUrl: string
  baseUrlOverride: string | null
  cost: Record<string, number>
  priceNote?: string
  endpointNote?: string
  freeTier: boolean
  region: string
  requiresKey: boolean
  keyConfigured: boolean | null
  keyHint: string | null
  disabled: boolean
  orgId: string | null
  headersJson: string | null
  adapterReady: boolean
  supportsTools: boolean
  supportsStreaming: boolean
  lastSuccessAt: string | null
  lastProbeAt: string | null
  lastError: string | null
  successCount: number
  failureCount: number
  avgLatencyMs: number
  health: string
  healthLatencyMs: number | null
  healthDetail: string | null
}

interface RouterPrefsShape {
  priority: string[]
  fallbackBehavior: string
  costCeilingUsd: number
  localFirst: boolean
  freeTierFirst: boolean
  region: string
  allowlist: string[]
  denylist: string[]
  rateLimitBehavior: string
}

interface ConnectorView {
  id: string
  label: string
  category: string
  authType: string
  baseUrl: string
  docsUrl: string
  keyFormat?: string
  built: boolean
  status: string
  credHint: string | null
  config: Record<string, string> | null
  lastCheckAt: string | null
  lastUsedAt: string | null
  lastError: string | null
  toolCount: number
}

interface McpTool {
  name: string
  description?: string
}

interface McpServerView {
  id: string
  name: string
  label: string
  type: string
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
  hasToken: boolean
  enabled: boolean
  status: string
  tools: McpTool[]
  resources: Array<{ uri: string; name?: string }>
  prompts: Array<{ name: string; description?: string }>
  lastConnectedAt: string | null
  lastError: string | null
}

interface McpCatalogEntry {
  id: string
  label: string
  description: string
  type: string
  command?: string
  args?: string[]
  url?: string
  note?: string
}

interface SkillView {
  skillId: string
  name: string
  description: string
  author: string
  version: string
  source: string
  sourceRef?: string
  enabled: boolean
  installed?: boolean
  tools: Array<{ name: string; description: string; permission: string }>
  prompts: string[]
  instructions?: string
}

type ProviderStatus = 'connected' | 'key-set' | 'no-key' | 'error' | 'disabled' | 'local'

function providerStatus(p: MatrixProvider): ProviderStatus {
  if (p.disabled) return 'disabled'
  if (!p.requiresKey) {
    if (p.health === 'reachable') return 'connected'
    if (p.health === 'unreachable' || p.health === 'breaker-open') return 'error'
    return 'local'
  }
  if (!p.keyConfigured) return 'no-key'
  if (p.health === 'unreachable' || p.health === 'breaker-open') return 'error'
  if (p.health === 'reachable') return 'connected'
  return 'key-set'
}

const STATUS_STYLE: Record<ProviderStatus, string> = {
  connected: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'key-set': 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'no-key': 'border-border text-muted-foreground',
  error: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
  disabled: 'border-border bg-muted text-muted-foreground line-through',
  local: 'border-cyan-600/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  connected: 'connected',
  'key-set': 'key set',
  'no-key': 'no key',
  error: 'error',
  disabled: 'disabled',
  local: 'local',
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// ---------------- collapsible glass section ----------------

function Section(props: {
  id: string
  title: string
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  open: boolean
  onToggle: () => void
  badge?: string
  children: React.ReactNode
}) {
  const Icon = props.icon
  return (
    <section id={`settings-section-${props.id}`} className="glass overflow-hidden rounded-2xl border border-red-500/20">
      <button
        onClick={props.onToggle}
        aria-expanded={props.open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-red-500/5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-xs font-semibold tracking-[0.2em] text-foreground">{props.title}</span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">{props.subtitle}</span>
        </span>
        {props.badge && (
          <Badge variant="secondary" className="shrink-0 border border-red-500/30 bg-red-500/10 font-mono text-[10px] text-red-700 dark:text-red-300">
            {props.badge}
          </Badge>
        )}
        {props.open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {props.open && <div className="border-t border-border/60 p-4">{props.children}</div>}
    </section>
  )
}

// ---------------- provider edit dialog (shared with the PROVIDERS panel) ----------------

export function ProviderEditDialog(props: {
  provider: MatrixProvider
  onClose: () => void
  onSaved: () => void
}) {
  const p = props.provider
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [revealConfirm, setRevealConfirm] = useState(false)
  const [baseUrl, setBaseUrl] = useState(p.baseUrlOverride ?? p.baseUrl)
  const [model, setModel] = useState(p.model)
  const [orgId, setOrgId] = useState(p.orgId ?? '')
  const [headers, setHeaders] = useState(p.headersJson ?? '')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok?: boolean; latencyMs?: number; state?: string; error?: string } | null>(null)

  // masked preview: what the user sees while typing (last 4 chars)
  const maskedPreview = key.length > 4 ? `${'•'.repeat(Math.min(key.length - 4, 24))}${key.slice(-4)}` : key ? '•'.repeat(key.length) : ''
  const keyHintOk = key.trim().length >= 8 && !/\s/.test(key.trim())

  const save = async (rotate: boolean) => {
    if (rotate && !key.trim()) {
      toast({ title: 'Rotation needs a new key', description: 'paste the replacement key first', variant: 'destructive' })
      return
    }
    if (key.trim() && !keyHintOk) {
      toast({ title: 'That key does not look valid', description: '8 or more characters, no spaces', variant: 'destructive' })
      return
    }
    let parsedHeaders: Record<string, string> | undefined
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers) as Record<string, string>
      } catch {
        toast({ title: 'Headers must be valid JSON', description: 'for example {"accountId": "123"}', variant: 'destructive' })
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/royal-red/providers/${p.id}/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim() || undefined,
          rotate,
          baseUrl: baseUrl.trim() !== p.baseUrl ? baseUrl.trim() : undefined,
          model: model.trim() !== p.defaultModel ? model.trim() : undefined,
          orgId: orgId.trim() || undefined,
          headers: parsedHeaders,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: rotate ? 'Key rotated' : 'Key saved', description: `${p.label} key stored encrypted (AES-256-GCM).` })
      setKey('')
      props.onSaved()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const testNow = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/royal-red/providers/${p.id}/test`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; latencyMs?: number; state?: string; error?: string }
      setTestResult(json)
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const deleteKey = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/royal-red/providers/${p.id}/key`, { method: 'DELETE' })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: 'Key deleted', description: `${p.label} now shows "no key". The provider stays in the matrix.` })
      props.onSaved()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const toggleDisabled = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/royal-red/providers/${p.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !p.disabled }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: p.disabled ? 'Provider enabled' : 'Provider disabled', description: p.disabled ? `${p.label} is back in routing.` : `${p.label} is excluded from routing until re-enabled.` })
      props.onSaved()
    } catch (e) {
      toast({ title: 'Change failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const needsHeaders = p.id === 'cloudflare-workers-ai'

  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto font-mono">
      <DialogHeader>
        <DialogTitle className="text-sm tracking-[0.2em]">{p.label.toUpperCase()} / KEY SETUP</DialogTitle>
        <DialogDescription className="font-mono text-[10px]">
          id: {p.id} / protocol: {p.protocol} / keys are AES-256-GCM encrypted at rest and never returned by any API
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">API KEY {p.keyHint ? `(stored: ${p.keyHint})` : ''}</Label>
          <div className="flex gap-1.5">
            <Input
              type={showKey ? 'text' : 'password'}
              value={showKey ? key : key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={p.keyHint ? `paste a new key (current ${p.keyHint})` : 'paste your API key'}
              aria-label="API key"
              className="text-xs"
              autoComplete="off"
            />
            {key && <span className="min-w-16 whitespace-nowrap pt-2 text-[10px] text-muted-foreground">{showKey ? '' : maskedPreview}</span>}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label={showKey ? 'Hide key' : 'Reveal key'}
              onClick={() => {
                if (!showKey && !revealConfirm) {
                  // temporary reveal requires an explicit confirmation click
                  setRevealConfirm(true)
                  toast({ description: 'click reveal again to show the key once' })
                  return
                }
                setShowKey(!showKey)
                setRevealConfirm(false)
              }}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {key && !keyHintOk && <p className="text-[10px] text-amber-600">8+ characters, no spaces: this key does not look valid yet.</p>}
          {showKey && key && <p className="text-[10px] text-muted-foreground">revealed once: hide it again when done.</p>}
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">BASE URL {p.baseUrlOverride ? '(overridden)' : ''}</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.baseUrl} className="text-xs" aria-label="Base URL" />
          {p.endpointNote && <p className="text-[10px] leading-relaxed text-muted-foreground">{p.endpointNote}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">DEFAULT MODEL</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.defaultModel} className="text-xs" aria-label="Default model" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">ORGANIZATION ID (OPTIONAL)</Label>
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org-..." className="text-xs" aria-label="Organization id" />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">
            ADDITIONAL HEADERS (JSON){needsHeaders ? ' / REQUIRED: {"accountId": "..."}' : ''}
          </Label>
          <Textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            placeholder={needsHeaders ? '{"accountId": "your-cloudflare-account-id"}' : '{}'}
            rows={2}
            className="text-xs"
            aria-label="Additional headers JSON"
          />
          {needsHeaders && <p className="text-[10px] text-amber-600">Cloudflare Workers AI needs the account id here. The key field takes the API token.</p>}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
          <div>cost: {Object.keys(p.cost).length ? Object.entries(p.cost).map(([k, v]) => `$${v} per 1M ${k}`).join(', ') : 'unknown: not routed unless allowed'}</div>
          <div>{p.priceNote}</div>
          <div>region: {p.region} / free tier: {p.freeTier ? 'yes' : 'no'}</div>
          <div>probes: {p.successCount} ok / {p.failureCount} failed / avg {Math.round(p.avgLatencyMs)}ms / last error: {p.lastError ? relTime(p.lastProbeAt) : 'none'}</div>
        </div>

        {testResult && (
          <div className={cn('rounded-lg border p-2.5 text-[10px]', testResult.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300')}>
            {testResult.ok ? `probe passed: ${testResult.state} in ${testResult.latencyMs}ms` : `probe failed: ${testResult.error ?? 'unknown error'}`}
          </div>
        )}
      </div>

      <DialogFooter className="flex flex-wrap items-center gap-1.5 sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" disabled={testing} onClick={() => void testNow()}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />} TEST CONNECTION
          </Button>
          {p.keyConfigured && (
            <>
              <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" disabled={saving} onClick={() => void save(true)}>
                <RotateCcw className="h-3 w-3" /> ROTATE
              </Button>
              <Button variant="outline" size="sm" className="h-7 font-mono text-[10px] text-red-600 hover:text-red-700" disabled={saving} onClick={() => void deleteKey()}>
                <Trash2 className="h-3 w-3" /> DELETE KEY
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" disabled={saving} onClick={() => void toggleDisabled()}>
            {p.disabled ? 'ENABLE PROVIDER' : 'DISABLE PROVIDER'}
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={props.onClose}>CANCEL</Button>
          <Button size="sm" className="h-7 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" disabled={saving} onClick={() => void save(false)}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} SAVE
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}

// ---------------- add custom provider dialog ----------------

function AddProviderDialog(props: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [providerId, setProviderId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [authScheme, setAuthScheme] = useState('bearer')
  const [model, setModel] = useState('')
  const [modalities, setModalities] = useState<string[]>(['chat'])
  const [apiKey, setApiKey] = useState('')
  const [costIn, setCostIn] = useState('')
  const [costOut, setCostOut] = useState('')
  const [saving, setSaving] = useState(false)

  const ALL_M = ['chat', 'vision', 'image', 'audio', 'search', 'embedding', 'video', 'rerank']

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/royal-red/providers/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          providerId: providerId || undefined,
          baseUrl,
          authScheme,
          model,
          modalities,
          apiKey: apiKey.trim() || undefined,
          costIn: costIn ? Number(costIn) : undefined,
          costOut: costOut ? Number(costOut) : undefined,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string; providerId?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: 'Custom provider added', description: `${label} (${json.providerId}) is in the matrix now.` })
      props.onSaved()
    } catch (e) {
      toast({ title: 'Add failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto font-mono">
      <DialogHeader>
        <DialogTitle className="text-sm tracking-[0.2em]">ADD CUSTOM PROVIDER</DialogTitle>
        <DialogDescription className="font-mono text-[10px]">
          any OpenAI-compatible endpoint: it joins the matrix and routes like a shipped provider
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">DISPLAY NAME</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Gateway" className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">PROVIDER ID (AUTO IF EMPTY)</Label>
            <Input value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="my-gateway" className="text-xs" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">BASE URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">AUTH SCHEME</Label>
            <Select value={authScheme} onValueChange={setAuthScheme}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bearer">bearer token</SelectItem>
                <SelectItem value="header">custom header</SelectItem>
                <SelectItem value="query">query param</SelectItem>
                <SelectItem value="none">none</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">DEFAULT MODEL</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" className="text-xs" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">SUPPORTED MODALITIES</Label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_M.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModalities((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
                aria-pressed={modalities.includes(m)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] tracking-wider transition',
                  modalities.includes(m) ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">API KEY</Label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="optional" className="text-xs" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">IN $/1M</Label>
            <Input value={costIn} onChange={(e) => setCostIn(e.target.value)} placeholder="0.15" className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">OUT $/1M</Label>
            <Input value={costOut} onChange={(e) => setCostOut(e.target.value)} placeholder="0.60" className="text-xs" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={props.onClose}>CANCEL</Button>
        <Button size="sm" className="h-7 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" disabled={saving || !label || !baseUrl || !model} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} ADD PROVIDER
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ---------------- providers section ----------------

function ProvidersSection() {
  const [data, setData] = useState<{ providers: MatrixProvider[]; status: { connected: number; keyed: number; noKey: number; disabled: number; errors: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [editId, setEditId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [probeAllBusy, setProbeAllBusy] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [onlyKeyed, setOnlyKeyed] = useState(false)

  const load = useCallback(async (probe = false) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/royal-red/providers${probe ? '?probe=1' : ''}`)
      const json = (await res.json()) as { providers: MatrixProvider[]; status: { connected: number; keyed: number; noKey: number; disabled: number; errors: number } }
      setData(json)
    } catch {
      // honest empty state on failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  // live status refresh every 60 seconds
  useEffect(() => {
    const t = setInterval(() => { void load(false) }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const testOne = async (id: string) => {
    setTestingId(id)
    try {
      const res = await fetch(`/api/royal-red/providers/${id}/test`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string }
      if (json.ok) toast({ title: 'Probe passed', description: `${id} answered in ${json.latencyMs}ms.` })
      else toast({ title: 'Probe failed', description: json.error ?? 'the provider did not answer', variant: 'destructive' })
      await load(false)
    } finally {
      setTestingId(null)
    }
  }

  const testAll = async () => {
    setProbeAllBusy(true)
    toast({ description: 'probing every keyed provider: this can take up to a minute' })
    try {
      await load(true)
      toast({ title: 'Health sweep complete', description: 'all probes re-measured.' })
    } finally {
      setProbeAllBusy(false)
    }
  }

  const editProvider = data?.providers.find((p) => p.id === editId) ?? null

  const visible = useMemo(() => {
    let list = data?.providers ?? []
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((p) => p.label.toLowerCase().includes(q) || p.id.includes(q))
    if (statusFilter !== 'all') {
      list = list.filter((p) => {
        const s = providerStatus(p)
        if (statusFilter === 'connected') return s === 'connected'
        if (statusFilter === 'no-key') return s === 'no-key'
        if (statusFilter === 'error') return s === 'error'
        return true
      })
    }
    if (onlyKeyed) list = list.filter((p) => p.keyConfigured === true || p.requiresKey === false)
    const sorted = [...list]
    if (sortBy === 'name') sorted.sort((a, b) => a.label.localeCompare(b.label))
    if (sortBy === 'status') sorted.sort((a, b) => providerStatus(a).localeCompare(providerStatus(b)))
    if (sortBy === 'last-used') sorted.sort((a, b) => (b.lastSuccessAt ?? '').localeCompare(a.lastSuccessAt ?? ''))
    return sorted
  }, [data, search, statusFilter, sortBy, onlyKeyed])

  const summary = data
    ? `${data.providers.length} providers, ${data.status.connected} connected, ${data.status.noKey} awaiting keys.`
    : 'loading the matrix...'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter providers..." aria-label="Filter providers" className="h-8 bg-card pl-8 font-mono text-xs" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-32 font-mono text-[10px]" aria-label="Status filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all status</SelectItem>
            <SelectItem value="connected">connected</SelectItem>
            <SelectItem value="no-key">no key</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-8 w-32 font-mono text-[10px]" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">name</SelectItem>
            <SelectItem value="last-used">last used</SelectItem>
            <SelectItem value="status">status</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Switch checked={onlyKeyed} onCheckedChange={setOnlyKeyed} aria-label="Show only providers with keys" /> keys only
        </label>
        <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" disabled={probeAllBusy} onClick={() => void testAll()}>
          {probeAllBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} REFRESH ALL PROBES
        </Button>
        <Button size="sm" className="h-8 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" onClick={() => setAddOpen(true)}>
          <Plus className="h-3 w-3" /> ADD PROVIDER
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-muted/60 text-left text-[10px] tracking-widest text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-2 py-1.5">PROVIDER</th>
              <th className="px-2 py-1.5">STATUS</th>
              <th className="hidden px-2 py-1.5 sm:table-cell">MODALITIES</th>
              <th className="hidden px-2 py-1.5 md:table-cell">LAST SUCCESS</th>
              <th className="px-2 py-1.5 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr><td colSpan={5} className="px-2 py-6 text-center font-mono text-[10px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />loading the matrix...</td></tr>
            )}
            {visible.map((p) => {
              const st = providerStatus(p)
              return (
                <tr key={p.id} className="border-t transition-colors hover:bg-red-500/5">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{p.label}{p.freeTier ? <span className="ml-1 text-[9px] text-emerald-600">free</span> : null}</div>
                    <div className="text-[9px] text-muted-foreground">{p.id} / {p.protocol}{p.local ? ' / local' : ''}{p.region !== 'any' ? ` / ${p.region}` : ''}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[9px] tracking-wider', STATUS_STYLE[st])}>{STATUS_LABEL[st]}</span>
                    {p.lastError && st === 'error' && (
                      <div className="max-w-40 truncate text-[9px] text-red-600 dark:text-red-400" title={p.lastError}>{p.lastError}</div>
                    )}
                  </td>
                  <td className="hidden px-2 py-1.5 sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {p.modalities.slice(0, 4).map((m) => <span key={m} className="rounded bg-muted px-1 py-0.5 text-[9px]">{m}</span>)}
                      {p.modalities.length > 4 && <span className="text-[9px] text-muted-foreground">+{p.modalities.length - 4}</span>}
                    </div>
                  </td>
                  <td className="hidden px-2 py-1.5 text-[10px] text-muted-foreground md:table-cell">
                    {relTime(p.lastSuccessAt)}
                    {p.avgLatencyMs > 0 && <span className="ml-1">({Math.round(p.avgLatencyMs)}ms)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-6 px-2 font-mono text-[9px]" onClick={() => setEditId(p.id)}>EDIT</Button>
                      <Button variant="outline" size="sm" className="h-6 px-2 font-mono text-[9px]" disabled={testingId === p.id} onClick={() => void testOne(p.id)}>
                        {testingId === p.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'TEST'}
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {data && !visible.length && (
              <tr><td colSpan={5} className="px-2 py-6 text-center font-mono text-[10px] text-muted-foreground">no providers match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground">{summary}</p>

      {editProvider && (
        <Dialog open onOpenChange={(v) => { if (!v) setEditId(null) }}>
          <ProviderEditDialog provider={editProvider} onClose={() => setEditId(null)} onSaved={() => { void load(false) }} />
        </Dialog>
      )}
      {addOpen && (
        <Dialog open onOpenChange={(v) => { if (!v) setAddOpen(false) }}>
          <AddProviderDialog onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load(false) }} />
        </Dialog>
      )}
    </div>
  )
}

// ---------------- routing preferences section ----------------

function RoutingSection(props: { providers: MatrixProvider[]; prefs: RouterPrefsShape | null; onPrefs: (p: RouterPrefsShape) => void }) {
  const [priority, setPriority] = useState<string[]>(props.prefs?.priority ?? [])
  const [fallback, setFallback] = useState(props.prefs?.fallbackBehavior ?? 'next-on-failure')
  const [ceiling, setCeiling] = useState(String(props.prefs?.costCeilingUsd ?? 0.5))
  const [localFirst, setLocalFirst] = useState(props.prefs?.localFirst ?? false)
  const [freeTierFirst, setFreeTierFirst] = useState(props.prefs?.freeTierFirst ?? false)
  const [region, setRegion] = useState(props.prefs?.region ?? 'any')
  const [rateLimitBehavior, setRateLimitBehavior] = useState(props.prefs?.rateLimitBehavior ?? 'wait-retry')
  const [allowDenyOpen, setAllowDenyOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    if (props.prefs) {
      setPriority(props.prefs.priority)
      setFallback(props.prefs.fallbackBehavior)
      setCeiling(String(props.prefs.costCeilingUsd))
      setLocalFirst(props.prefs.localFirst)
      setFreeTierFirst(props.prefs.freeTierFirst)
      setRegion(props.prefs.region)
      setRateLimitBehavior(props.prefs.rateLimitBehavior)
    }
  }, [props.prefs])

  const push = async (next: Partial<{ priority: string[]; fallbackBehavior: string; costCeilingUsd: number; localFirst: boolean; freeTierFirst: boolean; region: string; rateLimitBehavior: string }>) => {
    try {
      const res = await fetch('/api/royal-red/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routerPrefs: next }),
      })
      const json = (await res.json()) as { routerPrefs?: RouterPrefsShape; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.routerPrefs) props.onPrefs(json.routerPrefs)
    } catch (e) {
      toast({ title: 'Preference not saved', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= priority.length) return
    const next = [...priority]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setPriority(next)
    void push({ priority: next })
  }

  const onDrop = (to: number) => {
    if (dragFrom.current === null) return
    move(dragFrom.current, to)
    dragFrom.current = null
  }

  const addPriority = (id: string) => {
    if (!id || priority.includes(id)) return
    const next = [...priority, id]
    setPriority(next)
    void push({ priority: next })
  }

  const removePriority = (id: string) => {
    const next = priority.filter((x) => x !== id)
    setPriority(next)
    void push({ priority: next })
  }

  const label = (id: string) => props.providers.find((p) => p.id === id)?.label ?? id

  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <Label className="text-[10px] tracking-widest text-muted-foreground">PRIORITY ORDER (DRAG OR ARROWS: THE ROUTER TRIES THESE FIRST)</Label>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
          {priority.length === 0 && <p className="p-2 font-mono text-[10px] text-muted-foreground">no pinned providers: the router orders by cost, health and preference.</p>}
          {priority.map((id, i) => (
            <div
              key={id}
              draggable
              onDragStart={() => { dragFrom.current = i }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              className="flex cursor-grab items-center gap-2 rounded border border-border/70 bg-card px-2 py-1 font-mono text-[10px] active:cursor-grabbing"
            >
              <span className="w-5 text-muted-foreground">#{i + 1}</span>
              <span className="flex-1 truncate">{label(id)}</span>
              <button aria-label={`Move ${label(id)} up`} onClick={() => move(i, i - 1)} className="p-0.5 text-muted-foreground hover:text-foreground"><ArrowUp className="h-3 w-3" /></button>
              <button aria-label={`Move ${label(id)} down`} onClick={() => move(i, i + 1)} className="p-0.5 text-muted-foreground hover:text-foreground"><ArrowDown className="h-3 w-3" /></button>
              <button aria-label={`Remove ${label(id)} from priority`} onClick={() => removePriority(id)} className="p-0.5 text-muted-foreground hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <Select value="" onValueChange={addPriority}>
          <SelectTrigger className="h-8 font-mono text-[10px]" aria-label="Add provider to priority"><SelectValue placeholder="+ pin a provider to the priority list" /></SelectTrigger>
          <SelectContent className="max-h-60">
            {props.providers.filter((p) => !priority.includes(p.id)).map((p) => (
              <SelectItem key={p.id} value={p.id} className="font-mono text-[10px]">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">FALLBACK BEHAVIOR</Label>
          <Select value={fallback} onValueChange={(v) => { setFallback(v); void push({ fallbackBehavior: v }) }}>
            <SelectTrigger className="h-8 font-mono text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="next-on-failure">try next provider on failure</SelectItem>
              <SelectItem value="fail-fast">fail immediately on failure</SelectItem>
              <SelectItem value="next-on-rate-limit">try next provider only on rate limit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">RATE LIMIT BEHAVIOR (429)</Label>
          <Select value={rateLimitBehavior} onValueChange={(v) => { setRateLimitBehavior(v); void push({ rateLimitBehavior: v }) }}>
            <SelectTrigger className="h-8 font-mono text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wait-retry">wait and retry</SelectItem>
              <SelectItem value="next-immediately">try next provider immediately</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">COST CEILING ($ PER REQUEST)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            onBlur={() => { const v = Number(ceiling); if (!Number.isNaN(v) && v >= 0) void push({ costCeilingUsd: v }) }}
            className="h-8 text-xs"
            aria-label="Cost ceiling in dollars"
          />
          <p className="text-[10px] text-muted-foreground">do not route to providers projected above this per request.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">REGION PREFERENCE</Label>
          <Select value={region} onValueChange={(v) => { setRegion(v); void push({ region: v }) }}>
            <SelectTrigger className="h-8 font-mono text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">any region</SelectItem>
              <SelectItem value="eu">EU hosted only</SelectItem>
              <SelectItem value="us">US hosted only</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">OVHcloud, Nscale and Nebius are EU hosted.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 font-mono text-[10px]">
          <Switch checked={localFirst} onCheckedChange={(v) => { setLocalFirst(v); void push({ localFirst: v }) }} aria-label="Local first" />
          LOCAL FIRST: prefer $0 local engines before paid providers
        </label>
        <label className="flex items-center gap-2 font-mono text-[10px]">
          <Switch checked={freeTierFirst} onCheckedChange={(v) => { setFreeTierFirst(v); void push({ freeTierFirst: v }) }} aria-label="Free tier first" />
          FREE TIER FIRST when the request fits free limits
        </label>
      </div>

      <div className="space-y-1.5">
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => setAllowDenyOpen(!allowDenyOpen)}>
          <Wrench className="h-3 w-3" /> ALLOWLIST / DENYLIST ({props.prefs?.allowlist.length ?? 0} allowed, {props.prefs?.denylist.length ?? 0} denied)
        </Button>
        {allowDenyOpen && <AllowDenyEditor providers={props.providers} prefs={props.prefs} onPrefs={props.onPrefs} />}
      </div>
    </div>
  )
}

function AllowDenyEditor(props: { providers: MatrixProvider[]; prefs: RouterPrefsShape | null; onPrefs: (p: RouterPrefsShape) => void }) {
  // fully controlled by the parent prefs: toggles PATCH the server and the
  // refreshed prefs flow back down, so there is no local mirror to desync
  const allow = props.prefs?.allowlist ?? []
  const deny = props.prefs?.denylist ?? []

  const toggle = (list: 'allow' | 'deny', id: string) => {
    const cur = list === 'allow' ? allow : deny
    const nextAllow = list === 'allow' ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : allow
    const nextDeny = list === 'deny' ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : deny
    void fetch('/api/royal-red/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routerPrefs: { allowlist: nextAllow, denylist: nextDeny } }),
    })
      .then((r) => r.json())
      .then((json: { routerPrefs?: RouterPrefsShape }) => { if (json.routerPrefs) props.onPrefs(json.routerPrefs) })
      .catch(() => {})
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border p-2">
      <table className="w-full text-[10px]">
        <thead className="text-left tracking-widest text-muted-foreground"><tr><th className="py-1">PROVIDER</th><th className="py-1">ALLOW</th><th className="py-1">DENY</th></tr></thead>
        <tbody>
          {props.providers.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="py-1 font-mono">{p.label}</td>
              <td className="py-1"><Switch checked={allow.includes(p.id)} onCheckedChange={() => toggle('allow', p.id)} aria-label={`Allow ${p.label}`} /></td>
              <td className="py-1"><Switch checked={deny.includes(p.id)} onCheckedChange={() => toggle('deny', p.id)} aria-label={`Deny ${p.label}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-1 text-[10px] text-muted-foreground">allowlist also acts as the opt-in for providers with unknown cost.</p>
    </div>
  )
}

// ---------------- connectors section ----------------

const CONNECTOR_CONFIG_FIELDS: Record<string, Array<{ key: string; label: string; placeholder: string }>> = {
  shopify: [{ key: 'storeUrl', label: 'STORE URL', placeholder: 'https://your-store.myshopify.com' }],
  wordpress: [{ key: 'siteUrl', label: 'SITE URL', placeholder: 'https://your-site.com' }],
  contentful: [{ key: 'spaceId', label: 'SPACE ID', placeholder: 'your contentful space id' }],
  'google-analytics': [{ key: 'propertyId', label: 'PROPERTY ID', placeholder: 'properties/123456' }],
  posthog: [{ key: 'projectId', label: 'PROJECT ID', placeholder: '12345' }],
  sentry: [{ key: 'org', label: 'ORGANIZATION SLUG', placeholder: 'your-org' }],
  algolia: [{ key: 'appId', label: 'APP ID', placeholder: 'ALGOLIA_APP_ID' }],
}

function ConnectorsSection() {
  const [data, setData] = useState<{ connectors: ConnectorView[]; counts: { total: number; built: number; connected: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [connectId, setConnectId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [toolsFor, setToolsFor] = useState<string | null>(null)
  const [tools, setTools] = useState<Array<{ name: string; description: string; permission: string }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/royal-red/connectors')
      setData(await res.json())
    } catch { /* honest empty state */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const openTools = async (id: string) => {
    if (toolsFor === id) { setToolsFor(null); return }
    setToolsFor(id)
    setTools([])
    try {
      const res = await fetch(`/api/royal-red/connectors/${id}/tools`)
      const json = (await res.json()) as { tools?: Array<{ name: string; description: string; permission: string }>; note?: string }
      setTools(json.tools ?? [])
    } catch { setTools([]) }
  }

  const test = async (id: string) => {
    setTestingId(id)
    try {
      const res = await fetch(`/api/royal-red/connectors/${id}/test`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string }
      if (json.ok) toast({ title: 'Connector healthy', description: `answered in ${json.latencyMs}ms.` })
      else toast({ title: 'Test failed', description: json.error ?? 'the health check did not pass', variant: 'destructive' })
      await load()
    } finally { setTestingId(null) }
  }

  const visible = (data?.connectors ?? []).filter((c) => !search.trim() || c.label.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter connectors..." aria-label="Filter connectors" className="h-8 bg-card pl-8 font-mono text-xs" />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {data ? `${data.counts.total} connectors, ${data.counts.built} built, ${data.counts.connected} connected.` : 'loading...'}
        </span>
      </div>

      {loading && !data && <p className="py-4 text-center font-mono text-[10px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />loading connectors...</p>}

      <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {visible.map((c) => (
          <div key={c.id} className="rounded-lg border border-border/70 bg-card/60 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', c.status === 'connected' ? 'bg-emerald-500' : c.status === 'error' ? 'bg-red-500' : c.status === 'pending' ? 'bg-amber-500' : 'bg-muted-foreground/30')} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs font-semibold">{c.label}</span>
                  {!c.built && <Badge variant="secondary" className="font-mono text-[8px]">definition only</Badge>}
                </div>
                <div className="truncate text-[9px] text-muted-foreground">
                  {c.category} / {c.authType} / {c.status}
                  {c.credHint ? ` / ${c.credHint}` : ''}
                  {c.lastError ? ` / ${c.lastError.slice(0, 60)}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                {c.built && c.toolCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 font-mono text-[9px]" onClick={() => void openTools(c.id)}>
                    {toolsFor === c.id ? 'HIDE TOOLS' : `${c.toolCount} TOOLS`}
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-6 px-2 font-mono text-[9px]" disabled={!c.built} onClick={() => setConnectId(c.id)}>
                  {c.credHint ? 'EDIT' : 'CONNECT'}
                </Button>
                {c.credHint && (
                  <Button variant="outline" size="sm" className="h-6 px-2 font-mono text-[9px]" disabled={testingId === c.id || !c.built} onClick={() => void test(c.id)}>
                    {testingId === c.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'TEST'}
                  </Button>
                )}
                {c.credHint && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 font-mono text-[9px] text-red-600 hover:text-red-700"
                    onClick={async () => {
                      await fetch(`/api/royal-red/connectors/${c.id}`, { method: 'DELETE' })
                      toast({ title: 'Disconnected', description: `${c.label} credential removed.` })
                      await load()
                    }}
                  >
                    DISCONNECT
                  </Button>
                )}
              </div>
            </div>
            {toolsFor === c.id && (
              <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                {tools.length === 0 && <p className="font-mono text-[9px] text-muted-foreground">no tools: this connector ships as a definition only.</p>}
                {tools.map((t) => (
                  <div key={t.name} className="flex items-center gap-2 font-mono text-[9px]">
                    <span className={cn('rounded px-1 py-0.5 text-[8px]', t.permission === 'read-only' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : t.permission === 'write' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-red-500/15 text-red-700 dark:text-red-300')}>{t.permission}</span>
                    <span className="font-semibold">{t.name}</span>
                    <span className="truncate text-muted-foreground">{t.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {connectId && <ConnectDialog id={connectId} connectors={data?.connectors ?? []} onClose={() => setConnectId(null)} onSaved={() => { setConnectId(null); void load() }} />}
    </div>
  )
}

function ConnectDialog(props: { id: string; connectors: ConnectorView[]; onClose: () => void; onSaved: () => void }) {
  const c = props.connectors.find((x) => x.id === props.id)
  const [cred, setCred] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  if (!c) return null
  const fields = CONNECTOR_CONFIG_FIELDS[c.id] ?? []

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/royal-red/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: c.id, cred: cred.trim() || undefined, config: Object.keys(config).length ? config : undefined }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: 'Credential stored', description: `${c.label} encrypted. Run TEST to confirm it works.` })
      props.onSaved()
    } catch (e) {
      toast({ title: 'Connect failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <DialogContent className="max-w-md font-mono">
      <DialogHeader>
        <DialogTitle className="text-sm tracking-[0.2em]">{c.label.toUpperCase()} / CONNECT</DialogTitle>
        <DialogDescription className="font-mono text-[10px]">
          {c.keyFormat ?? 'paste the credential'} / stored AES-256-GCM, tested before use
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">CREDENTIAL {c.credHint ? `(current: ${c.credHint})` : ''}</Label>
          <Input type="password" value={cred} onChange={(e) => setCred(e.target.value)} placeholder="paste the credential" className="text-xs" autoComplete="off" />
        </div>
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">{f.label}</Label>
            <Input value={config[f.key] ?? c.config?.[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} placeholder={f.placeholder} className="text-xs" />
          </div>
        ))}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          api: {c.baseUrl} / docs: {c.docsUrl}
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={props.onClose}>CANCEL</Button>
        <Button size="sm" className="h-7 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} SAVE CREDENTIAL
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ---------------- MCP section ----------------

function McpSection() {
  const [data, setData] = useState<{ servers: McpServerView[]; catalog: McpCatalogEntry[]; counts: { installed: number; connected: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [callTool, setCallTool] = useState<{ server: McpServerView; tool: McpTool } | null>(null)
  const [callArgs, setCallArgs] = useState('{}')
  const [callResult, setCallResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/royal-red/mcp')
      setData(await res.json())
    } catch { /* honest empty */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const test = async (id: string) => {
    setTestingId(id)
    setCallResult(null)
    try {
      const res = await fetch(`/api/royal-red/mcp/${id}/test`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; tools?: McpTool[]; resources?: unknown[]; prompts?: unknown[]; latencyMs?: number; error?: string }
      if (json.ok) toast({ title: 'MCP server connected', description: `${json.tools?.length ?? 0} tools, ${json.resources?.length ?? 0} resources, ${json.prompts?.length ?? 0} prompts (${json.latencyMs}ms).` })
      else toast({ title: 'MCP connect failed', description: json.error ?? 'the server did not complete the handshake', variant: 'destructive' })
      await load()
    } finally { setTestingId(null) }
  }

  const doCall = async () => {
    if (!callTool) return
    try {
      const args = JSON.parse(callArgs) as Record<string, unknown>
      const res = await fetch(`/api/royal-red/mcp/${callTool.server.id}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: callTool.tool.name, args }),
      })
      const json = (await res.json()) as { ok?: boolean; data?: unknown; error?: string; summary?: string }
      setCallResult(json.ok ? `${json.summary ?? 'ok'} ${JSON.stringify(json.data)?.slice(0, 400)}` : `error: ${json.error}`)
    } catch (e) {
      setCallResult(`error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-mono text-[10px] text-muted-foreground">
          {data ? `${data.counts.installed} servers, ${data.counts.connected} connected.` : 'loading...'}
        </span>
        <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" onClick={() => setAddOpen(true)}><Plus className="h-3 w-3" /> ADD MCP SERVER</Button>
      </div>

      <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
        {loading && !data && <p className="py-2 text-center font-mono text-[10px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />loading servers...</p>}
        {data?.servers.map((s) => (
          <div key={s.id} className="rounded-lg border border-border/70 bg-card/60 p-2.5 font-mono text-[10px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', s.status === 'connected' ? 'bg-emerald-500' : s.status === 'error' ? 'bg-red-500' : 'bg-muted-foreground/30')} />
              <span className="text-xs font-semibold">{s.label}</span>
              <Badge variant="secondary" className="text-[8px]">{s.type}</Badge>
              {!s.enabled && <Badge variant="secondary" className="text-[8px]">disabled</Badge>}
              <span className="flex-1 truncate text-muted-foreground">
                {s.type === 'stdio' ? `${s.command} ${(s.args ?? []).join(' ')}` : s.url} / {s.tools.length} tools, {s.resources.length} resources, {s.prompts.length} prompts / last: {relTime(s.lastConnectedAt)}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-6 px-2 text-[9px]" disabled={testingId === s.id || !s.enabled} onClick={() => void test(s.id)}>
                  {testingId === s.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'TEST'}
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[9px]" onClick={() => setDetailId(detailId === s.id ? null : s.id)}>{detailId === s.id ? 'HIDE' : 'TOOLS'}</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px]" onClick={async () => {
                  await fetch(`/api/royal-red/mcp/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
                  await load()
                }}>{s.enabled ? 'DISABLE' : 'ENABLE'}</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px] text-red-600" onClick={async () => {
                  await fetch(`/api/royal-red/mcp/${s.id}`, { method: 'DELETE' })
                  toast({ title: 'MCP server removed', description: s.label })
                  await load()
                }}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
            {s.lastError && <p className="mt-1 truncate text-red-600 dark:text-red-400" title={s.lastError}>{s.lastError}</p>}
            {detailId === s.id && (
              <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                {s.tools.map((t) => (
                  <div key={t.name} className="flex items-center gap-2">
                    <span className="font-semibold">{t.name}</span>
                    <span className="flex-1 truncate text-muted-foreground">{t.description}</span>
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => { setCallTool({ server: s, tool: t }); setCallArgs('{}'); setCallResult(null) }}>CALL</Button>
                  </div>
                ))}
                {s.tools.length === 0 && <p className="text-muted-foreground">no tools discovered yet: run TEST.</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">CATALOG: ONE CLICK TO FILL THE FORM</p>
        <div className="flex flex-wrap gap-1.5">
          {data?.catalog.map((c) => (
            <button
              key={c.id}
              onClick={async () => {
                try {
                  const res = await fetch('/api/royal-red/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: c.id, label: c.label, type: c.type, command: c.command, args: c.args, url: c.url }),
                  })
                  const json = (await res.json()) as { ok?: boolean; error?: string }
                  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
                  toast({ title: 'MCP server added', description: `${c.label}: run TEST to connect and discover its tools.` })
                  await load()
                } catch (e) {
                  toast({ title: 'Add failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
                }
              }}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] transition hover:border-red-500/50 hover:bg-red-500/10"
              title={c.description}
            >
              + {c.label}
            </button>
          ))}
        </div>
      </div>

      {addOpen && <AddMcpDialog catalog={data?.catalog ?? []} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load() }} />}

      <Dialog open={!!callTool} onOpenChange={(v) => { if (!v) { setCallTool(null); setCallResult(null) } }}>
        {callTool && (
          <DialogContent className="max-w-md font-mono">
            <DialogHeader>
              <DialogTitle className="text-sm tracking-[0.2em]">{callTool.tool.name.toUpperCase()}</DialogTitle>
              <DialogDescription className="font-mono text-[10px]">{callTool.tool.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-xs">
              <Label className="text-[10px] tracking-widest text-muted-foreground">ARGUMENTS (JSON)</Label>
              <Textarea value={callArgs} onChange={(e) => setCallArgs(e.target.value)} rows={5} className="text-xs" aria-label="Tool arguments JSON" />
              {callResult && <div className={cn('rounded border p-2 text-[10px]', callResult.startsWith('error') ? 'border-red-500/40 bg-red-500/10' : 'border-emerald-500/40 bg-emerald-500/10')}>{callResult}</div>}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={() => { setCallTool(null); setCallResult(null) }}>CLOSE</Button>
              <Button size="sm" className="h-7 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" onClick={() => void doCall()}>CALL TOOL</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

function AddMcpDialog(props: { catalog: McpCatalogEntry[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/royal-red/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          command: type === 'stdio' ? command : undefined,
          args: args.trim() ? args.trim().split(/\s+/) : undefined,
          url: type !== 'stdio' ? url : undefined,
          token: token.trim() || undefined,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: 'MCP server added', description: 'run TEST to connect and discover tools.' })
      props.onSaved()
    } catch (e) {
      toast({ title: 'Add failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <DialogContent className="max-w-md font-mono">
      <DialogHeader>
        <DialogTitle className="text-sm tracking-[0.2em]">ADD MCP SERVER</DialogTitle>
        <DialogDescription className="font-mono text-[10px]">local process (stdio) or remote http/ws endpoint, JSON-RPC 2.0</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">NAME (SLUG)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" className="text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] tracking-widest text-muted-foreground">TYPE</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">local process (stdio)</SelectItem>
                <SelectItem value="http">http endpoint</SelectItem>
                <SelectItem value="ws">websocket</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {type === 'stdio' ? (
          <>
            <div className="space-y-1">
              <Label className="text-[10px] tracking-widest text-muted-foreground">COMMAND</Label>
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] tracking-widest text-muted-foreground">ARGS (SPACE SEPARATED)</Label>
              <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem ." className="text-xs" />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-[10px] tracking-widest text-muted-foreground">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] tracking-widest text-muted-foreground">AUTH TOKEN (OPTIONAL)</Label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="bearer token" className="text-xs" autoComplete="off" />
            </div>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={props.onClose}>CANCEL</Button>
        <Button size="sm" className="h-7 bg-red-600 font-mono text-[10px] text-white hover:bg-red-700" disabled={saving || !name || (type === 'stdio' ? !command : !url)} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Server className="h-3 w-3" />} ADD SERVER
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ---------------- skills section ----------------

function SkillsSection() {
  const [data, setData] = useState<{ skills: SkillView[]; catalog: SkillView[]; counts: { installed: number; catalog: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewId, setViewId] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [url, setUrl] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/royal-red/skills')
      setData(await res.json())
    } catch { /* honest empty */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const install = async (payload: Record<string, string>, okMsg: string) => {
    try {
      const res = await fetch('/api/royal-red/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast({ title: okMsg })
      await load()
    } catch (e) {
      toast({ title: 'Install failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  const viewSkill = async (skillId: string): Promise<SkillView | null> => {
    try {
      const res = await fetch(`/api/royal-red/skills/${skillId}`)
      if (!res.ok) return null
      return (await res.json()) as SkillView
    } catch { return null }
  }

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-muted-foreground">
        {data ? `${data.counts.installed} installed, ${data.counts.catalog} in the catalog.` : 'loading...'}
      </div>

      <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
        {loading && !data && <p className="py-2 text-center font-mono text-[10px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />loading skills...</p>}
        {data?.skills.map((s) => (
          <div key={s.skillId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-2.5 font-mono text-[10px]">
            <span className={cn('h-2 w-2 rounded-full', s.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
            <span className="text-xs font-semibold">{s.name}</span>
            <Badge variant="secondary" className="text-[8px]">{s.source}</Badge>
            <span className="flex-1 truncate text-muted-foreground">{s.tools.length} tools / {s.prompts.length} prompts / v{s.version}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px]" onClick={() => setViewId(s.skillId)}>VIEW</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px]" onClick={async () => {
              await fetch(`/api/royal-red/skills/${s.skillId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
              await load()
            }}>{s.enabled ? 'DISABLE' : 'ENABLE'}</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px] text-red-600" onClick={async () => {
              await fetch(`/api/royal-red/skills/${s.skillId}`, { method: 'DELETE' })
              toast({ title: 'Skill removed', description: s.name })
              await load()
            }}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        {data && !data.skills.length && <p className="py-2 text-center font-mono text-[10px] text-muted-foreground">no skills installed yet: pick one below.</p>}
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">CATALOG: ONE CLICK INSTALL</p>
        <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
          {data?.catalog.map((c) => (
            <div key={c.skillId} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold">
                  {c.name}{c.installed && <Check className="h-3 w-3 text-emerald-500" />}
                </div>
                <div className="truncate text-[9px] text-muted-foreground">{c.description}</div>
              </div>
              <Button
                variant={c.installed ? 'outline' : 'default'}
                size="sm"
                className={cn('h-6 shrink-0 px-2 font-mono text-[9px]', !c.installed && 'bg-red-600 text-white hover:bg-red-700')}
                onClick={() => void install({ from: 'catalog', skillId: c.skillId }, `${c.name} installed: its instructions load on demand.`)}
              >
                {c.installed ? 'RE-ENABLE' : 'INSTALL'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">INSTALL FROM FOLDER (SKILL.MD)</Label>
          <div className="flex gap-1.5">
            <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/home/you/my-skill" className="h-8 text-xs" />
            <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" disabled={!folderPath.trim()} onClick={() => void install({ from: 'folder', path: folderPath.trim() }, 'Skill installed from folder.')}>INSTALL</Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-muted-foreground">INSTALL FROM URL (RAW SKILL.MD OR GITHUB REPO)</Label>
          <div className="flex gap-1.5">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/my-skill" className="h-8 text-xs" />
            <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" disabled={!url.trim()} onClick={() => void install({ from: 'url', url: url.trim() }, 'Skill installed from URL.')}>INSTALL</Button>
          </div>
        </div>
      </div>

      <Dialog open={!!viewId} onOpenChange={(v) => { if (!v) setViewId(null) }}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto font-mono">
          <DialogHeader>
            <DialogTitle className="text-sm tracking-[0.2em]">SKILL CONTENTS</DialogTitle>
          </DialogHeader>
          <SkillViewBody skillId={viewId} loader={viewSkill} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SkillViewBody(props: { skillId: string | null; loader: (id: string) => Promise<SkillView | null> }) {
  const [skill, setSkill] = useState<SkillView | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!props.skillId) {
      setSkill(null)
      return
    }
    void props.loader(props.skillId).then((s) => {
      if (!cancelled) setSkill(s)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: reload only when the viewed id changes
  }, [props.skillId])
  if (!skill) return <p className="py-4 text-center font-mono text-[10px] text-muted-foreground">loading skill contents...</p>
  return (
    <div className="space-y-2 text-xs">
      <div className="font-mono text-[10px] text-muted-foreground">{skill.name} / v{skill.version} / by {skill.author} / {skill.source}</div>
      <p className="text-[11px] leading-relaxed">{skill.description}</p>
      <div>
        <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">TOOLS</p>
        {skill.tools.map((t) => (
          <div key={t.name} className="font-mono text-[10px]">{t.name} <span className="text-muted-foreground">({t.permission}) {t.description}</span></div>
        ))}
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">PROMPTS</p>
        <div className="font-mono text-[10px] text-muted-foreground">{skill.prompts.join(', ')}</div>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">INSTRUCTIONS</p>
        <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 text-[10px] leading-relaxed">{skill.instructions}</pre>
      </div>
    </div>
  )
}

// ---------------- general section ----------------

// one labeled select row for the general grid (declared outside the parent so
// it is never recreated during render)
function GeneralSelect(props: {
  label: string
  value: string
  options: Array<{ v: string; l: string }>
  onValue: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] tracking-widest text-muted-foreground">{props.label}</Label>
      <Select value={props.value} onValueChange={props.onValue}>
        <SelectTrigger className="h-8 font-mono text-[10px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {props.options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function GeneralSection(props: { settings: Record<string, string> | null; onChange: (k: string, v: string) => void }) {
  const s = props.settings
  const { setTheme } = useTheme()
  if (!s) return <p className="font-mono text-[10px] text-muted-foreground">loading settings...</p>
  const set = (k: string, themeRelated = false) => (v: string) => {
    props.onChange(k, v)
    if (themeRelated) setTheme(v)
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <GeneralSelect label="THEME" value={s.theme ?? 'system'} onValue={set('theme', true)} options={[{ v: 'dark', l: 'dark' }, { v: 'light', l: 'light' }, { v: 'system', l: 'system' }]} />
      <GeneralSelect label="LANGUAGE" value={s.language ?? 'en'} onValue={set('language')} options={[{ v: 'en', l: 'English (more coming)' }]} />
      <GeneralSelect label="DEFAULT MODE" value={s.defaultMode ?? 'build'} onValue={set('defaultMode')} options={[{ v: 'build', l: 'BUILDER' }, { v: 'research', l: 'RESEARCH' }, { v: 'pc', l: 'SYSTEM' }, { v: 'ask', l: 'ASSIST' }]} />
      <GeneralSelect label="BOOT ANIMATION" value={s.bootAnimation ?? 'on'} onValue={set('bootAnimation')} options={[{ v: 'on', l: 'on' }, { v: 'off', l: 'off' }]} />
      <GeneralSelect label="SOUND" value={s.sound ?? 'off'} onValue={set('sound')} options={[{ v: 'off', l: 'off (notifications come later)' }, { v: 'on', l: 'on' }]} />
      <GeneralSelect label="TELEMETRY" value={s.telemetry ?? 'off'} onValue={set('telemetry')} options={[{ v: 'off', l: 'off (never phones home)' }, { v: 'on', l: 'on (opt-in)' }]} />
      <GeneralSelect label="AUTO UPDATE" value={s.autoUpdate ?? 'notify'} onValue={set('autoUpdate')} options={[{ v: 'notify', l: 'notify only' }, { v: 'on', l: 'on' }, { v: 'off', l: 'off' }]} />
      <GeneralSelect label="DENSITY" value={s.density ?? 'comfortable'} onValue={set('density')} options={[{ v: 'comfortable', l: 'comfortable' }, { v: 'compact', l: 'compact' }]} />
      <GeneralSelect label="MOTION" value={s.motion ?? 'full'} onValue={set('motion')} options={[{ v: 'full', l: 'full' }, { v: 'reduced', l: 'reduced' }]} />
    </div>
  )
}

// ---------------- data and privacy section ----------------

function DataSection() {
  const [stats, setStats] = useState<{ dataDir: string; dbBytes: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [clearText, setClearText] = useState('')
  const [clearOpen, setClearOpen] = useState(false)

  useEffect(() => {
    void fetch('/api/royal-red/settings/backup').then((r) => r.json()).then((j: { dataDir: string; dbBytes: number }) => setStats(j)).catch(() => {})
  }, [])

  const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

  const doBackup = async () => {
    setBusy('backup')
    try {
      const res = await fetch('/api/royal-red/settings/backup', { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; path?: string; error?: string }
      if (json.ok && json.path) toast({ title: 'Backup created', description: json.path })
      else throw new Error(json.error ?? 'backup failed')
    } catch (e) {
      toast({ title: 'Backup failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const doClear = async () => {
    setBusy('clear')
    try {
      const res = await fetch('/api/royal-red/settings/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-all', confirmText: clearText }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'wipe refused')
      toast({ title: 'All data cleared', description: 'the console starts from a clean slate.' })
      setClearOpen(false)
      setClearText('')
    } catch (e) {
      toast({ title: 'Wipe failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-[10px] sm:grid-cols-2">
        <div><span className="text-muted-foreground">DATA DIRECTORY</span><div className="truncate">{stats?.dataDir ?? 'resolving...'}</div></div>
        <div><span className="text-muted-foreground">DATABASE SIZE</span><div>{stats ? kb(stats.dbBytes) : 'measuring...'}</div></div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('/api/royal-red/settings/export?encrypted=1', '_blank')}>
          <Download className="h-3 w-3" /> EXPORT (ENCRYPTED SECRETS)
        </Button>
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('/api/royal-red/settings/export', '_blank')}>
          <Download className="h-3 w-3" /> EXPORT (NO SECRETS)
        </Button>
        <label className="cursor-pointer">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setBusy('import')
              try {
                const text = await file.text()
                const res = await fetch('/api/royal-red/settings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
                const json = (await res.json()) as { ok?: boolean; counts?: Record<string, number>; error?: string }
                if (!res.ok || !json.ok) throw new Error(json.error ?? 'import failed')
                toast({ title: 'Import complete', description: JSON.stringify(json.counts) })
              } catch (err) {
                toast({ title: 'Import failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
              } finally { setBusy(null) }
            }}
          />
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-3 font-mono text-[10px] transition hover:bg-accent">
            {busy === 'import' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />} IMPORT JSON
          </span>
        </label>
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" disabled={busy === 'backup'} onClick={() => void doBackup()}>
          {busy === 'backup' ? <Loader2 className="h-3 w-3 animate-spin" /> : <HardDrive className="h-3 w-3" />} BACKUP NOW
        </Button>
        <Button variant="outline" size="sm" className="h-7 border-red-500/50 font-mono text-[10px] text-red-600 hover:bg-red-500/10" onClick={() => setClearOpen(true)}>
          <AlertTriangle className="h-3 w-3" /> CLEAR ALL DATA
        </Button>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        export carries sessions, memory, audit log and settings. encrypted export keeps secret columns as ciphertext (only this machine can decrypt).
        backup writes a timestamped tarball next to the data directory. clear all data is destructive and audited.
      </p>

      <Dialog open={clearOpen} onOpenChange={(v) => { if (!v) { setClearOpen(false); setClearText('') } }}>
        <DialogContent className="max-w-sm font-mono">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm tracking-[0.2em] text-red-600"><AlertTriangle className="h-4 w-4" /> CLEAR ALL DATA</DialogTitle>
            <DialogDescription className="text-[11px] leading-relaxed">
              this wipes every session, artifact, memory, audit row, provider key, connector, MCP server and skill on this machine. there is no undo.
              type ERASE to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={clearText} onChange={(e) => setClearText(e.target.value)} placeholder="ERASE" aria-label="Type ERASE to confirm" className="font-mono text-xs" />
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px]" onClick={() => { setClearOpen(false); setClearText('') }}>CANCEL</Button>
            <Button variant="destructive" size="sm" className="h-7 font-mono text-[10px]" disabled={clearText !== 'ERASE' || busy === 'clear'} onClick={() => void doClear()}>
              {busy === 'clear' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} WIPE EVERYTHING
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------- security section ----------------

function SecuritySection(props: { settings: Record<string, string> | null; onChange: (k: string, v: string) => void }) {
  const [password, setPassword] = useState('')
  const [masterSecret, setMasterSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const retention = props.settings?.auditRetentionDays ?? '365'
  const autoLock = props.settings?.autoLockMin ?? '30'
  const hasPassword = !!props.settings?.sessionPasswordHash

  const post = async (payload: Record<string, unknown>, okTitle: string) => {
    setBusy(String(payload.action))
    try {
      const res = await fetch('/api/royal-red/settings/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = (await res.json()) as { ok?: boolean; error?: string; reEncrypted?: number }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'request failed')
      toast({ title: okTitle, description: json.reEncrypted !== undefined ? `${json.reEncrypted} secrets re-encrypted under the new master.` : undefined })
      setPassword('')
      setMasterSecret('')
    } catch (e) {
      toast({ title: 'Security action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">SESSION PASSWORD {hasPassword ? '(SET)' : '(NONE)'}</Label>
          <div className="flex gap-1.5">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters" className="h-8 text-xs" autoComplete="new-password" />
            <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" disabled={busy !== null || password.length < 8} onClick={() => void post({ action: 'set-password', password }, 'Session password set: the console locks on next launch.')}>SET</Button>
            {hasPassword && (
              <Button size="sm" variant="ghost" className="h-8 font-mono text-[10px]" disabled={busy !== null} onClick={() => void post({ action: 'clear-password' }, 'Session password removed.')}>CLEAR</Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">stored as a scrypt hash. the console requires it on launch and after auto-lock.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">AUTO-LOCK (MINUTES OF INACTIVITY)</Label>
          <Input
            type="number"
            min="1"
            defaultValue={autoLock}
            onBlur={(e) => { const v = Number(e.target.value); if (v >= 1) props.onChange('autoLockMin', String(v)) }}
            className="h-8 text-xs"
            aria-label="Auto lock minutes"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">CHANGE ENCRYPTION KEY (ROTATE MASTER)</Label>
          <div className="flex gap-1.5">
            <Input type="password" value={masterSecret} onChange={(e) => setMasterSecret(e.target.value)} placeholder="new master secret (16+ chars)" className="h-8 text-xs" autoComplete="new-password" />
            <Button size="sm" variant="outline" className="h-8 font-mono text-[10px]" disabled={busy !== null || masterSecret.length < 16} onClick={() => void post({ action: 'rotate-master', newSecret: masterSecret }, 'Master secret rotated.')}>ROTATE</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">re-encrypts every stored provider key, connector credential and MCP token.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] tracking-widest text-muted-foreground">AUDIT LOG RETENTION (DAYS)</Label>
          <Input
            type="number"
            min="30"
            defaultValue={retention}
            onBlur={(e) => { const v = Number(e.target.value); if (v >= 30) props.onChange('auditRetentionDays', String(v)) }}
            className="h-8 text-xs"
            aria-label="Audit retention days"
          />
          <div className="flex gap-1.5 pt-1">
            <Button size="sm" variant="outline" className="h-7 font-mono text-[10px]" onClick={() => window.open('/api/royal-red/settings/export?part=audit&format=csv', '_blank')}>EXPORT AUDIT CSV</Button>
            <Button size="sm" variant="outline" className="h-7 font-mono text-[10px]" onClick={() => window.open('/api/royal-red/settings/export?part=audit&format=json', '_blank')}>JSON</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- about section ----------------

function AboutSection() {
  const [about, setAbout] = useState<{ version: string; bootVersion: string; kernelVersion: string; commit: string; counts: Record<string, number> } | null>(null)
  useEffect(() => {
    void fetch('/api/royal-red/settings').then((r) => r.json()).then((j: { about?: typeof about }) => setAbout(j.about ?? null)).catch(() => {})
  }, [])
  return (
    <div className="space-y-2 font-mono text-[11px]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: 'VERSION', v: about?.version ?? '...' },
          { k: 'BOOT', v: about?.bootVersion ?? '...' },
          { k: 'KERNEL', v: about?.kernelVersion ?? '...' },
          { k: 'COMMIT', v: about?.commit?.slice(0, 12) ?? '...' },
          { k: 'SESSIONS', v: String(about?.counts.sessions ?? '...') },
          { k: 'MEMORIES', v: String(about?.counts.memories ?? '...') },
          { k: 'ARTIFACTS', v: String(about?.counts.artifacts ?? '...') },
          { k: 'MESSAGES', v: String(about?.counts.messages ?? '...') },
        ].map((x) => (
          <div key={x.k} className="rounded border border-red-500/20 bg-red-500/5 p-2">
            <div className="text-[9px] tracking-widest text-muted-foreground">{x.k}</div>
            <div className="truncate text-sm font-semibold text-red-700 dark:text-red-300">{x.v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('https://github.com/', '_blank')}><Globe className="h-3 w-3" /> REPOSITORY</Button>
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('/docs/INVARIANTS.md', '_blank')}>INVARIANTS</Button>
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('/docs/SKILLS-CATALOG.md', '_blank')}>SKILLS CATALOG</Button>
        <Button variant="outline" size="sm" className="h-7 font-mono text-[10px]" onClick={() => window.open('/docs/INSTALL.md', '_blank')}>DOCS</Button>
      </div>
    </div>
  )
}

// ---------------- the tab ----------------

const SECTIONS = [
  { id: 'providers', title: 'PROVIDERS', subtitle: '96 providers: keys, health probes, custom endpoints', icon: KeyRound },
  { id: 'routing', title: 'ROUTING PREFERENCES', subtitle: 'priority, fallback, cost ceiling, region, free tier', icon: Sparkles },
  { id: 'connectors', title: 'CONNECTORS', subtitle: '60 third-party services: GitHub, Slack, Stripe and more', icon: Plug },
  { id: 'mcp', title: 'MCP SERVERS', subtitle: 'Model Context Protocol: local processes and remote endpoints', icon: Server },
  { id: 'skills', title: 'SKILLS', subtitle: 'Claude-style capability packages: install, enable, inspect', icon: Wrench },
  { id: 'general', title: 'GENERAL', subtitle: 'theme, language, default mode, boot, telemetry', icon: Globe },
  { id: 'data', title: 'DATA AND PRIVACY', subtitle: 'data directory, export, import, backup, clear all', icon: Database },
  { id: 'security', title: 'SECURITY', subtitle: 'session password, master key rotation, audit retention', icon: ShieldCheck },
  { id: 'about', title: 'ABOUT', subtitle: 'versions, commit, counts, documentation links', icon: FlaskConical },
] as const

export function SettingsTab() {
  const [open, setOpen] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('royalred-settings-section')
      if (saved) return [saved]
    }
    return ['providers']
  })
  const [settings, setSettings] = useState<Record<string, string> | null>(null)
  const [prefs, setPrefs] = useState<RouterPrefsShape | null>(null)
  const [providers, setProviders] = useState<MatrixProvider[]>([])
  const [sectionSearch, setSectionSearch] = useState('')

  // remember the last section the user was on
  const toggle = (id: string) => {
    setOpen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
    window.localStorage.setItem('royalred-settings-section', id)
  }

  useEffect(() => {
    void fetch('/api/royal-red/settings').then((r) => r.json()).then((j: { settings: Record<string, string>; routerPrefs: RouterPrefsShape }) => {
      setSettings(j.settings)
      setPrefs(j.routerPrefs)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    void fetch('/api/royal-red/providers').then((r) => r.json()).then((j: { providers: MatrixProvider[] }) => setProviders(j.providers)).catch(() => {})
  }, [])

  const changeSetting = (k: string, v: string) => {
    setSettings((cur) => (cur ? { ...cur, [k]: v } : cur))
    void fetch('/api/royal-red/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { [k]: v } }),
    }).catch(() => {})
  }

  const q = sectionSearch.trim().toLowerCase()
  const visibleSections = SECTIONS.filter((s) => !q || s.title.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q) || s.id.includes(q))

  return (
    <ScrollArea className="h-full">
      <div className="royalred-grid-bg space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={sectionSearch} onChange={(e) => setSectionSearch(e.target.value)} placeholder="search settings (try: google, security, mcp)..." aria-label="Search settings" className="h-8 bg-card pl-8 font-mono text-xs" />
          </div>
          <span className="hidden font-mono text-[10px] tracking-[0.25em] text-muted-foreground sm:inline">SETTINGS / {SECTIONS.length} SECTIONS</span>
        </div>

        {visibleSections.map((s) => (
          <Section
            key={s.id}
            id={s.id}
            title={s.title}
            subtitle={s.subtitle}
            icon={s.icon}
            open={open.includes(s.id)}
            onToggle={() => toggle(s.id)}
            badge={s.id === 'providers' ? '96' : s.id === 'connectors' ? '60' : s.id === 'mcp' ? '13' : s.id === 'skills' ? '10' : undefined}
          >
            {s.id === 'providers' && <ProvidersSection />}
            {s.id === 'routing' && <RoutingSection providers={providers} prefs={prefs} onPrefs={setPrefs} />}
            {s.id === 'connectors' && <ConnectorsSection />}
            {s.id === 'mcp' && <McpSection />}
            {s.id === 'skills' && <SkillsSection />}
            {s.id === 'general' && <GeneralSection settings={settings} onChange={changeSetting} />}
            {s.id === 'data' && <DataSection />}
            {s.id === 'security' && <SecuritySection settings={settings} onChange={changeSetting} />}
            {s.id === 'about' && <AboutSection />}
          </Section>
        ))}

        {!visibleSections.length && (
          <p className="py-8 text-center font-mono text-xs text-muted-foreground">no settings section matches &quot;{sectionSearch}&quot;.</p>
        )}

        <p className="pb-2 text-center font-mono text-[9px] tracking-[0.25em] text-muted-foreground">
          EVERY CHANGE IS SAVED IMMEDIATELY AND WRITES AN AUDIT ROW / KEYS ARE AES-256-GCM ENCRYPTED AND NEVER LEAVE THE SERVER
        </p>
      </div>
    </ScrollArea>
  )
}
