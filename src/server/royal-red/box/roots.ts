// ROYAL RED sandbox roots (Royal Red Round 2, DeepSeek-harness port #4).
//
// SOURCE PATTERN (MIT, verified upstream 2026-10-07):
//   deepseek-harness `packages/sandbox/sandbox/src/roots.ts` — the writable-
//   root derivation that is "one home" for a mode's meaning, shared by every
//   enforcement dialect so "the write tool cannot write /tmp but bash can"
//   asymmetries cannot arise between them (:1-14). `:30-41` canonicalPath():
//   resolve with realpathSync.native, and when the path is MISSING return the
//   spelling as-is — "a missing root matches nothing until it exists — the
//   conservative outcome; inventing a fallback would grant a path the caller
//   never named". `:52-55` writableRoots(): `read-only` allows nothing;
//   `workspace-write` = the workspace root + platform temp areas, as a
//   canonical, deduplicated allow-list.
//
// PORT DISCIPLINE (direct pattern port, reimplemented natively):
//   A DECLARATIVE SPEC for what a sandbox run exposes:
//     - mode: 'read-only' allows nothing; 'workspace-write' derives the
//       canonical writable allow-list from the spec
//     - grants are explicit, labeled, and scoped per-run / per-mode /
//       per-session via setScopeRoots() (the registry below)
//   The canonicalization rule is kept verbatim: roots are resolved with
//   realpathSync.native; a missing root stays as spelled (matches nothing)
//   and is reported by the API instead of being silently invented.
//   ENFORCEMENT: the path prison (box/prison.ts) remains the only thing that
//   decides containment. mountsForScope() in prison.ts merges this registry's
//   grants into the box mount table for a scope — per-run/per-session
//   configurability is the Phase 5 multi-agent foundation, and until a scope
//   is registered, every run sees exactly the default table (zero behavior
//   change today, proven by the existing suites).

import fs from 'fs'

export type SandboxMode = 'read-only' | 'workspace-write'

export interface RootGrant {
  /** absolute real path allowed by this grant */
  path: string
  mode: 'rw' | 'ro'
  label: string
}

export interface RootsSpec {
  mode: SandboxMode
  /** the workspace root this run may write under (canonicalized on read) */
  workspaceRoot: string
  grants: RootGrant[]
}

// ---------- canonical derivation (harness roots.ts:30-55, verbatim rules) ----------

/**
 * Resolve a granted root to the path the enforcement layer actually compares:
 * canonical (symlinks resolved). A missing root returns the spelling as-is —
 * it matches nothing until it exists (the conservative outcome).
 */
export function canonicalPath(path: string): string {
  try {
    return fs.realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * The roots one confined execution may WRITE under — the mode's meaning as a
 * canonical, deduplicated allow-list. `read-only` allows nothing.
 */
export function writableRoots(spec: RootsSpec): string[] {
  if (spec.mode !== 'workspace-write') return []
  return [...new Set([spec.workspaceRoot, ...spec.grants.filter((g) => g.mode === 'rw').map((g) => g.path)].map(canonicalPath))]
}

/** read targets for the spec: canonical, deduped, ro + rw combined */
export function readableRoots(spec: RootsSpec): string[] {
  if (spec.mode !== 'workspace-write') return []
  return [...new Set(spec.grants.map((g) => g.path).map(canonicalPath))]
}

// ---------- per-scope registry (per-run / per-mode / per-session) ----------

export interface RootsScope {
  sessionId?: string
  runId?: string
  mode?: string
}

function scopeKey(s: RootsScope): string {
  return `${s.sessionId ?? '*'}:${s.runId ?? '*'}:${s.mode ?? '*'}`
}

// module-level registry; entries are declarative specs, never filesystem state
const scopeSpecs = new Map<string, RootsSpec>()

/**
 * Declare what a scope's sandbox exposes. Replaces any prior spec for the
 * exact scope. Grants that escape the workspace root are flagged by
 * describeScope, never silently accepted as writable roots.
 */
export function setScopeRoots(scope: RootsScope, spec: RootsSpec): { key: string; writableRoots: string[]; outsideWorkspace: string[] } {
  const key = scopeKey(scope)
  scopeSpecs.set(key, spec)
  const writable = writableRoots(spec)
  const ws = canonicalPath(spec.workspaceRoot)
  const outside = writable.filter((r) => r !== ws && !r.startsWith(ws + '/'))
  return { key, writableRoots: writable, outsideWorkspace: outside }
}

export function clearScopeRoots(scope: RootsScope): boolean {
  return scopeSpecs.delete(scopeKey(scope))
}

/** the effective spec for a scope: most specific match (run > session > mode > defaults) */
export function scopeSpec(scope: RootsScope): RootsSpec | null {
  for (const key of [scopeKey(scope), scopeKey({ sessionId: scope.sessionId, mode: scope.mode }), scopeKey({ sessionId: scope.sessionId }), scopeKey({ mode: scope.mode })]) {
    const s = scopeSpecs.get(key)
    if (s) return s
  }
  return null
}

/** inspectable snapshot: what every registered scope exposes */
export function describeScopes(): { key: string; spec: RootsSpec; writableRoots: string[]; readableRoots: string[] }[] {
  return [...scopeSpecs.entries()].map(([key, spec]) => ({ key, spec, writableRoots: writableRoots(spec), readableRoots: readableRoots(spec) }))
}

/** the kernel default spec: the box workspace, writable — nothing else */
export function defaultSpec(workspaceRoot: string): RootsSpec {
  return { mode: 'workspace-write', workspaceRoot, grants: [] }
}
