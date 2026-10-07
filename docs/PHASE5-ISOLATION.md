# PHASE 5 ISOLATION SPEC — Sub-Agent Containment Contract

**Status: SLICE 1 IMPLEMENTED (Round 4).** The planner/builder pair runs under
exactly the contract below; the tests named "planned" are shipped as
`scripts/test-phase5-kernel.ts` (54 checks) and
`scripts/test-phase5-orchestrator.ts` (39 checks). The critic team and any
third sub-agent type remain Phase 5.2 (Round 6) — the caps below deny them
today. **The rule stands: an answer without a test does not ship.**

---

## Context

Phase 5 turns one run into a *team*: a planner delegating to builder/critic
sub-agents. A sub-agent is a **run** in the run-queue (Round 3 groundwork:
`src/server/royal-red/runqueue.ts`, proven by `scripts/test-run-queue.ts` —
3 concurrent runs, per-run audit/event attribution, per-run scalpel abort).
Everything below builds on that primitive.

## The six questions

### 1. How does agent A avoid seeing agent B's consent context?

**Answer:** Consent requests carry `sessionId` AND `runId` (`RoyalRedConsent.runId`
already exists). A sub-agent's consent cards are emitted only on its own SSE
stream and marked with its runId in the payload; the desktop queue renders them
tagged by run. Approval of run A's card is recorded against run A only — the
consent engine keys decisions by consent row id, never by session-wide scan.
Session-level **typed grants** (RoyalRedConsentRule) are deliberately shared:
they are the *user's* standing instructions to the whole session, not agent
state — this is documented in INVARIANTS.md S-8.
- **Test (planned, Phase 5):** `test-phase5-consent-isolation.ts` — two sub-runs request different consents concurrently; approving A's card leaves B's `pending`; B's card approval never appears in A's decision stream; a shared grant applies to both (and both decisions are audited with their own runId).

### 2. How does agent A avoid consuming agent B's budget?

**Answer:** Budgets are per-run rows (see `docs/PHASE5-BUDGET.md`): tokens,
wall-clock, and iteration counts accrue against the run's own ledger entries;
the cost ledger is already per-attempt with runId attribution (Round 3). The
planner's budget is the sum of its children's spent + its own direct calls;
a child exhausting its ceiling pauses only itself (see budget doc §escalation).
- **Test (planned):** `test-phase5-budget-isolation.ts` — two sub-runs, one drives its token ceiling into refusal, the other completes normally with its full ceiling unused; ledger rows attribute every spent token to exactly one runId.

### 3. How does a sub-agent avoid recursively spawning unbounded children?

**Answer:** Spawn depth is a kernel property, not an agent choice. A run
carries a `depth` field (0 = user-initiated). `depth >= MAX_DEPTH` (default 2:
run → sub-run → sub-sub-run) makes the spawn tool **deny at the global layer**
of the policy waterfall — it becomes a registered-tool deny, unwritable by any
prompt, session grant, or turn rule (monotonicity already proven:
`test-waterfall.ts`). A width cap (default 4 children per run) is enforced the
same way.
- **Test (planned):** `test-phase5-spawn-caps.ts` — depth-2 run attempting depth-3 spawn → global deny named `kernel spawn cap`; 5th child of the same parent → denied; both denials audited; no spawned process exists.

### 4. How does the kill switch decide which subtree to abort?

**Answer:** Two verbs, already shipped:
- **Global kill switch** (`triggerAbort`) — the hammer: aborts every running
  run in the subtree *and everywhere else*, freezes all pending consents, 30s
  refuse window. Unchanged behavior (acceptance step 9).
- **Per-run scalpel** (`abortOneRun`) — aborts one run; siblings untouched
  (proven: `test-run-queue.ts`).
- **Subtree abort (Phase 5 addition):** `abortSubtree(rootRunId)` walks the
  run table's `parentRunId` chain (depth-first) and calls the scalpel on every
  descendant, then the root; each abort gets its own audited row with runId.
  The subtree relation is persisted at spawn time (parentRunId), so the walk
  is a DB query, never an in-memory guess that a restart could lose.
- **Test (planned):** `test-phase5-subtree-abort.ts` — root + 3 children + 1 grandchild; subtree abort of child 1 kills the grandchild and child 1 only; child 2/3 complete; global switch still kills everything (both verbs re-proven at depth).

### 5. How does the undo journal distinguish "agent A's files" from "agent B's files"?

**Answer:** It already does. The write-ahead journal rows carry `runId`
(`RoyalRedUndoEntry.runId` since Phase 4), and Box trash paths are namespaced
per run (`.awon-trash/<runId>/…`). Undo is per-run (`undoRun(runId)`), newest-
first within that run. Two sub-agents trashing similarly-named files produce
independent journal chains and independent trash folders; cross-run undo is
impossible by construction. Files *both* runs wrote are separate paths; the
last-writer wins on identical paths and both writes are journaled (restore
order = journal order).
- **Existing proof:** acceptance steps 7–8 (per-run journal, restore); `test-run-queue.ts` ("run A journal intact").
- **Test (planned):** `test-phase5-undo-attribution.ts` — two concurrent sub-runs trash same-named files in different dirs + one same-path collision; undo run A restores only A's files; the trash namespaces never merge.

### 6. How is the session event log partitioned per sub-agent?

**Answer:** One session log, rows carry `runId` (schema exists since the
DeepSeek event-log port). The log is append-only and per-session-contiguous
(total order preserved across all runs — proven under concurrency:
`test-run-queue.ts` "seq contiguous under concurrent writers"). Partitioning is
a **read-side projection**: `replaySessionState(events, { runId })` folds one
run's substream; the unpartitioned replay remains the full-session truth.
Every run gets exactly one `run/started` and one `run/ended` (terminal-event
discipline, `finishRun` choke point).
- **Test (planned):** `test-phase5-log-partition.ts` — 3 interleaved runs; per-runId projections each replay exactly that run's events in order; the full log replays all; integrity check stays contiguous.

## Non-negotiables carried into Phase 5 unchanged

- No LLM judges its own security (critic never approves its own builder's plan; the policy waterfall and consent engine are model-blind code).
- Fail closed: unknown tool, unknown spawn depth, unavailable rule store — all deny.
- Tier 3 is per-action, per-run; batching across runs is structurally impossible (each consent row binds one runId).
- Every round: commit hash + worklog entry ID; every schema change: DB backup first.

## Open-order gate

Phase 5 opens **only after** (a) the provider-key decision (A or B) is answered
by the user, and (b) the full Round 3 battery is green. The planned tests above
become the Phase 5 acceptance suite — they are written *when Phase 5 opens*,
not before, and this document is the checklist that makes that work bounded.
