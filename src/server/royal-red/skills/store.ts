// ROYAL RED skill store: SKILL.md import for the Skills section of the
// Settings cockpit. The install format is the Anthropic Agent Skills
// convention: a folder containing a SKILL.md file, which is YAML frontmatter
// (name, description, optionally version and author) followed by markdown
// instructions. Import is strictly read-only on the source: the folder or URL
// is parsed, never executed, and only the parsed fields reach the database.

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { db } from '@/lib/db'

const FETCH_TIMEOUT_MS = 20_000

export interface ParsedSkill {
  name: string
  description: string
  instructions: string
  version?: string
  author?: string
}

export interface InstallResult {
  ok: boolean
  skillId?: string
  error?: string
}

// the four frontmatter keys this parser understands; everything else in the
// block is tolerated but ignored
const FRONTMATTER_KEYS = new Set(['name', 'description', 'version', 'author'])

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return v.slice(1, -1)
  }
  return v
}

// Strict, honest SKILL.md parser. Frontmatter must be a --- delimited block
// opening on line one; inside, only simple "key: value" lines are read
// (nested YAML, lists and comments are ignored rather than half-interpreted).
// Returns null when the frontmatter or the required name and description are
// missing. No YAML library: values are trimmed and unquoted only.
export function parseSkillMd(raw: string): ParsedSkill | null {
  if (!raw) return null
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  if (lines[0].trim() !== '---') return null
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i
      break
    }
  }
  if (close === -1) return null

  const fields: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    if (!FRONTMATTER_KEYS.has(key)) continue
    fields[key] = stripQuotes(m[2].trim())
  }
  if (!fields.name || !fields.description) return null

  const parsed: ParsedSkill = {
    name: fields.name,
    description: fields.description,
    instructions: lines.slice(close + 1).join('\n').trim(),
  }
  if (fields.version) parsed.version = fields.version
  if (fields.author) parsed.author = fields.author
  return parsed
}

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unnamed-skill'
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
    }
    return err.message || err.name
  }
  return String(err)
}

async function upsertSkill(
  parsed: ParsedSkill,
  source: 'folder' | 'url',
  sourceRef: string,
  defaultAuthor: string,
): Promise<string> {
  const skillId = slugifyName(parsed.name)
  const data = {
    name: parsed.name,
    description: parsed.description,
    author: parsed.author ?? defaultAuthor,
    version: parsed.version ?? '1.0.0',
    source,
    sourceRef,
    instructions: parsed.instructions,
    toolsJson: JSON.stringify([]),
    promptsJson: JSON.stringify([]),
  }
  // upsert on skillId: reinstalling from the same folder or URL updates the
  // row in place; enabled stays exactly as the user left it
  await db.royalRedSkill.upsert({
    where: { skillId },
    update: data,
    create: { skillId, ...data },
  })
  return skillId
}

export async function installFromFolder(dir: string): Promise<InstallResult> {
  try {
    const st = await fs.stat(dir)
    if (!st.isDirectory()) return { ok: false, error: `not a directory: ${dir}` }
    const skillMdPath = path.join(dir, 'SKILL.md')
    let raw: string
    try {
      raw = await fs.readFile(skillMdPath, 'utf8')
    } catch {
      return { ok: false, error: `no SKILL.md found in ${dir} (expected ${skillMdPath})` }
    }
    const parsed = parseSkillMd(raw)
    if (!parsed) {
      return {
        ok: false,
        error: `SKILL.md in ${dir} is not parseable: a --- delimited frontmatter block with name and description is required`,
      }
    }
    try {
      const skillId = await upsertSkill(parsed, 'folder', dir, 'local')
      return { ok: true, skillId }
    } catch (err) {
      return { ok: false, error: `database write failed: ${reason(err)}` }
    }
  } catch (err) {
    return { ok: false, error: reason(err) }
  }
}

// resolve the raw SKILL.md candidates for a URL. GitHub repo roots and
// tree or blob URLs map onto raw.githubusercontent.com; everything else is
// fetched as-is and must itself be the SKILL.md.
function rawCandidates(url: URL): string[] {
  if (url.host !== 'github.com') return [url.toString()]
  const segs = url.pathname.split('/').filter(Boolean)
  if (segs.length < 2) return [url.toString()]
  const [owner, repo, kind, branch, ...rest] = segs
  const base = `https://raw.githubusercontent.com/${owner}/${repo}`
  if ((kind === 'tree' || kind === 'blob') && branch) {
    const sub = rest.join('/')
    if (!sub) return [`${base}/${branch}/SKILL.md`]
    if (!sub.endsWith('/SKILL.md')) return [`${base}/${branch}/${sub}/SKILL.md`]
    return [`${base}/${branch}/${sub}`]
  }
  // repo root: the default branch is unknown from the URL, so try main then master
  return [`${base}/main/SKILL.md`, `${base}/master/SKILL.md`]
}

export async function installFromUrl(url: string): Promise<InstallResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { ok: false, error: `not a valid URL: ${url}` }
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { ok: false, error: `unsupported protocol ${parsedUrl.protocol}: http or https required` }
  }

  let raw: string | null = null
  let lastError = ''
  for (const candidate of rawCandidates(parsedUrl)) {
    try {
      const res = await fetch(candidate, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      })
      if (!res.ok) {
        lastError = `HTTP ${res.status} ${res.statusText} for ${candidate}`
        continue
      }
      raw = await res.text()
      lastError = ''
      break
    } catch (err) {
      lastError = `fetch failed for ${candidate}: ${reason(err)}`
    }
  }
  if (raw === null) {
    return { ok: false, error: lastError || `no SKILL.md could be fetched from ${url}` }
  }

  const parsed = parseSkillMd(raw)
  if (!parsed) {
    return {
      ok: false,
      error: `the response from ${url} is not a parseable SKILL.md: a --- delimited frontmatter block with name and description is required`,
    }
  }
  try {
    const skillId = await upsertSkill(parsed, 'url', url, 'remote')
    return { ok: true, skillId }
  } catch (err) {
    return { ok: false, error: `database write failed: ${reason(err)}` }
  }
}
