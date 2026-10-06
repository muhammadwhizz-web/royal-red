// AWON tool implementations. Everything is sandboxed and whitelisted.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { snapshotArtifactVersion } from './versions'
import {
  listUserFiles,
  listArtifactFiles,
  readArtifactFile,
  readArtifactFileBuffer,
  resolveUserFile,
  writeArtifactBuffer,
  WORKSPACE_ROOT,
} from './workspace'
import type { ArtifactPatch, ToolOutcome, ToolRequest } from '@/lib/awon/types'
import { runBoxPrimitive } from './box/primitives'
import { isAborted } from './box/ops'

const pexec = promisify(execFile)

const SHELL_ALLOW = [
  'uname', 'whoami', 'uptime', 'date', 'df', 'free', 'ps',
  'ls', 'echo', 'wc', 'head', 'tail', 'python3', 'node', 'bun',
]

async function runShell(command: string, timeoutMs = 15000): Promise<ToolOutcome> {
  const trimmed = command.trim()
  const parts = trimmed.split(/\s+/)
  const bin = parts[0]
  if (!SHELL_ALLOW.includes(bin)) {
    return {
      name: 'shell',
      ok: false,
      summary: `rejected: "${bin}" is not on the AWON whitelist`,
      detail: `allowed: ${SHELL_ALLOW.join(', ')}`,
    }
  }
  // python3/node/bun: inline eval (python3 -c / node -e / bun -e) runs in the
  // workspace cwd; script paths may be absolute under the workspace or relative
  // to it, but must resolve inside it
  if (['python3', 'node', 'bun'].includes(bin)) {
    const arg = parts[1] ?? ''
    const inlineFlag = bin === 'python3' ? '-c' : '-e'
    if (arg === inlineFlag) {
      // allowed: inline code executes with cwd pinned to the workspace
    } else {
      const resolved = path.isAbsolute(arg)
        ? path.resolve(arg)
        : path.resolve(WORKSPACE_ROOT, arg)
      if (!resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
        return {
          name: 'shell',
          ok: false,
          summary: 'rejected: interpreters may only execute workspace scripts',
          detail: `pass a workspace path like files/script.py or an absolute path under ${WORKSPACE_ROOT}`,
        }
      }
    }
  }
  try {
    const args = parts.slice(1)
    const { stdout, stderr } = await pexec(bin, args, {
      timeout: timeoutMs,
      cwd: WORKSPACE_ROOT,
      maxBuffer: 1024 * 512,
    })
    const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim()
    return {
      name: 'shell',
      ok: true,
      summary: out.slice(0, 200) || '(no output)',
      detail: out.slice(0, 4000),
    }
  } catch (e: unknown) {
    const err = e as { code?: number | string; message?: string; stdout?: string; stderr?: string }
    return {
      name: 'shell',
      ok: false,
      summary: `exit ${err.code ?? '?'}: ${(err.stderr || err.message || '').slice(0, 180)}`,
      detail: ((err.stdout || '') + '\n' + (err.stderr || '')).slice(0, 4000),
    }
  }
}

async function runSearch(query: string, num = 6): Promise<ToolOutcome> {
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const results = (await zai.functions.invoke('web_search', { query, num })) as {
      name: string
      url: string
      snippet: string
    }[]
    const lines = results.map((r, i) => `${i + 1}. ${r.name}\n   ${r.url}\n   ${r.snippet}`)
    return {
      name: 'web_search',
      ok: true,
      summary: `${results.length} results for "${query}"`,
      detail: lines.join('\n').slice(0, 6000),
    }
  } catch (e) {
    return { name: 'web_search', ok: false, summary: `search failed: ${(e as Error).message}` }
  }
}

async function systemReport(): Promise<ToolOutcome> {
  const parts: string[] = []
  const safe = async (label: string, bin: string, args: string[]) => {
    try {
      const { stdout } = await pexec(bin, args, { timeout: 8000, maxBuffer: 1024 * 128 })
      parts.push(`## ${label}\n${stdout.trim().slice(0, 1200)}`)
    } catch (e) {
      parts.push(`## ${label}\n(unavailable: ${(e as Error).message.slice(0, 120)})`)
    }
  }
  await safe('Kernel', 'uname', ['-a'])
  await safe('Uptime', 'uptime', [])
  await safe('CPU', 'ps', ['--no-headers', '-o', '%cpu', '-A'])
  await safe('Disk', 'df', ['-h', '/'])
  await safe('Memory', 'free', ['-h'])
  const cpuLine = parts.find((p) => p.startsWith('## CPU'))
  if (cpuLine) {
    const vals = cpuLine.match(/[\d.]+/g) ?? []
    const avg = vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0
    parts.splice(parts.indexOf(cpuLine), 1)
    parts.push(`## CPU (avg load %) ${avg.toFixed(1)}`)
  }
  const accounts = await db.awonAccount.findMany({ orderBy: { createdAt: 'asc' } })
  parts.push(
    `## AWON accounts (${accounts.length})\n${accounts.map((a) => `${a.username} [${a.role}]`).join('\n') || '(none)'}`,
  )
  const files = listUserFiles()
  parts.push(`## Workspace files (${files.length})\n${files.map((f) => `${f.path} (${f.size}B)`).join('\n') || '(empty)'}`)
  return {
    name: 'system_report',
    ok: true,
    summary: 'collected kernel, uptime, cpu, disk, memory, accounts, workspace',
    detail: parts.join('\n\n').slice(0, 6000),
  }
}

const IMAGE_SIZES = new Set(['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'])

// saves a generated image into the session artifact as a binary asset (disk) + tombstone entry (db)
async function generateImage(req: Extract<ToolRequest, { name: 'generate_image' }>, sessionId: string): Promise<ToolOutcome> {
  const prompt = String(req.args.prompt ?? '').trim().slice(0, 1200)
  if (!prompt) return { name: 'generate_image', ok: false, summary: 'rejected: prompt required' }
  const size = IMAGE_SIZES.has(String(req.args.size)) ? String(req.args.size) : '1024x1024'

  // resolve target artifact: latest in session, else create an awon-visuals artifact
  let artifact = await db.awonArtifact.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  })
  let created = false
  if (!artifact) {
    const id = `awon_${randomUUID().slice(0, 12)}`
    artifact = await db.awonArtifact.create({
      data: { id, sessionId, name: 'awon-visuals', kind: 'file', entry: 'assets/visual-1.png', files: '[]' },
    })
    created = true
  }

  // pick a safe unique path under assets/
  const requested = String(req.args.path ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
  const ext = requested && requested.includes('.') ? requested.split('.').pop()!.toLowerCase() : 'png'
  const validExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png'
  const base = requested
    ? requested.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_\/]/g, '').replace(/\.\.+/g, '').slice(0, 60) || 'visual'
    : `visual-${Date.now().toString(36)}`
  const relPath = `assets/${path.basename(base)}.${validExt}`.replace('assets/assets/', 'assets/')

  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const res = await zai.images.generations.create({ prompt, size })
    const b64 = res.data?.[0]?.base64
    if (!b64) return { name: 'generate_image', ok: false, summary: 'image model returned no data' }
    const buf = Buffer.from(b64, 'base64')
    writeArtifactBuffer(artifact.id, relPath, buf)

    const files = JSON.parse(artifact.files) as { path: string; content: string }[]
    const idx = files.findIndex((f) => f.path === relPath)
    if (idx >= 0) files[idx] = { path: relPath, content: '' }
    else files.push({ path: relPath, content: '' })
    // a freshly created awon-visuals artifact must point its entry at the real
    // file, otherwise the preview route 404s on the placeholder entry
    await db.awonArtifact.update({
      where: { id: artifact.id },
      data: { files: JSON.stringify(files), ...(created ? { entry: relPath } : {}) },
    })
    await snapshotArtifactVersion(artifact.id, JSON.stringify(files), `generate_image ${relPath}`)

    const patch: ArtifactPatch = {
      id: artifact.id,
      name: artifact.name,
      entry: created ? relPath : artifact.entry,
      files: files.map((f) => f.path),
      created,
    }
    return {
      name: 'generate_image',
      ok: true,
      summary: `generated ${relPath} (${Math.round(buf.length / 1024)}KB, ${size})`,
      detail: `image saved into artifact "${artifact.name}" at ${relPath}\nreference it from html with: <img src="${relPath}">\nALWAYS follow up with analyze_image on ${relPath} to visually verify it.`,
      artifactPatch: patch,
    }
  } catch (e) {
    return { name: 'generate_image', ok: false, summary: `image generation failed: ${(e as Error).message}` }
  }
}

// AWON eyes: VLM analysis of an artifact image, a workspace file, or an http(s) url
async function analyzeImage(req: Extract<ToolRequest, { name: 'analyze_image' }>, sessionId: string): Promise<ToolOutcome> {
  const question = String(req.args.question ?? 'Describe this image in detail. Note any visual flaws, unreadable text, or artifacts.').slice(0, 600)
  let dataUrl: string | null = null
  let source = ''
  try {
    if (req.args.url) {
      const raw = String(req.args.url)
      if (!/^https?:\/\//i.test(raw)) return { name: 'analyze_image', ok: false, summary: 'rejected: url must be http(s)' }
      source = raw.slice(0, 120)
      dataUrl = raw
    } else if (req.args.path) {
      const rel = String(req.args.path).replaceAll('\\', '/').replace(/^\/+/, '')
      if (rel.includes('..')) return { name: 'analyze_image', ok: false, summary: 'rejected: bad path' }
      // search latest artifact of the session first, then the user files dir
      let buf: Buffer | null = null
      const artifact = await db.awonArtifact.findFirst({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (artifact) {
        buf = readArtifactFileBuffer(artifact.id, rel)
        if (buf) source = `artifact:${artifact.id}/${rel}`
      }
      if (!buf) {
        const userPath = resolveUserFile(rel)
        buf = fs.readFileSync(userPath)
        source = `workspace:${rel}`
      }
      if (!buf || buf.length === 0) return { name: 'analyze_image', ok: false, summary: `image not found: ${rel}` }
      if (buf.length > 8 * 1024 * 1024) return { name: 'analyze_image', ok: false, summary: 'image too large (8MB cap)' }
      const mime = rel.endsWith('.png') ? 'image/png' : rel.endsWith('.webp') ? 'image/webp' : rel.endsWith('.gif') ? 'image/gif' : 'image/jpeg'
      dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    } else {
      return { name: 'analyze_image', ok: false, summary: 'rejected: provide path or url' }
    }

    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content ?? ''
    if (!text.trim()) return { name: 'analyze_image', ok: false, summary: 'vision model returned empty analysis' }
    return {
      name: 'analyze_image',
      ok: true,
      summary: `vision check on ${source}: ${text.slice(0, 140)}`,
      detail: text.slice(0, 4000),
    }
  } catch (e) {
    return { name: 'analyze_image', ok: false, summary: `vision check failed: ${(e as Error).message}` }
  }
}

// AWON web reader: open a page (search result, docs, article) and extract the
// main readable content. Research mode pairs web_search with read_page.
async function readPage(req: Extract<ToolRequest, { name: 'read_page' }>): Promise<ToolOutcome> {
  const raw = String(req.args.url ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) {
    return { name: 'read_page', ok: false, summary: 'rejected: url must be http(s)' }
  }
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const result = (await zai.functions.invoke('page_reader', { url: raw })) as {
      code?: number
      data?: { title?: string; html?: string; publishedTime?: string; url?: string }
    }
    const data = result?.data
    const html = data?.html ?? ''
    if (!data || !html.trim()) {
      return { name: 'read_page', ok: false, summary: `page reader returned no content for ${raw.slice(0, 120)}` }
    }
    // html -> readable plain text (strip script/style, tags, entities)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (!text) {
      return { name: 'read_page', ok: false, summary: 'page content was empty after extraction' }
    }
    const title = (data.title ?? '(untitled)').slice(0, 200)
    const pub = data.publishedTime ? `\npublished: ${data.publishedTime}` : ''
    const body = text.slice(0, 6000)
    return {
      name: 'read_page',
      ok: true,
      summary: `read "${title}" (${body.length} chars extracted)`,
      detail: `PAGE: ${title}\nurl: ${data.url ?? raw}${pub}\n\n${body}${text.length > body.length ? '\n\n[content truncated at 6000 chars]' : ''}`,
    }
  } catch (e) {
    return { name: 'read_page', ok: false, summary: `page read failed: ${(e as Error).message.slice(0, 160)}` }
  }
}

// AWON eyes: watch and understand a video from a public http(s) url OR a
// workspace file (uploads/<name> from the user, artifacts included).
// The vision endpoint only accepts images, so we get the bytes (download or
// local read), sample evenly spaced keyframes with ffmpeg, and send the frames
// to the VLM in one multi-image request. That is how AWON "watches" a video.
async function analyzeVideo(req: Extract<ToolRequest, { name: 'analyze_video' }>, sessionId: string): Promise<ToolOutcome> {
  const raw = String(req.args.url ?? '').trim()
  const relPath = String(req.args.path ?? '').trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (!raw && !relPath) return { name: 'analyze_video', ok: false, summary: 'rejected: provide url or path' }
  if (raw && !/^https?:\/\//i.test(raw)) return { name: 'analyze_video', ok: false, summary: 'rejected: url must be http(s)' }
  if (relPath && relPath.includes('..')) return { name: 'analyze_video', ok: false, summary: 'rejected: bad path' }
  const question = String(req.args.question ?? 'You are watching sampled frames from one video in chronological order. Describe what happens: overall content, the main scenes in order, notable actions, and any on-screen text.').slice(0, 600)

  const os = await import('os')
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'awon-video-'))
  const videoPath = path.join(tmp, 'input')
  try {
    if (relPath) {
      // artifact-hosted first (mirrors analyze_image): latest artifact of the
      // session, so agent-generated videos like artifacts/<id>/media/demo.mp4 work
      let served = false
      const artifact = await db.awonArtifact.findFirst({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (artifact) {
        const abuf = readArtifactFileBuffer(artifact.id, relPath)
        if (abuf && abuf.length > 0) {
          if (abuf.length > 64 * 1024 * 1024) {
            return { name: 'analyze_video', ok: false, summary: `artifact video too large (${Math.round(abuf.length / 1048576)}MB, cap 64MB)` }
          }
          await fs.promises.writeFile(videoPath, abuf)
          served = true
        }
      }
      if (!served) {
        // local source: workspace file (uploads land in files/uploads/)
        const local = resolveUserFile(relPath)
        const stat = await fs.promises.stat(local).catch(() => null)
        if (!stat || !stat.isFile()) return { name: 'analyze_video', ok: false, summary: `video not found in artifact or workspace: ${relPath}` }
        if (stat.size > 64 * 1024 * 1024) return { name: 'analyze_video', ok: false, summary: `video too large (${Math.round(stat.size / 1048576)}MB, cap 64MB)` }
        await fs.promises.copyFile(local, videoPath)
      }
    } else {
      // remote source: download with size + time caps
      const res = await fetch(raw, { signal: AbortSignal.timeout(60_000), redirect: 'follow' })
      if (!res.ok) return { name: 'analyze_video', ok: false, summary: `video download failed: HTTP ${res.status}` }
      const ctype = res.headers.get('content-type') ?? ''
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1024) return { name: 'analyze_video', ok: false, summary: 'video download too small to be a real file' }
      if (buf.length > 48 * 1024 * 1024) return { name: 'analyze_video', ok: false, summary: `video too large (${Math.round(buf.length / 1048576)}MB, cap 48MB)` }
      if (ctype.startsWith('text/')) return { name: 'analyze_video', ok: false, summary: 'rejected: url returned a web page, not a video file' }
      await fs.promises.writeFile(videoPath, buf)
    }

    // duration
    let duration = 0
    try {
      const { stdout } = await pexec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath], { timeout: 15000 })
      duration = Number(stdout.trim()) || 0
    } catch {}
    if (!duration || !Number.isFinite(duration)) {
      return { name: 'analyze_video', ok: false, summary: 'not a decodable video (ffprobe could not read duration)' }
    }

    // scene detection: log every hard cut (threshold 0.25), then sample frames
    // AT the scene changes; static videos fall back to even spacing
    let sceneTimes: number[] = []
    try {
      const det = await pexec('ffmpeg', ['-i', videoPath, '-vf', "select='gt(scene,0.25)',showinfo", '-f', 'null', '-'], { timeout: 45000 })
      sceneTimes = [...det.stderr.matchAll(/pts_time:([0-9.]+)/g)]
        .map((m) => Number(m[1]))
        .filter((t) => Number.isFinite(t) && t >= 0 && t <= duration)
        .map((t) => Math.round(t * 10) / 10)
      sceneTimes = [...new Set(sceneTimes)].sort((a, b) => a - b)
    } catch {}

    // adaptive frame budget: 8 for shorts, up to 24 for long videos (was hard-capped at 8)
    const MAX_FRAMES = 24
    const target = Math.min(MAX_FRAMES, duration < 20 ? 8 : duration < 60 ? 12 : duration < 180 ? 18 : MAX_FRAMES)
    const stamps: number[] = []
    if (sceneTimes.length >= target) {
      // spread across the scene list so long videos stay covered end to end
      for (let i = 0; i < target; i++) {
        const idx = Math.min(sceneTimes.length - 1, Math.max(0, Math.round(((i + 0.5) / target) * sceneTimes.length - 0.5)))
        stamps.push(sceneTimes[idx])
      }
    } else {
      // merge detected scenes with even samples, deduped at a 0.75s min gap
      const even: number[] = []
      for (let i = 0; i < target; i++) {
        const frac = (i + 0.5) / target
        even.push(Math.min(duration - 0.1, Math.max(0, duration * frac)))
      }
      for (const t of [...sceneTimes, ...even].sort((a, b) => a - b)) {
        if (stamps.length >= target) break
        if (!stamps.some((s) => Math.abs(s - t) < 0.75)) stamps.push(t)
      }
    }
    const frames: { label: string; dataUrl: string }[] = []
    for (let i = 0; i < stamps.length; i++) {
      const out = path.join(tmp, `frame-${i}.jpg`)
      try {
        await pexec('ffmpeg', ['-ss', stamps[i].toFixed(2), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', '-y', out], { timeout: 20000 })
        const fb = await fs.promises.readFile(out)
        if (fb.length > 0) {
          frames.push({ label: `FRAME ${i + 1} (t=${stamps[i].toFixed(1)}s)`, dataUrl: `data:image/jpeg;base64,${fb.toString('base64')}` })
        }
      } catch {}
    }
    if (!frames.length) return { name: 'analyze_video', ok: false, summary: 'ffmpeg could not extract any frames from this file' }

    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const content: { type: string; text?: string; image_url?: { url: string } }[] = [
      { type: 'text', text: `${question}\n\nVideo duration: ${duration.toFixed(1)}s. Below are ${frames.length} sampled frames in chronological order${sceneTimes.length ? ` (picked at ${Math.min(sceneTimes.length, stamps.length)} of the video's scene cuts)` : ' (evenly spaced)'}.` },
      ...frames.flatMap((f) => [
        { type: 'text', text: `[${f.label}]` },
        { type: 'image_url' as const, image_url: { url: f.dataUrl } },
      ]),
    ]
    const completion = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content ?? ''
    if (!text.trim()) return { name: 'analyze_video', ok: false, summary: 'video model returned empty analysis' }
    return {
      name: 'analyze_video',
      ok: true,
      summary: `watched ${duration.toFixed(0)}s via ${frames.length} frames${sceneTimes.length ? ` (${sceneTimes.length} scene cuts)` : ''}: ${text.slice(0, 100)}`,
      detail: `${text.slice(0, 5000)}\n\n[frames sampled from ${relPath ? `workspace:${relPath}` : raw.slice(0, 100)}]`,
    }
  } catch (e) {
    return { name: 'analyze_video', ok: false, summary: `video analysis failed: ${(e as Error).message}` }
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => {})
  }
}

export async function runTool(
  req: ToolRequest,
  ctx: { sessionId: string; emit?: (e: unknown) => void },
): Promise<ToolOutcome> {
  try {
    // Phase 4: the 13 permitted desktop primitives. The kernel (box/*) enforces
    // tiers, dry-run, journal and the kill switch regardless of model behavior.
    if (
      [
        'box_list', 'box_read', 'box_plan', 'box_write', 'box_mkdir', 'box_move',
        'box_copy', 'box_trash', 'box_undo', 'shell_exec', 'screen_shot',
        'screen_click', 'screen_type',
      ].includes(req.name)
    ) {
      if (!ctx.emit) {
        return { name: req.name, ok: false, summary: 'desktop primitives require a live console connection (no emit stream)' }
      }
      if (isAborted('*')) {
        return { name: req.name, ok: false, summary: 'ABORTED by kill switch - all box primitives refuse to run' }
      }
      return await runBoxPrimitive(req.name, (req.args ?? {}) as Record<string, unknown>, {
        sessionId: ctx.sessionId,
        emit: ctx.emit,
      })
    }
    switch (req.name) {
      case 'web_search':
        return await runSearch(String(req.args.query).slice(0, 300), Math.min(Number(req.args.num) || 6, 10))
      case 'list_files': {
        const files = listUserFiles()
        const arts = fs.existsSync(`${WORKSPACE_ROOT}/artifacts`)
          ? fs.readdirSync(`${WORKSPACE_ROOT}/artifacts`)
          : []
        return {
          name: 'list_files',
          ok: true,
          summary: `${files.length} user files, ${arts.length} artifacts`,
          detail: JSON.stringify({ files, artifacts: arts }, null, 1).slice(0, 4000),
        }
      }
      case 'read_file': {
        const p = resolveUserFile(String(req.args.path))
        const content = fs.readFileSync(p, 'utf8')
        return {
          name: 'read_file',
          ok: true,
          summary: `${req.args.path} (${content.length} chars)`,
          detail: content.slice(0, 8000),
        }
      }
      case 'write_file': {
        const p = resolveUserFile(String(req.args.path))
        fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
        fs.writeFileSync(p, String(req.args.content), 'utf8')
        return { name: 'write_file', ok: true, summary: `wrote ${req.args.path} (${String(req.args.content).length} chars)` }
      }
      case 'shell':
        return await runShell(String(req.args.command))
      case 'system_report':
        return await systemReport()
      case 'create_account': {
        const username = String(req.args.username).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
        if (!username) return { name: 'create_account', ok: false, summary: 'invalid username' }
        const exists = await db.awonAccount.findUnique({ where: { username } })
        if (exists) return { name: 'create_account', ok: false, summary: `account "${username}" already exists` }
        const acc = await db.awonAccount.create({
          data: { username, role: String(req.args.role ?? 'user'), note: req.args.note ?? null },
        })
        await db.awonAudit.create({ data: { action: 'account.create', detail: username, ok: true } })
        return { name: 'create_account', ok: true, summary: `created AWON account ${acc.username} [${acc.role}]` }
      }
      case 'remove_account': {
        const username = String(req.args.username).trim().toLowerCase()
        const existing = await db.awonAccount.findUnique({ where: { username } })
        if (!existing) return { name: 'remove_account', ok: false, summary: `no account "${username}"` }
        await db.awonAccount.delete({ where: { username } })
        await db.awonAudit.create({ data: { action: 'account.remove', detail: username, ok: true } })
        return { name: 'remove_account', ok: true, summary: `removed AWON account ${username}` }
      }
      case 'list_accounts': {
        const accounts = await db.awonAccount.findMany({ orderBy: { createdAt: 'asc' } })
        return {
          name: 'list_accounts',
          ok: true,
          summary: `${accounts.length} accounts`,
          detail: accounts.map((a) => `${a.username} [${a.role}] ${a.note ?? ''} since ${a.createdAt.toISOString()}`).join('\n') || '(none)',
        }
      }
      case 'generate_image':
        return await generateImage(req, ctx.sessionId)
      case 'analyze_image':
        return await analyzeImage(req, ctx.sessionId)
      case 'analyze_video':
        return await analyzeVideo(req, ctx.sessionId)
      case 'read_page':
        return await readPage(req)
      default:
        return { name: String((req as { name: string }).name), ok: false, summary: 'unknown tool' }
    }
  } catch (e) {
    return { name: req.name, ok: false, summary: `tool error: ${(e as Error).message}` }
  }
}

export { readArtifactFile, listArtifactFiles }
