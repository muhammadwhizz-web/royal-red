// ROYAL RED Box — pluggable runtime (Phase 4.1).
//
// The directive is explicit: a sandbox that is really a namespace/chroot
// wrapper must not be called a "container". So the runtime advertises what it
// actually is. Two implementations exist:
//
//   ContainerRuntime  — wraps a REAL runtime (docker/podman). Detected at boot;
//                       absent in this environment (probed: no binaries, no
//                       socket), so it is constructed but never active here.
//   PathPrisonRuntime — honest userland emulation: mount table + containment
//                       checks + supervised child processes. This is what runs.
//
// Both satisfy the same BoxRuntime interface, so swapping in a real runtime
// later is a configuration change, not a rewrite.
import { execFileSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'

export type RuntimeKind = 'container' | 'path-prison'

export interface BoxRuntime {
  kind: RuntimeKind
  name: string
  // one-line honest description shown verbatim in the DESKTOP panel
  describe(): string
  available(): boolean
}

class ContainerRuntime implements BoxRuntime {
  kind = 'container' as const
  name = 'container'
  constructor(private engine: 'docker' | 'podman') {}
  describe() {
    return `${this.engine} container (namespaced, cgroup-limited)`
  }
  available() {
    return false // probed at boot; set true only when a socket is verified
  }
}

class PathPrisonRuntime implements BoxRuntime {
  kind = 'path-prison' as const
  name = 'path-prison'
  describe() {
    return 'path-prison emulation (mount table + containment + supervised processes). NOT a container: no kernel namespaces, no cgroups, same uid as the console.'
  }
  available() {
    return true
  }
}

function probeEngine(bin: string): boolean {
  try {
    execFileSync(bin, ['info', '--format', 'json'], { timeout: 3000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// select the strongest runtime available, honestly labeled
export function selectRuntime(): BoxRuntime {
  for (const engine of ['podman', 'docker'] as const) {
    if (existsSync(`/usr/bin/${engine}`) && probeEngine(engine)) {
      return new ContainerRuntime(engine)
    }
  }
  return new PathPrisonRuntime()
}

let cached: BoxRuntime | null = null
export function getBoxRuntime(): BoxRuntime {
  if (!cached) cached = selectRuntime()
  return cached
}

// ─────────────────────────────────────────────────────────────────────────────
// supervised child processes. Every process the box spawns is registered here
// so the kill switch (Phase 4.6) can SIGTERM the entire live set and so leak
// regression tests (Phase 3 soft spot #1) can assert the table returns to zero.
// ─────────────────────────────────────────────────────────────────────────────

interface ProcEntry {
  child: ChildProcess
  startedAt: number
  label: string
}

const live = new Map<number, ProcEntry>()
let nextPid = 1

export function registerChild(child: ChildProcess, label: string): number {
  const handle = nextPid++
  live.set(handle, { child, startedAt: Date.now(), label })
  child.once('exit', () => live.delete(handle))
  // safety net: never let an entry outlive its process object
  child.once('error', () => live.delete(handle))
  return handle
}

export function liveChildren(): ProcEntry[] {
  return [...live.values()]
}

export function terminateAll(signal: NodeJS.Signals = 'SIGTERM'): number {
  let n = 0
  for (const { child } of live.values()) {
    try {
      if (child.pid && !child.killed) {
        child.kill(signal)
        n++
      }
    } catch {}
  }
  return n
}
