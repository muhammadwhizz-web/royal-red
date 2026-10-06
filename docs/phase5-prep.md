# Phase 5 Prep — Run-Queue N-Capability, Budget Policy, Sub-Agent Isolation Spec

Task ID 21-d · additive groundwork ONLY (no sub-agents implemented, no schema changes, no new deps).
Proof tests: `bun scripts/test-runqueue.ts` (34/34) · `bun scripts/test-budget.ts` (24/24) · `scripts/test-phase4.ts` regression 47/47 after the ops.ts wire-in.

Files touched: `src/server/awon/box/budget.ts` (NEW), `src/server/awon/box/ops.ts` (+9 lines: budget gate in `beginRun` ops.ts:51, `releaseRun` receipt in `finishRun` ops.ts:73), `scripts/test-runqueue.ts` (NEW), `scripts/test-budget.ts` (NEW), this doc.

---

## 1. BUDGET POLICY

Shipped in `src/server/awon/box/budget.ts`. Module: `BudgetPolicy` interface, `DEFAULT_POLICY`, `getPolicy()`, `setPolicy()`, `reserveRun()`, `releaseRun()`, `assertTokenBudget()`, `assertWallClock()`.

### Defaults table

| Knob | Default | Env override (read once at module load) | Status today |
|---|---|---|---|
| `maxConcurrentRuns` | 4 | `AWON_MAX_CONCURRENT_RUNS` | **ENFORCED HARD** (fail-closed at `beginRun`) |
| `maxTokensPerRun` | 400,000 | `AWON_MAX_TOKENS_PER_RUN` | provisioned, **ADVISORY** (audit + report only) |
| `maxWallClockMsPerRun` | 600,000 (10 min) | `AWON_MAX_WALLCLOCK_MS_PER_RUN` | provisioned, **ADVISORY** (audit + report only) |
| `maxSubAgentsPerRun` | 0 (Phase 5 raises this) | none (deliberate — set via `setPolicy` only) | spec-only; no spawn site exists yet |
| `escalation` | `'fail_closed'` | none — **pinned**; `setPolicy` re-pins it after every patch | constitutional, not configurable |

### Config surface

- **Env**: the three `AWON_MAX_*` vars are parsed once at import time (integer, >= 0, fallback to default on garbage). Proven in `test-budget.ts` via a fresh `bun` subprocess with `AWON_MAX_CONCURRENT_RUNS=7 AWON_MAX_TOKENS_PER_RUN=123 AWON_MAX_WALLCLOCK_MS_PER_RUN=456`.
- **Runtime**: `setPolicy(partial)` merges over the active policy and writes a `budget.policy` audit row; `escalation` cannot be changed through it (the type omits it, the implementation re-pins `'fail_closed'`). Intended for tests now, a settings surface later.
- **No DB/config-file storage** — the policy is process state, deliberately; the audit trail records every change.

### Enforced HARD today: `maxConcurrentRuns` (concurrency cap)

- `ops.ts beginRun` (line 51) creates the run row, then calls `reserveRun(id)`. `reserveRun` counts `AwonRun` rows with `status: 'running'` **excluding the run being reserved** (its row already exists at call time), and returns `{ ok: false, reason }` when `active >= maxConcurrentRuns`. With the default 4: exactly 4 runs may be in flight; the 5th is refused.
- On refusal, `beginRun` marks the new row `status: 'aborted'` with `abortReason: "budget: <reason>"` and **throws** — fail-closed: the executor never sees a runId, the plan does not run. `test-budget.ts` proves the 5th-refused, release-frees-slot, and end-to-end `beginRun` throw + aborted row.
- `ops.ts finishRun` (line 73) calls `releaseRun(runId)` after the status update (errors swallowed — `finishRun` never breaks). The slot is freed by the terminal status; the `budget.release` row is the ledger receipt. If a row is STILL `running` when released (exceptional path: only `finishRun` should set terminal statuses), `releaseRun` aborts it with an explicit `budget.release` reason — a running row must never silently vanish while holding a slot.
- Proven under real concurrency: `test-runqueue.ts` launches 3 plans via `Promise.all` through the same kernel; each run got exactly one `budget.reserve admitted` row, zero `REFUSED` rows, and zero `running` rows afterwards.

### Provisioned-but-ADVISORY until Phase 5 wires agent.ts

- `assertTokenBudget(runId, usedTokens)` — audits `budget.tokens` (ok true/false, numbers in detail) and returns `{ ok, exceeded, used, max }`. Nothing refuses today. Phase 5's agent loop must call it per iteration.
- `assertWallClock(runId, startedAtMs)` — audits `budget.wallclock` and returns `{ ok, exceeded, elapsedMs, maxMs }`. Nothing aborts today. Phase 5's agent loop must call it per iteration.
- **Nothing calls these two in production code yet** — that is the explicit Phase 5 wiring point (agent.ts), not an omission of this prep.

### Escalation rules (Phase 5 contract)

1. **Tokens exceeded** → warn (audit row exists from the moment the check fires) → **next iteration refused** by the agent loop.
2. **Wall-clock exceeded** → run marked **aborted with reason `'budget wall-clock'`** by the agent loop.
3. **Sub-agent spawn attempt above `maxSubAgentsPerRun`** → **refused at the spawn site**. Phase 5 hook point: the future sub-agent spawn primitive (the `tools.ts` dispatch / `primitives.ts` layer, wherever `box_spawn` lands) must consult `getPolicy().maxSubAgentsPerRun` against the CALLER's level before creating any run (see §2c).
4. **Concurrency cap** → refused at `beginRun` — shipped in this prep.
5. **Every budget decision writes an `AwonAudit` row** (`action: 'budget.*'`, `ok: true/false`, numbers in `detail`), following the exact `db.awonAudit.create` pattern of ops.ts. Actions in use: `budget.reserve` (admit/REFUSE), `budget.release`, `budget.tokens`, `budget.wallclock`, `budget.policy` (config changes).

---

## 2. SUB-ISOLATION SPEC (written BEFORE any Phase 5 code, per directive)

Governing idea: **the run (`AwonRun.id`) is the unit of isolation**; the session is the unit of ownership. N agents share ONE process table, ONE consent queue, ONE undo journal, ONE audit log — isolation is enforced by scoping every row and every check to a runId, never by duplicating infrastructure.

### (a) Consent context isolation

- Today every `AwonConsent` row already carries `sessionId` AND `runId` (schema; `requestConsent` writes both, consent.ts:84). That part of the spec is already satisfied by the data model.
- **Where the scope check lives today: it does not.** `decideConsent(id, answer)` (consent.ts:169) validates existence, status and expiry — but not WHO is answering. The API route `POST /api/awon/desktop/consent/[id]` passes only the id. The implicit trust boundary today: consent ids are unguessable (`con_` + 12 uuid chars) and the only answering surface is the human's DESKTOP panel.
- **What Phase 5 must add**: a caller context on `decideConsent` — `{ callerSessionId, callerRunId, callerIsSubAgent }` (human panel calls keep passing none, unchanged behavior). Enforcement on every decision:
  1. `row.sessionId === callerSessionId`, else refuse + audit `consent.scope_refused` (cross-SESSION answering becomes impossible);
  2. a sub-agent caller may only SEE its own run's rows (`row.runId === callerRunId`) — cross-run consent listing/answering is refused;
  3. a sub-agent caller may only **ANSWER-DENY** its own run's consents — `approve`/`modify`/`rule` from a sub-agent is refused: a sub-agent must never approve its own destructive action; approval is human-only.
- The kernel's own T3 per-action path (`executePlan` → `requestConsent`) is unchanged: rows still carry runId, so scoping is a decision-time check, not a request-time one.

### (b) Budget accounting

- Budget ledgers are **per-run** (token count, startedAt wall clock), maintained by the Phase 5 agent loop using `assertTokenBudget` / `assertWallClock` per iteration. Ledgers **roll up to the session** for display (sum of the session's runs) but enforcement stays per-run: a parent's budget is never drained by a child silently.
- A sub-agent CANNOT spend its parent's budget without an audit row: any spend charged to a ledger the spender does not own (parent's token pool, a shared session pool if Phase 5 defines one) must write a `budget.*` audit row naming BOTH runIds — spender and owner — in `detail`. Refusal when the owner's cap would be breached follows §1 escalation rule 1.

### (c) Recursion

- A sub-agent **CANNOT spawn sub-agents**. `maxSubAgentsPerRun` applies **per level**: level-0 (top) agents may spawn up to N children; level >= 1 agents have a hard 0.
- Level-0 agents get `N > 0` only when Phase 5 defines the role table (which roles exist, how many of each). Until that table ships, the effective value stays 0 everywhere.
- Hook point: the spawn site (future `box_spawn` primitive) receives the caller's level, refuses `spawn` when `maxSubAgentsPerRun === 0` for that level, refuses above-cap otherwise, and writes a `budget.spawn` audit row for every attempt (granted or refused).

### (d) Process table

- Supervised children are registered per-run today: every spawned process goes through `registerChild` (runtime.ts:91, a module-level Map keyed by handle — the ONE legitimate shared table). **The kill switch already SIGTERMs the whole session tree**: `triggerAbort` (ops.ts:32) calls `terminateAll('SIGTERM')` (runtime.ts:104) over ALL supervised children, freezes every pending consent (`freezeAllPending`), marks all `running` rows aborted, audits `desktop.abort`, and sets a 30s global refuse window.
- Phase 5 must: keep `terminateAll` as the last-resort global kill; extend `ProcEntry` with the owning `runId` (additive metadata) so per-run cleanup becomes possible; per-run timeout kills target only that run's entries.

### (e) Undo journal

- `AwonUndoEntry` rows are **per-run** (`@@unique([runId, seq])`, schema) — the write-ahead journal is keyed by construction. Proven under concurrency: `test-runqueue.ts` verifies each run's rows reference only its own fixture paths and no row ever spans two fixtures.
- `undoRun(runId, sessionId)` (ops.ts:166) replays ONE run newest-first. Undo is **user-initiated per run** (panel UNDO click = the consent, audited `desktop.undo.panel`; agent-initiated undo raises its own T2 card) and **never cross-run**: no API reverses more than one runId. Phase 5 keeps this — no batch undo across runs, and a sub-agent may never call `undoRun` for a run it does not own.

### (f) Audit

- ONE log (`AwonAudit`), append-only, shared by all agents. Every agent action must carry its `runId` so the DESKTOP panel can attribute actions.
- **FINDING (from the `test-runqueue.ts` kernel audit): today's per-step rows (`desktop.<op>`, written by `executePlan`) do NOT embed runId** — under N runs the audit tail cannot attribute a step row to a run (the SSE `desktop_step` event has it; the durable row does not). Phase 5 must add runId attribution in the schema pass (a `runId String?` column on `AwonAudit`, or a mandatory `runId=…` detail prefix). The `budget.*` rows shipped in this prep already embed `runId=` in `detail` and set the pattern.
- The 30s refuse window + `setGlobalAbort` after a kill switch are intentionally GLOBAL (one user, one machine): pressing ABORT stops everything. Phase 5 may add per-session aborts but must keep the global kill switch as the supreme authority.

---

## 3. CRITIC MODEL PROVISIONING

> **'Phase 5 cannot ship INDEPENDENT PROVIDER critique without a second API key. Provide one or accept SAME-FAMILY mode as the ceiling.'**

BYO provider config exists today: `src/app/api/awon/providers/route.ts` (Phase 2.2, backed by the `AwonProviderConfig` table) accepts `openai | anthropic | custom` endpoints with keys stored AES-256-GCM encrypted at rest (`apiKeyEnc`, never returned by any API — only a masked `keyHint`), enforces https baseUrls (localhost http tolerated for local runners like ollama), pins `purpose: 'critique'`, keeps a single active critic via the `activate` flag, and audit-logs every mutation (`provider.create/update/delete`). A second key entered there is all Phase 5 needs for an independent critic; without it, critique stays same-family (same model grading its own family's output) as the ceiling.
