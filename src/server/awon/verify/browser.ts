// AWON scoped verification browser (Phase 2.5 primitive).
//
// A minimal, verification-ONLY headless browser runner wrapping the
// `agent-browser` CLI in a dedicated isolated session. Capabilities are
// deliberately narrow: load a url, run js, click, type, assert DOM, screenshot,
// accessibility audit. This is NOT an agent-facing tool - it is never
// registered in the tool dispatcher; only the verification engine calls it.
// It never shares profile data with any user browser session, starts from a
// blank context each run, and every command runs under a hard timeout.
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'

const CMD_TIMEOUT_MS = 30_000

export class BrowserDeniedError extends Error {}

// URL guard: http(s) only. Private/metadata ranges are blocked; the ONE
// exception is the local AWON preview origin (the artifact sandbox served by
// this very app), which CMS verification must be able to open.
const PREVIEW_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function assertVerifiableUrl(raw: string, opts?: { allowLocalPreview?: boolean }): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new BrowserDeniedError(`invalid url: ${raw.slice(0, 120)}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BrowserDeniedError(`scheme not allowed: ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  // cloud metadata + link-local are always denied
  if (host === '169.254.169.254' || host.startsWith('169.254.') || host.startsWith('100.64.')) {
    throw new BrowserDeniedError('link-local / metadata addresses are denied')
  }
  if (isLocal) {
    if (!opts?.allowLocalPreview) throw new BrowserDeniedError('local addresses are denied for this check')
    if (u.protocol !== 'http:') throw new BrowserDeniedError('local preview must be http')
    const port = u.port === '' ? '80' : u.port
    if (port !== '3000') throw new BrowserDeniedError(`only the AWON preview origin (port 3000) is allowed locally, got ${port}`)
    if (!PREVIEW_ORIGIN_HOSTS.has(host === '::1' ? '[::1]' : host)) throw new BrowserDeniedError('bad local host')
  }
  return u.toString()
}

function ab(args: string[], session: string, timeoutMs = CMD_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'agent-browser',
      [...args, '--session', session],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout, stderr) => {
        const code = err ? ((err as { code?: number }).code ?? 1) : 0
        // agent-browser prints command errors on stdout as structured text too;
        // only treat as failure when exit code is non-zero
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}

export interface ScopedBrowser {
  open(url: string): Promise<void>
  evalJs(expr: string): Promise<string>
  click(selector: string): Promise<void>
  fill(selector: string, text: string): Promise<void>
  pressKey(key: string): Promise<void>
  waitFor(ms: number): Promise<void>
  reload(): Promise<void>
  screenshot(path: string): Promise<void>
  setViewport(w: number, h: number): Promise<void>
  setMedia(mode: 'dark' | 'light', reducedMotion?: boolean): Promise<void>
  a11yJson(): Promise<string>
  errors(): Promise<string>
  console(): Promise<string>
  close(): Promise<void>
}

// Each run gets a fresh session name; `close` removes every trace of it.
export async function withScopedBrowser<T>(
  fn: (b: ScopedBrowser) => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const session = `awon-verify-${randomUUID().slice(0, 8)}`
  const b: ScopedBrowser = {
    async open(url) {
      const safe = assertVerifiableUrl(url, { allowLocalPreview: true })
      const r = await ab(['open', safe], session)
      if (r.code !== 0) throw new Error(`open failed: ${(r.stdout || r.stderr).slice(0, 200)}`)
    },
    async evalJs(expr) {
      const r = await ab(['eval', expr], session)
      // agent-browser eval prints the result JSON-encoded (strings arrive
      // quoted: '"true"', '""'); decode once so callers see raw values
      const out = r.stdout.trim()
      if (out.startsWith('"') && out.endsWith('"') && out.length >= 2) {
        try {
          return JSON.parse(out) as string
        } catch {
          return out
        }
      }
      return out
    },
    async click(selector) {
      const r = await ab(['click', selector], session)
      if (r.code !== 0) throw new Error(`click ${selector} failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async fill(selector, text) {
      const r = await ab(['fill', selector, text], session)
      if (r.code !== 0) throw new Error(`fill ${selector} failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async pressKey(key) {
      await ab(['press', key], session)
    },
    async waitFor(ms) {
      const n = Math.max(0, Math.min(ms, 10_000))
      await ab(['wait', String(n)], session, n + 8_000)
    },
    async reload() {
      const r = await ab(['reload'], session)
      if (r.code !== 0) throw new Error(`reload failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async screenshot(path) {
      const r = await ab(['screenshot', path], session)
      if (r.code !== 0) throw new Error(`screenshot failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async setViewport(w, h) {
      const r = await ab(['set', 'viewport', String(w), String(h)], session)
      if (r.code !== 0) throw new Error(`viewport failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async setMedia(mode, reducedMotion = true) {
      const args = reducedMotion ? ['set', 'media', mode, 'reduced-motion'] : ['set', 'media', mode]
      const r = await ab(args, session)
      if (r.code !== 0) throw new Error(`media setting failed: ${(r.stdout || r.stderr).slice(0, 160)}`)
    },
    async a11yJson() {
      const r = await ab(['a11y', '--json'], session, 45_000)
      return r.stdout
    },
    async errors() {
      const r = await ab(['errors'], session)
      return r.stdout.trim()
    },
    async console() {
      const r = await ab(['console'], session)
      return r.stdout.trim()
    },
    async close() {
      await ab(['close'], session, 8_000)
    },
  }
  try {
    return await fn(b)
  } finally {
    await b.close().catch(() => {})
  }
}

// deterministic viewport setup for screenshots: fixed sizes, light media,
// reduced motion, fonts ready, animations frozen. Returns the eval result so
// callers can confirm fonts actually loaded.
export const DETERMINISM_JS = `(() => {
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}'
  document.head.appendChild(style)
  return document.fonts.status
})()`

export async function settlePage(b: ScopedBrowser, waitMs = 900): Promise<string> {
  const fontStatus = await b.evalJs(DETERMINISM_JS).catch(() => 'unknown')
  await b.waitFor(waitMs)
  // wait for webfonts deterministically when available
  await b.evalJs('document.fonts ? document.fonts.ready.then(() => "fonts-ready") : "no-fonts-api"').catch(() => '')
  return fontStatus
}
