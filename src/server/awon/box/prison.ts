// AWON Box — path prison (Phase 4.1).
//
// HONEST NAMING: this is NOT a container. There is no docker/podman in this
// environment, no kernel namespaces, no cgroups, no seccomp. What this module
// provides is a userland path prison: every agent-initiated filesystem
// operation is resolved, containment-checked (including symlink escape), and
// matched against an explicit mount table before it may touch the disk.
// The runtime interface (runtime.ts) is pluggable so a real container runtime
// can replace this implementation later without touching the primitives.
//
// What it protects: agent writes/reads outside the box root, silent host-home
// access (the host home is NOT mounted - not even read-only - by default),
// traversal via `..`, traversal via symlinks that point outside the box.
// What it does NOT protect: kernel-level attacks, a compromised Node process
// (the prison is enforced by the same process), resource exhaustion at the
// kernel level. This is stated in the DESKTOP panel, not buried here.
import fs from 'fs'
import path from 'path'

// the box lives INSIDE the project directory so a sandbox reset still finds it
// next to the code, and the host home is never part of its tree
export const BOX_ROOT = '/home/z/my-project/awon-box'
export const BOX_HOME = path.join(BOX_ROOT, 'home', 'awon')
export const BOX_TRASH = path.join(BOX_ROOT, '.awon-trash')
export const BOX_TMP = path.join(BOX_ROOT, '.tmp')

// the box user sees this as their home directory
export const VIRTUAL_HOME = '/home/awon'

export type MountMode = 'rw' | 'ro'

export interface BoxMount {
  // virtual path as the agent sees it (absolute, inside the box namespace)
  virtual: string
  // real path on disk
  real: string
  mode: MountMode
  label: string
}

// The default mount table. The host filesystem is deliberately absent: nothing
// outside BOX_ROOT is reachable, and `~` resolves to the EMULATED home. A mount
// can only be added by explicit user consent (not implemented as an agent
// primitive on purpose - mounting the real home is a product decision, not an
// agent decision).
export function defaultMounts(): BoxMount[] {
  return [
    { virtual: VIRTUAL_HOME, real: BOX_HOME, mode: 'rw', label: 'home (emulated, rw)' },
    { virtual: `${VIRTUAL_HOME}/Downloads`, real: path.join(BOX_HOME, 'Downloads'), mode: 'rw', label: 'Downloads (rw)' },
    { virtual: `${VIRTUAL_HOME}/Documents`, real: path.join(BOX_HOME, 'Documents'), mode: 'rw', label: 'Documents (rw)' },
    { virtual: `${VIRTUAL_HOME}/Pictures`, real: path.join(BOX_HOME, 'Pictures'), mode: 'rw', label: 'Pictures (rw)' },
  ]
}

export class PrisonEscapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrisonEscapeError'
  }
}

function normalizeVirtual(p: string): string {
  let v = (p ?? '').trim()
  if (!v) throw new PrisonEscapeError('empty path')
  // the box user may write ~, ~/x, /home/awon/x, or plain relative paths
  // (relative resolves against the emulated home)
  if (v === '~') v = VIRTUAL_HOME
  else if (v.startsWith('~/')) v = VIRTUAL_HOME + v.slice(1)
  if (!v.startsWith('/')) v = `${VIRTUAL_HOME}/${v}`
  // collapse .. and . segments lexically first (realpath below still guards)
  const resolved = path.posix.normalize(v)
  if (resolved.includes('..')) throw new PrisonEscapeError(`path escapes the box: ${p}`)
  return resolved
}

// map a box-virtual path to a real path through the mount table. Throws
// PrisonEscapeError for anything outside the mounts. Symlink escape is checked
// by verifyReal() after resolution.
export function resolveVirtual(
  rawPath: string,
  mounts: BoxMount[] = defaultMounts(),
): { virtual: string; real: string; mount: BoxMount } {
  const virtual = normalizeVirtual(rawPath)
  // longest-prefix match
  let best: BoxMount | null = null
  for (const m of mounts) {
    if (virtual === m.virtual || virtual.startsWith(m.virtual.endsWith('/') ? m.virtual : m.virtual + '/')) {
      if (!best || m.virtual.length > best.virtual.length) best = m
    }
  }
  if (!best) {
    throw new PrisonEscapeError(`"${virtual}" is outside the box (host filesystem is not mounted)`)
  }
  const rel = virtual === best.virtual ? '' : virtual.slice(best.virtual.length + 1)
  const real = rel ? path.join(best.real, rel) : best.real
  return { virtual, real, mount: best }
}

// post-resolution containment: the final real path (with symlinks resolved)
// must still live inside the mounted real directory. This is what stops a
// planted symlink from walking out of the box.
export function verifyReal(realPath: string, mountReal: string): void {
  let resolved: string | null = null
  try {
    resolved = fs.realpathSync(realPath)
  } catch {
    // target does not exist yet (create ops): resolve the deepest existing
    // ancestor and containment-check that
    let probe = path.resolve(realPath)
    while (probe !== path.parse(probe).root) {
      probe = path.dirname(probe)
      try {
        resolved = fs.realpathSync(probe)
        break
      } catch {
        continue
      }
    }
  }
  if (!resolved) throw new PrisonEscapeError(`cannot resolve ${realPath}`)
  const rootResolved = fs.realpathSync(mountReal)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new PrisonEscapeError(`symlink escape detected: ${realPath} resolves to ${resolved}`)
  }
  // the mount root itself must be a real directory, not a symlink out
  const rootStat = fs.lstatSync(mountReal)
  if (rootStat.isSymbolicLink()) throw new PrisonEscapeError('mount root is a symlink')
}

export function canWrite(mount: BoxMount): boolean {
  return mount.mode === 'rw'
}

// stat a virtual path; returns null when it does not exist
export function statVirtual(rawPath: string, mounts: BoxMount[] = defaultMounts()): fs.Stats | null {
  const { real, mount } = resolveVirtual(rawPath, mounts)
  verifyReal(real, mount.real)
  try {
    return fs.statSync(real)
  } catch {
    return null
  }
}

// ensure the physical box tree exists (idempotent, called on boot paths)
export function ensureBoxTree(): void {
  for (const dir of [
    BOX_ROOT,
    BOX_HOME,
    path.join(BOX_HOME, 'Downloads'),
    path.join(BOX_HOME, 'Documents'),
    path.join(BOX_HOME, 'Pictures'),
    BOX_TRASH,
    BOX_TMP,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
