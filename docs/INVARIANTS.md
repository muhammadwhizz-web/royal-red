# ROYAL RED — SYSTEM INVARIANTS

**Document version: 1.0 (2026-10-07, Round 3)**
**Change rule: this document never changes without a version bump and a worklog entry citing the reason.**

This is the single place where the properties that make Royal Red trustworthy are
written down. Every invariant carries a **how it's tested** line pointing at a real,
runnable check. Where a test does not exist, the gap is stated as a gap — this
document does not claim enforcement it cannot prove.

For anyone evaluating Royal Red (investor, acquirer, engineer): run the cited
suites. Green receipts are reproducible; this document tells you which receipts
back which claim.

---

## A. Security invariants (never violated)

### S-1. Path prison — no code path touches the user's real home
All "user" file operations happen inside the emulated Box (`/home/z/my-project/royalred-box/home/royalred`),
via a mount table + realpath containment. The real `/home/z/*` home directories
are never read, written, listed, or deleted by any kernel code path.
- **Enforced by:** `src/server/royal-red/box/prison.ts` (mount table, `resolveVirtual`, `verifyReal`); sandbox roots grants can only extend within the box root.
- **Tested by:** `qa/qa-softspots.sh` → leak regression suite; acceptance fixture check ("real /home/z/Downloads untouched"); `scripts/test-arch-invariants.ts` → path-prison grep (no literals into the real user home outside kernel roots).

### S-2. Consent gate — the loop pauses for consent, fail-closed
Every session-tier action pauses the loop, streams `consent.request`, and waits
for `consent.decision`; execution resumes only on approval. A 120-second
timeout is a **deny**, never an approval.
- **Enforced by:** `src/server/royal-red/box/consent.ts` (pending rows, FIFO queue, 120s expiry, abort-state triple-checkpoint).
- **Tested by:** acceptance steps 1–2 (live card, live approval); `scripts/test-phase4-stacking.ts` (FIFO order, independent 120s clocks, timeout ⇒ deny).

### S-3. Tier 3 actions: per-action consent, no batching
Destructive actions (trash, shell exec, screen click/type) ask one dialog per
action. No session-level or plan-level approval can pre-authorize them.
- **Enforced by:** `box/ops.ts` executor (Tier-3 branch inside the step loop); `policy/waterfall.ts` BOX_TIERS.
- **Tested by:** acceptance step 6a; stacking suite (T3 independent of T1 batch cards). `scripts/test-waterfall.ts` ("T3 ask says never batched").

### S-4. `rm` is structurally absent — deletes go to `.awon-trash/`
There is no delete. Box deletes are moves into `.awon-trash/<runId>/` with a
7-day TTL, restorable by undo. No shell `rm`, no `unlink`/`rmSync` on Box paths
anywhere in the kernel.
- **Enforced by:** `box/ops.ts` executeStep (trash op), journal-before-disk.
- **Tested by:** `scripts/test-arch-invariants.ts` → trash-only law (destructive fs confined to a named allowlist of kernel-owned stores, no shell `rm`); acceptance steps 6c/6d/7/8 (files land in trash, undo restores them).

### S-5. Kill switch: global hammer AND per-run scalpel
The global kill switch freezes the consent queue, aborts every running run,
SIGTERMs supervised children, and refuses new actions for 30 seconds. The
per-run abort (run-queue) stops exactly one run and must not touch siblings,
consents, or the refuse window.
- **Enforced by:** `box/ops.ts triggerAbort`, `box/abort-state.ts` (global flag vs per-run set), `runqueue.ts abortOneRun`.
- **Tested by:** acceptance steps 9a–9e; `scripts/test-run-queue.ts` ("single-run abort lands mid-flight", "global kill switch not invoked (consent table untouched)", "run B/C completed untouched").

### S-6. Provider keys: AES-256-GCM at rest, never returned, masked hints only
Keys are encrypted at rest, decrypted only in-process at call time, never
returned by any API response, and never sent to any provider other than the one
they belong to.
- **Enforced by:** `providers/creds.ts` (encryptSecret), `providers` API route (encrypt-on-write, mask-on-read).
- **Tested by:** `scripts/test-arch-invariants.ts` → key hygiene (no prisma select of `apiKey`, app/response layer never stringifies a raw key). Provider matrix panel displays masked hints (live-verified in provider health probes).

### S-7. Audit log: every action writes an attributed row
Every executed action, decision, abort, and undo writes an audit row with
timestamp, action, outcome — and (since the run-queue) the `runId` that produced
it, so N concurrent runs are distinguishable structurally.
- **Enforced by:** `royalRedAudit.create` at every mutating site; `runId` column (additive schema change, DB backup taken first: `db/custom.db.backup-preRR3-20261007-094440`).
- **Tested by:** acceptance steps 6b/8c/9b; `scripts/test-run-queue.ts` ("audit rows exist for all three runIds", "no cross-contamination", "single-run abort writes its own attributed audit row").

### S-8. Tool policy waterfall: monotonic, inspectable, five layers
Every tool call passes global → mode → session → turn → action-consent. Kernel
denies (unknown tools, destructive shell, traversal) are final — no downstream
rule can force-allow them. Every decision names its winning layer, carries the
complete five-layer snapshot, and lands as a durable `policy/decision` event +
audit row. **Documented semantic:** session-layer typed rules are GRANTS (the
`RoyalRedConsentRule` model has no deny verdict); denies live at global/mode/turn;
a grant binds before turn rules (the user outranks the turn).
- **Enforced by:** `src/server/royal-red/policy/waterfall.ts`.
- **Tested by:** `scripts/test-waterfall.ts` (20 checks: global-finality with an allow-all grant present, grant-vs-turn ordering, T3 never batched, full-stack snapshots, audit/event durability); loop-death suite (unknown tool refused gracefully, fail-closed).

### S-9. LLM seam: all model calls behind one door
`seamComplete` / `seamVision` / `seamRouted` are the only model-call interface.
Provider adapters execute only under the seam → router chain; breakers, cost
ledger and fallback live behind the seam.
- **Enforced by:** import discipline (`src/server/royal-red/llm/seam.ts` is the sole consumer surface of the router; the router is the sole consumer of adapters).
- **Tested by:** `scripts/test-arch-invariants.ts` → seam section (`providers/adapters` importable only by llm/router/providers; creds/health/registry additionally only by the key-management API surface; no direct provider-host `fetch()` outside the seam family).

## B. Correctness invariants

### C-1. Session event log: append-only, contiguous, replayable
Events are inserted, never updated or deleted; per-session `seq` is contiguous
with no gaps and no reordering, allocated atomically inside SQLite (concurrent
writers cannot collide); unknown future event types replay as `ignorable`.
- **Enforced by:** `event-log.ts` (raw atomic INSERT with `max(seq)+1`; no mutation API).
- **Tested by:** loop-death suite (loop-death under concurrent logging, 9/9); `scripts/test-run-queue.ts` ("seq contiguous under concurrent writers", one `run/started` + exactly one `run/ended` per run); EVENTS panel integrity badge (live replay projection).

### C-2. Verification receipts: honest score, honest labels, persisted
The honest score is `min(builder, critic)`. With no independent-critic key the
receipt is labeled `SAME-FAMILY FRESH CONTEXT` — never presented as independent
verification. Every receipt persists to the DB and reloads with the session.
- **Enforced by:** `verify/engine.ts` (score math, label), verification persistence.
- **Tested by:** `scripts/test-cedar-leaf.ts` (permanent regression: 7/7 honest, no fabricated disagreement); acceptance flow receipts reload after reconnect.

### C-3. Artifact version history: every write is an immutable row
Every artifact write/merge/chunk/regen snapshots an immutable version row,
monotonically numbered, `(artifactId, version)` unique, no update/delete path.
- **Enforced by:** `versions.ts` (append-only module), DB unique constraint.
- **Tested by:** `scripts/test-artifact-versions.ts` (9 checks: numbering, byte immutability across later writes, DB uniqueness collision, reload, no mutation API in source). *(Gap closed in Round 3 — previously exercised only in live flows; flagged and fixed by the invariants audit.)*

### C-4. Run queue: N runs per session, structurally distinct
Multiple runs may execute concurrently per session through the same Box. The
process table tracks them live; audit rows and event-log rows carry `runId`;
a single-run abort stops exactly one.
- **Enforced by:** `runqueue.ts`, `beginRun`/`finishRun` choke points, executor per-step `isAborted(runId)`.
- **Tested by:** `scripts/test-run-queue.ts` (20 checks: 3 concurrent runs, process table, audit/event attribution, scalpel abort, journal intact, global switch not invoked).

### C-5. Served UI integrity: the stylesheet really styles
The Tailwind catastrophe (postmortem below) proved that every functional suite
can pass while the UI serves unstyled garbage. The served stylesheet must
contain real utilities and theme tokens; every referenced asset class must resolve.
- **Tested by:** `scripts/test-build-integrity.ts` (17 checks: utilities `.flex`/`.bg-red-500`, theme tokens, no unprocessed `@tailwind`/`@apply`/`@import "tailwindcss"` directives, fonts resolve, scripts resolve, icons render, favicon resolves, images resolve); acceptance CSS-load guard (permanent step inside `qa/qa-phase4.sh`).

### C-6. Architecture shape: the structural laws hold in the tree
The invariants above depend on shape (imports, call sites) that behavioral
tests cannot see. The shape itself is asserted.
- **Tested by:** `scripts/test-arch-invariants.ts` (11 checks: seam boundaries, trash-only law, path-prison literals, supervised-process confinement, key hygiene).

## C. Process invariants (how work is done)

- **P-1.** Every round ends with a git commit hash **and** a worklog entry ID. Both are cited in the report; either one alone is not a receipt.
- **P-2.** Every schema change is preceded by a DB backup file under `db/` named with the date and reason. *(Round 3 example: `db/custom.db.backup-preRR3-20261007-094440` before the `RoyalRedAudit.runId` column.)*
- **P-3.** Every competitor port cites source `file:line` and a license verdict (MIT direct-port / pattern-only / clean-room / do-not-touch), recorded in the worklog LICENSE-AUDIT table.
- **P-4.** Every round re-runs the full battery before reporting: kernel units, router suite (incl. 5-switch rotation), soft-spot suites 4/4, acceptance, architecture invariants, build-output integrity, run-queue, waterfall, artifact versions, lint.

## D. Known gaps (stated, not hidden)

1. **Consent timeout duration** — the 120s clock is tested for independence and
   deny-on-expiry semantics (stacking suite) but not for exact wall-clock
   duration (tests would need real 120s waits); expiry math is asserted instead.
2. **Kill-switch 30s refuse window** — exercised by acceptance step 9's real
   abort + sleep(33) reset, not unit-tested in isolation.
3. **Within-layer grant ordering** — first matching user rule wins by creation
   order (tested in `test-waterfall.ts`); users resolving conflicting rules
   must delete the earlier one. The kernel surfaces the winning `ruleId` to
   make this visible.
4. **Run-queue scale** — proven at 3 concurrent runs (the directive's
   contract); no load test at larger N this round.
5. **OSWorld payload dependency** — kernel-unit OSWorld checks degrade to
   honest-skip when the payload (wiped by sandbox resets) is absent; the
   harness itself remains covered.

## E. The Tailwind catastrophe — postmortem record (Round 3)

**What broke:** `postcss.config.mjs` went missing from the working tree; Tailwind
emitted zero utilities; the served stylesheet was fonts-only (~30KB) and the
entire UI rendered unstyled.

**Root cause (git forensics):** the file was last present in the initial scaffold
commit; it re-appears in the tree only at fix `3d542b5` (2026-10-07 09:15:51Z).
The deletion shows up at commit `2eec862` (05:53:42Z) — a full-tree checkpoint
re-add taken immediately after the sandbox checkpoint-restore that also wiped
`.git`. No commit in the recovered history ever removed it. Verdict: the file
was dropped by the same sandbox-reset event class that wiped git history and
`wh-work`, not by any intentional change.

**How many rounds:** **three** — the rebrand round (v1.3 → Royal Red), Round 1
(provider matrix/router/panels), and Round 2 until the fix. Two of those rounds
took agent-browser screenshots as QA and still shipped reports describing styled
UI: visual QA reviewed element presence, not style fidelity.

**Why every test stayed green:** no functional suite asserted that the served
CSS contains actual utilities. This was a QA blind spot, not a Tailwind bug.

**Class-level fix (permanent guards):**
- Acceptance now includes a CSS-load guard step (`qa/qa-phase4.sh`) — fetch the
  served HTML, extract the stylesheet, assert `.flex` and `--primary:`.
- `scripts/test-build-integrity.ts` — the full sibling sweep (stylesheet
  content, unprocessed-directive leak, fonts, scripts, icons, favicon, images).
- **Invariant C-5** records this as a first-class correctness property: any
  future asset-pipeline failure fails loudly, in a suite, not in a screenshot.

---

*Companion documents: `docs/PHASE5-ISOLATION.md` (sub-agent isolation spec —
preparation only, Phase 5 not open), `docs/PHASE5-BUDGET.md` (orchestration
budget policy). Boot sequence: v1.5.*
