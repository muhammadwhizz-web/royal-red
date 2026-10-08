// ROYAL RED MCP (Model Context Protocol) client.
//
// Speaks real JSON-RPC 2.0 to MCP servers over three transports: stdio (one
// newline-delimited JSON message per line through a spawned child process),
// Streamable HTTP (POST with JSON or SSE replies and mcp-session-id), and
// WebSocket via the runtime's built-in global. Nothing here invents
// capability: a server that never answers the initialize handshake comes back
// as ok:false with the server's own stderr tail quoted, never fake tools.
//
// Secrets discipline: tokens ride in headers only and are never echoed into
// error text; URLs quoted in ws errors have credentials stripped.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface McpServerSpec {
  type: 'stdio' | 'http' | 'ws'
  command?: string // stdio executable
  args?: string[] // stdio args
  env?: Record<string, string> // extra env vars for the child process
  url?: string // http or ws endpoint
  token?: string // bearer token for http/ws
  timeoutMs?: number // default 15000
}

export interface McpManifest {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
  resources: Array<{ uri: string; name?: string; description?: string }>
  prompts: Array<{ name: string; description?: string }>
  serverInfo?: { name?: string; version?: string }
}

export interface McpResult {
  ok: boolean
  manifest?: McpManifest
  error?: string
  latencyMs: number
}

// ---------------------------------------------------------------------------
// Protocol constants and small shared helpers
// ---------------------------------------------------------------------------

const MCP_PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'royal-red', version: '1.9.0' } as const
const DEFAULT_TIMEOUT_MS = 15_000
const KILL_GRACE_MS = 2_000 // SIGTERM, then SIGKILL after this long
const CLOSE_GUARD_MS = 5_000 // close() never waits longer than this
const STDERR_TAIL_CHARS = 300 // quoted into stdio error messages

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? 'undefined'
  } catch {
    return String(v)
  }
}

function jsonRpcErrorText(err: unknown): string {
  if (isRecord(err) && typeof err.message === 'string') {
    const code = typeof err.code === 'number' ? ` (code ${err.code})` : ''
    return `JSON-RPC error${code}: ${err.message}`
  }
  return `JSON-RPC error: ${safeStringify(err).slice(0, 200)}`
}

// A JSON-RPC response id must be a number or a string; anything else means the
// message is a notification (or server-to-client request) and has no waiter.
function responseIdOf(msg: Record<string, unknown>): string | number | undefined {
  const id = msg.id
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'string') return id
  return undefined
}

function remainingMs(deadline: number): number {
  return deadline - Date.now()
}

function deadlineOf(spec: McpServerSpec): number {
  return Date.now() + (spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
}

// Strip userinfo from a URL before it can land in an error message.
function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@]*@/g, '//')
}

// ---------------------------------------------------------------------------
// Transport seam: one implementation per spec.type behind one JSON-RPC seam.
// A transport owns ids, matches responses by id, ignores notifications it
// did not ask for, and always knows how to close itself cleanly.
// ---------------------------------------------------------------------------

interface PendingEntry {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface McpTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// stdio transport: spawn the server, newline-delimited JSON over pipes.
// MCP stdio frames carry no Content-Length headers, so the reader is a plain
// line splitter on stdout. Responses are matched by id; notifications from
// the server are ignored. stderr is kept as a short tail because that is
// what makes a dead server debuggable.
// ---------------------------------------------------------------------------

function spawnStdioServer(spec: McpServerSpec): ChildProcess {
  if (!spec.command) throw new Error('stdio transport requires a command in the server spec')
  try {
    return spawn(spec.command, spec.args ?? [], {
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    throw new Error(`failed to spawn stdio MCP server "${spec.command}": ${errorMessage(e)}`)
  }
}

class StdioTransport implements McpTransport {
  private readonly child: ChildProcess
  private readonly deadline: number
  private readonly pending = new Map<string | number, PendingEntry>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private spawnFailure: string | null = null
  private exited = false
  private nextId = 1

  constructor(spec: McpServerSpec, deadline: number) {
    this.child = spawnStdioServer(spec)
    this.deadline = deadline
    this.wire(spec.command ?? spec.args?.join(' ') ?? 'stdio server')
  }

  private wire(commandLabel: string): void {
    const child = this.child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.absorbStdout(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      // Keep only the tail; error messages quote at most 300 chars so a
      // chatty server cannot flood the Settings UI.
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
    })
    child.on('error', (err: Error) => {
      // Spawn failure (ENOENT, EACCES, ...). The exit event may never fire.
      this.spawnFailure = `failed to start stdio MCP server "${commandLabel}": ${err.message}${this.stderrSuffix()}`
      this.rejectAllPending(this.spawnFailure)
    })
    child.on('exit', (code, signal) => {
      this.exited = true
      this.rejectAllPending(
        `stdio MCP server exited early (code ${code === null ? 'none' : code}, signal ${signal ?? 'none'})${this.stderrSuffix()}`,
      )
    })
  }

  private stderrSuffix(): string {
    return this.stderrTail.length > 0 ? `; server stderr tail: ${this.stderrTail}` : ''
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(new Error(reason))
    }
  }

  private absorbStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const nl = this.stdoutBuffer.indexOf('\n')
      if (nl < 0) break
      const line = this.stdoutBuffer.slice(0, nl)
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1)
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const msg = safeJsonParse(trimmed)
    if (!isRecord(msg)) return // non-JSON chatter on stdout: ignored
    const id = responseIdOf(msg)
    if (id === undefined) return // server notification or request: nothing waiting on it
    const entry = this.pending.get(id)
    if (!entry) return // unsolicited or duplicate response: ignored
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (msg.error !== undefined && msg.error !== null) entry.reject(new Error(jsonRpcErrorText(msg.error)))
    else entry.resolve(msg.result)
  }

  private write(id: number, method: string, params?: Record<string, unknown>): boolean {
    const stdin = this.child.stdin
    if (!stdin || this.exited || this.spawnFailure) return false
    try {
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n')
      return true
    } catch {
      return false // pipe already torn down; the pending request reports it
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const remaining = remainingMs(this.deadline)
    if (remaining <= 0) {
      throw new Error(`timed out waiting for "${method}" (the MCP deadline passed)${this.stderrSuffix()}`)
    }
    if (this.spawnFailure) throw new Error(this.spawnFailure)
    if (this.exited) throw new Error(`stdio MCP server is no longer running${this.stderrSuffix()}`)
    const id = this.nextId++
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`timed out after ${remaining}ms waiting for "${method}"${this.stderrSuffix()}`))
      }, remaining)
      this.pending.set(id, { resolve, reject, timer })
      if (!this.write(id, method, params)) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error(`could not write "${method}" to the stdio MCP server's stdin${this.stderrSuffix()}`))
      }
    })
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    // A notification has no id and draws no reply: write and move on.
    const stdin = this.child.stdin
    if (!stdin || this.exited || this.spawnFailure) return
    try {
      stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} }) + '\n')
    } catch {
      // best effort; the next request reports the real state
    }
  }

  async close(): Promise<void> {
    this.rejectAllPending('connection closing')
    if (this.spawnFailure) return // nothing was ever spawned
    const child = this.child
    if (child.exitCode !== null || child.signalCode !== null) return // already gone
    try {
      child.stdin?.end() // closing stdin is the polite shutdown for stdio servers
    } catch {
      // already torn down
    }
    // Always kill: SIGTERM now, SIGKILL after the grace period, and a guard
    // so close() itself can never hang. No zombie processes on purpose.
    await new Promise<void>((resolveClose) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(escalateTimer)
        clearTimeout(guardTimer)
        resolveClose()
      }
      const escalateTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }, KILL_GRACE_MS)
      const guardTimer = setTimeout(finish, CLOSE_GUARD_MS)
      child.once('exit', finish)
      try {
        child.kill('SIGTERM')
      } catch {
        finish()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport: POST JSON-RPC to the endpoint, capture the
// mcp-session-id the server hands back, replay it on every later request.
// The reply is either application/json (parse directly) or an SSE stream
// (read data: lines until the event whose JSON-RPC id matches ours).
// Notifications are POSTed without an id; 202 Accepted is the spec answer.
// ---------------------------------------------------------------------------

function normalizeHttpError(e: unknown, method: string, budgetMs: number): Error {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError' || /abort/i.test(e.message)) {
      return new Error(`timed out after ${budgetMs}ms waiting for "${method}" over http`)
    }
    return e // our own protocol errors pass through untouched
  }
  return new Error(String(e))
}

class HttpTransport implements McpTransport {
  private readonly url: string
  private readonly token: string | undefined
  private readonly deadline: number
  private sessionId: string | null = null
  private nextId = 1

  constructor(spec: McpServerSpec, deadline: number) {
    if (!spec.url) throw new Error('http transport requires a url in the server spec')
    this.url = spec.url
    this.token = spec.token
    this.deadline = deadline
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extra,
    }
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    if (this.token) h.authorization = `Bearer ${this.token}` // never logged anywhere
    return h
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const remaining = remainingMs(this.deadline)
    if (remaining <= 0) throw new Error(`timed out waiting for "${method}" (the MCP deadline passed)`)
    const id = this.nextId++
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
        signal: AbortSignal.timeout(remaining),
      })
      const session = res.headers.get('mcp-session-id')
      if (session) this.sessionId = session
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`MCP server replied HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`)
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        return await this.readSseUntilResponse(res, id)
      }
      const bodyText = await res.text()
      const msg = safeJsonParse(bodyText)
      if (!isRecord(msg)) {
        throw new Error(`MCP server returned a non-JSON body over http: ${bodyText.slice(0, 120)}`)
      }
      return this.settleBody(msg, id)
    } catch (e) {
      throw normalizeHttpError(e, method, remaining)
    }
  }

  private settleBody(msg: Record<string, unknown>, id: number): unknown {
    if (responseIdOf(msg) !== id) {
      throw new Error(`MCP server response id mismatch over http (expected ${id})`)
    }
    if (msg.error !== undefined && msg.error !== null) throw new Error(jsonRpcErrorText(msg.error))
    return msg.result
  }

  // Streamable HTTP lets the server answer on an SSE stream: events separated
  // by blank lines, each data: line carries JSON. Read until the event whose
  // id matches, skipping the notifications that ride along.
  private async readSseUntilResponse(res: Response, id: number): Promise<unknown> {
    const body = res.body
    if (!body) throw new Error('MCP server sent an empty event-stream body')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let dataLines: string[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (;;) {
          const nl = buffer.indexOf('\n')
          if (nl < 0) break
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          if (line.startsWith('data:')) {
            let payload = line.slice(5)
            if (payload.startsWith(' ')) payload = payload.slice(1)
            dataLines.push(payload)
          } else if (line.length === 0 && dataLines.length > 0) {
            const eventText = dataLines.join('\n')
            dataLines = []
            const msg = safeJsonParse(eventText)
            if (isRecord(msg) && responseIdOf(msg) === id) {
              if (msg.error !== undefined && msg.error !== null) throw new Error(jsonRpcErrorText(msg.error))
              return msg.result
            }
            // anything else (notification, other id) is skipped
          }
        }
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // stream already finished on its own
      }
    }
    throw new Error('MCP server event-stream ended without a matching JSON-RPC response')
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const remaining = remainingMs(this.deadline)
    if (remaining <= 0) return
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} }),
        signal: AbortSignal.timeout(remaining),
      })
      const session = res.headers.get('mcp-session-id')
      if (session) this.sessionId = session
      // 202 Accepted is the spec answer for a notification; any 2xx is
      // tolerated and anything else is swallowed here on purpose: the very
      // next request reports the true state of the server.
      await res.text().catch(() => '')
    } catch {
      // best effort, same reasoning as above
    }
  }

  async close(): Promise<void> {
    // Politely end the streamable session via DELETE; purely best effort.
    const session = this.sessionId
    this.sessionId = null
    if (!session) return
    const headers: Record<string, string> = { 'mcp-session-id': session }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    try {
      await fetch(this.url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(2_000),
      })
    } catch {
      // session cleanup must never turn into a user-facing error
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket transport: uses the runtime's built-in WebSocket global (Bun and
// Node 22 both ship one). One JSON-RPC message per text frame, responses
// matched by id exactly like stdio. The open, every request, and the close
// are wrapped in promises with hard deadlines so nothing hangs.
// ---------------------------------------------------------------------------

function openWsSocket(url: string, token?: string): WebSocket {
  const wsCtor = (globalThis as Record<string, unknown>).WebSocket
  if (typeof wsCtor !== 'function') {
    throw new Error('ws transport requires a reachable WebSocket endpoint and a runtime with a built-in WebSocket (Bun and Node 22+ have one)')
  }
  const Ctor = wsCtor as new (url: string, protocols?: string | string[]) => WebSocket
  if (token) {
    // Bun accepts a headers bag as the second constructor argument. Engines
    // that expect a subprotocol list (Node's undici, browsers) throw
    // synchronously on the object and we fall back to the plain form; such a
    // server then surfaces its 401 as an honest connect failure below.
    try {
      const withHeaders = Ctor as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket
      return new withHeaders(url, { headers: { authorization: `Bearer ${token}` } })
    } catch {
      // fall through to the plain construction
    }
  }
  try {
    return new Ctor(url)
  } catch (e) {
    throw new Error(`ws connect failed for ${redactUrl(url)}: ${errorMessage(e)}`)
  }
}

class WsTransport implements McpTransport {
  private readonly ws: WebSocket
  private readonly deadline: number
  private readonly pending = new Map<string | number, PendingEntry>()
  private nextId = 1

  constructor(ws: WebSocket, deadline: number) {
    this.ws = ws
    this.deadline = deadline
    ws.addEventListener('message', (ev: Event) => {
      const data: unknown = (ev as MessageEvent).data
      if (typeof data !== 'string') return
      const msg = safeJsonParse(data)
      if (!isRecord(msg)) return
      const id = responseIdOf(msg)
      if (id === undefined) return // server notification: nothing waiting on it
      const entry = this.pending.get(id)
      if (!entry) return // late duplicate or unsolicited response
      this.pending.delete(id)
      clearTimeout(entry.timer)
      if (msg.error !== undefined && msg.error !== null) entry.reject(new Error(jsonRpcErrorText(msg.error)))
      else entry.resolve(msg.result)
    })
    const drop = (): void => this.rejectAllPending('ws connection closed before a response arrived')
    ws.addEventListener('close', drop)
    ws.addEventListener('error', drop)
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.reject(new Error(reason))
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const remaining = remainingMs(this.deadline)
    if (remaining <= 0) throw new Error(`timed out waiting for "${method}" (the MCP deadline passed)`)
    if (this.ws.readyState !== this.ws.OPEN) throw new Error('ws connection is not open')
    const id = this.nextId++
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`timed out after ${remaining}ms waiting for "${method}" over ws`))
      }, remaining)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }))
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error(`ws send failed for "${method}": ${errorMessage(e)}`))
      }
    })
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.ws.readyState !== this.ws.OPEN) return
    try {
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} }))
    } catch {
      // best effort; the next request reports the real state
    }
  }

  async close(): Promise<void> {
    this.rejectAllPending('connection closing')
    const ws = this.ws
    if (ws.readyState === ws.CLOSED) return
    await new Promise<void>((resolveClose) => {
      const guard = setTimeout(resolveClose, 1_000)
      ws.addEventListener(
        'close',
        () => {
          clearTimeout(guard)
          resolveClose()
        },
        { once: true },
      )
      try {
        ws.close(1000, 'royal-red done')
      } catch {
        clearTimeout(guard)
        resolveClose()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Session wiring: open the transport, run the real MCP handshake
// (initialize -> notifications/initialized), hand the session to the caller.
// ---------------------------------------------------------------------------

async function openTransport(spec: McpServerSpec, deadline: number): Promise<McpTransport> {
  if (spec.type === 'stdio') return new StdioTransport(spec, deadline)
  if (spec.type === 'http') return new HttpTransport(spec, deadline)
  if (spec.type === 'ws') return await openWsTransport(spec, deadline)
  throw new Error(`unknown MCP transport type: ${safeStringify((spec as { type: unknown }).type)}`)
}

async function openWsTransport(spec: McpServerSpec, deadline: number): Promise<McpTransport> {
  if (!spec.url) throw new Error('ws transport requires a url in the server spec')
  const remaining = remainingMs(deadline)
  if (remaining <= 0) throw new Error('timed out before the ws connection could be attempted')
  const ws = openWsSocket(spec.url, spec.token)
  await new Promise<void>((resolveOpen, rejectOpen) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // never even opened
      }
      rejectOpen(err)
    }
    const finish = (): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolveOpen()
    }
    const timer = setTimeout(() => {
      fail(new Error(`timed out after ${remaining}ms opening the WebSocket to ${redactUrl(spec.url ?? '')}`))
    }, remaining)
    ws.addEventListener('open', finish, { once: true })
    ws.addEventListener('error', () => {
      fail(new Error(`ws connect failed: the endpoint at ${redactUrl(spec.url ?? '')} refused or errored during the WebSocket handshake`))
    }, { once: true })
  })
  return new WsTransport(ws, deadline)
}

interface McpSession {
  transport: McpTransport
  serverInfo: { name?: string; version?: string } | undefined
}

async function openSession(spec: McpServerSpec, deadline: number): Promise<McpSession> {
  const transport = await openTransport(spec, deadline)
  try {
    const initRaw = await transport.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })
    await transport.notify('notifications/initialized')
    return { transport, serverInfo: narrowServerInfo(initRaw) }
  } catch (e) {
    await transport.close().catch(() => {})
    throw new Error(`MCP initialize handshake failed: ${errorMessage(e)}`)
  }
}

// ---------------------------------------------------------------------------
// Result narrowing: JSON arrives as unknown and leaves as typed manifest
// fields, or it does not appear at all. No invented entries.
// ---------------------------------------------------------------------------

function narrowServerInfo(raw: unknown): { name?: string; version?: string } | undefined {
  if (!isRecord(raw)) return undefined
  const si = raw.serverInfo
  if (!isRecord(si)) return undefined
  const name = typeof si.name === 'string' ? si.name : undefined
  const version = typeof si.version === 'string' ? si.version : undefined
  if (name === undefined && version === undefined) return undefined
  const out: { name?: string; version?: string } = {}
  if (name !== undefined) out.name = name
  if (version !== undefined) out.version = version
  return out
}

function resultArray(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw // tolerant of servers that skip the envelope
  if (isRecord(raw)) {
    const arr = raw[key]
    if (Array.isArray(arr)) return arr
  }
  return []
}

function narrowTools(raw: unknown): McpManifest['tools'] {
  if (!Array.isArray(raw)) return []
  const tools: McpManifest['tools'] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.name !== 'string' || item.name.length === 0) continue
    tools.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : undefined,
      inputSchema: item.inputSchema,
    })
  }
  return tools
}

function narrowResources(raw: unknown): McpManifest['resources'] {
  if (!Array.isArray(raw)) return []
  const resources: McpManifest['resources'] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.uri !== 'string' || item.uri.length === 0) continue
    resources.push({
      uri: item.uri,
      name: typeof item.name === 'string' ? item.name : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
    })
  }
  return resources
}

function narrowPrompts(raw: unknown): McpManifest['prompts'] {
  if (!Array.isArray(raw)) return []
  const prompts: McpManifest['prompts'] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.name !== 'string' || item.name.length === 0) continue
    prompts.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : undefined,
    })
  }
  return prompts
}

// ---------------------------------------------------------------------------
// Exported calls. Every one opens a fresh session, does its work, and closes
// the session in a finally block (stdio children are always killed), and
// every one reports latencyMs measured around the full call.
// ---------------------------------------------------------------------------

export async function connectAndList(spec: McpServerSpec): Promise<McpResult> {
  const started = Date.now()
  const deadline = deadlineOf(spec)
  let transport: McpTransport | null = null
  try {
    const session = await openSession(spec, deadline)
    transport = session.transport
    const toolsRaw = await transport.request('tools/list', {})
    // resources and prompts are optional capabilities: a server that rejects
    // either simply contributes an empty list instead of failing the call.
    const resourcesRaw = await transport.request('resources/list', {}).catch(() => null)
    const promptsRaw = await transport.request('prompts/list', {}).catch(() => null)
    const manifest: McpManifest = {
      tools: narrowTools(resultArray(toolsRaw, 'tools')),
      resources: narrowResources(resultArray(resourcesRaw, 'resources')),
      prompts: narrowPrompts(resultArray(promptsRaw, 'prompts')),
      serverInfo: session.serverInfo,
    }
    return { ok: true, manifest, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, error: errorMessage(e), latencyMs: Date.now() - started }
  } finally {
    if (transport) await transport.close().catch(() => {})
  }
}

export async function callTool(
  spec: McpServerSpec,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string; latencyMs: number }> {
  const started = Date.now()
  const deadline = deadlineOf(spec)
  let transport: McpTransport | null = null
  try {
    const session = await openSession(spec, deadline)
    transport = session.transport
    const raw = await transport.request('tools/call', { name: toolName, arguments: args })
    if (isRecord(raw) && raw.isError === true) {
      const detail = raw.content !== undefined ? safeStringify(raw.content) : safeStringify(raw)
      return {
        ok: false,
        error: `tool "${toolName}" reported isError: ${detail.slice(0, 400)}`,
        latencyMs: Date.now() - started,
      }
    }
    // MCP wraps payloads in a result envelope; the content blocks are the
    // useful part, so hand those back when present, the envelope otherwise.
    const result = isRecord(raw) && 'content' in raw ? raw.content : raw
    return { ok: true, result, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, error: errorMessage(e), latencyMs: Date.now() - started }
  } finally {
    if (transport) await transport.close().catch(() => {})
  }
}

export async function readResource(
  spec: McpServerSpec,
  uri: string,
): Promise<{ ok: boolean; contents?: unknown; error?: string; latencyMs: number }> {
  const started = Date.now()
  const deadline = deadlineOf(spec)
  let transport: McpTransport | null = null
  try {
    const session = await openSession(spec, deadline)
    transport = session.transport
    const raw = await transport.request('resources/read', { uri })
    const contents = isRecord(raw) && 'contents' in raw ? raw.contents : raw
    return { ok: true, contents, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, error: errorMessage(e), latencyMs: Date.now() - started }
  } finally {
    if (transport) await transport.close().catch(() => {})
  }
}

export async function getPrompt(
  spec: McpServerSpec,
  promptName: string,
): Promise<{ ok: boolean; messages?: unknown; error?: string; latencyMs: number }> {
  const started = Date.now()
  const deadline = deadlineOf(spec)
  let transport: McpTransport | null = null
  try {
    const session = await openSession(spec, deadline)
    transport = session.transport
    const raw = await transport.request('prompts/get', { name: promptName })
    const messages = isRecord(raw) && 'messages' in raw ? raw.messages : raw
    return { ok: true, messages, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, error: errorMessage(e), latencyMs: Date.now() - started }
  } finally {
    if (transport) await transport.close().catch(() => {})
  }
}
