// ROYAL RED workspace: sandboxed root for every artifact the agent produces.
import fs from 'fs'
import path from 'path'

export const WORKSPACE_ROOT = '/home/z/my-project/royalred-workspace'

export function ensureWorkspace(): void {
  fs.mkdirSync(path.join(WORKSPACE_ROOT, 'artifacts'), { recursive: true })
  fs.mkdirSync(path.join(WORKSPACE_ROOT, 'files'), { recursive: true })
}

export function artifactDir(artifactId: string): string {
  const dir = path.join(WORKSPACE_ROOT, 'artifacts', artifactId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeJoin(base: string, relPath: string): string {
  const target = path.resolve(base, relPath)
  if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) {
    throw new Error(`path escapes workspace: ${relPath}`)
  }
  return target
}

export function writeArtifactFiles(artifactId: string, files: { path: string; content: string }[]): string[] {
  const dir = artifactDir(artifactId)
  const written: string[] = []
  for (const f of files) {
    const clean = f.path.replaceAll('\\', '/').replace(/^\/+/, '')
    if (!clean || clean.includes('..')) throw new Error(`bad artifact path: ${f.path}`)
    const target = safeJoin(dir, clean)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, f.content, 'utf8')
    written.push(clean)
  }
  return written
}

// binary assets (generated images etc.) live on disk only; DB stores a tombstone entry
export function writeArtifactBuffer(artifactId: string, relPath: string, data: Buffer): string {
  const dir = artifactDir(artifactId)
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.includes('..')) throw new Error(`bad artifact path: ${relPath}`)
  const target = safeJoin(dir, clean)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, data)
  return clean
}

export function readArtifactFileBuffer(artifactId: string, relPath: string): Buffer | null {
  try {
    const dir = path.join(WORKSPACE_ROOT, 'artifacts', artifactId)
    const target = safeJoin(dir, relPath)
    return fs.readFileSync(target)
  } catch {
    return null
  }
}

export function artifactFileExists(artifactId: string, relPath: string): boolean {
  try {
    const dir = path.join(WORKSPACE_ROOT, 'artifacts', artifactId)
    const target = safeJoin(dir, relPath)
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'])

export function isImagePath(p: string): boolean {
  const ext = p.includes('.') ? p.split('.').pop()!.toLowerCase() : ''
  return IMAGE_EXTS.has(ext)
}

export function readArtifactFile(artifactId: string, relPath: string): string | null {
  try {
    const dir = path.join(WORKSPACE_ROOT, 'artifacts', artifactId)
    const target = safeJoin(dir, relPath)
    return fs.readFileSync(target, 'utf8')
  } catch {
    return null
  }
}

export function listArtifactFiles(artifactId: string): string[] {
  const dir = path.join(WORKSPACE_ROOT, 'artifacts', artifactId)
  const out: string[] = []
  const walk = (d: string, prefix: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out.sort()
}

const USER_FILES_DIR = path.join(WORKSPACE_ROOT, 'files')

export function resolveUserFile(relPath: string): string {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  return safeJoin(USER_FILES_DIR, clean)
}

// browser uploads land in files/uploads/ so every existing tool (read_file,
// analyze_image, list_files) sees them as normal workspace paths
export function saveUpload(originalName: string, data: Buffer): { path: string; size: number } {
  const dir = path.join(USER_FILES_DIR, 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  const base = path
    .basename(originalName || 'file')
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80)
  const stamp = Date.now().toString(36)
  const name = `${stamp}-${base || 'file'}`
  fs.writeFileSync(path.join(dir, name), data)
  return { path: `uploads/${name}`, size: data.length }
}

export function listUserFiles(): { path: string; size: number }[] {
  ensureWorkspace()
  const out: { path: string; size: number }[] = []
  const walk = (d: string, prefix: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), rel)
      else {
        let size = 0
        try {
          size = fs.statSync(path.join(d, e.name)).size
        } catch {}
        out.push({ path: rel, size })
      }
    }
  }
  walk(USER_FILES_DIR, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
