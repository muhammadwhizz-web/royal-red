# AWON Security Postmortem — the four Phase 3 soft-spot bugs + sibling sweeps

Task ID 21-c · security-review agent · Phase "trust rebuild", Section 4.
Scope: postmortem for bugs (a)–(d) found by the soft-spot regressions (worklog 20.4),
plus a sibling-pattern sweep for the deny-as-approve class (a) and the
zombie-loop class (d). All file:line citations were read from the CURRENT fixed
tree. No code was changed by this review except where explicitly stated (none
was needed: both real sibling bugs live in files owned by another agent).

---

## Section 1 — Postmortem (one paragraph per bug)

### (a) deny-resolves-as-approved — a DENY executed the action anyway

**Failure mode.** `decideConsent()` computed the correct `status` string from the
user's answer, but then resolved the in-process waiter that the paused agent
turn is blocked on with a HARDCODED `'approved'` status, so the executor's
`status === 'approved'` gate passed regardless of what the human clicked. The
fix now resolves the waiter with the ACTUAL outcome — `consent.ts:218-228`
(the waiter call at `consent.ts:220-228` carries `status: (status as 'approved' | 'denied')`,
with the guard comment at `consent.ts:222-224`), where `status` itself defaults
to `'denied'` and only becomes `'approved'` on explicit approve/modify/valid-rule
answers (`consent.ts:178-189`).

**Production impact.** Consent becomes theater: a user pressing DENY on a Tier 3
card — trash this file, run this shell command — would have watched the action
execute anyway, with the UI reporting "denied" while the kernel proceeded. The
worst case is the exact scenario the tier model exists to prevent: a destructive
or shell command runs against the box after an explicit refusal. Every deny in
every session, on every tier, was silently converted into an approval.

**Test that caught it.** `scripts/test-phase4-stacking.ts` — the consent-stacking
regression: check `'T1a (queue #1) can still be DENIED'` (`test-phase4-stacking.ts:49`)
followed by `'T1a waiter resolved denied'` asserting `r1.status === 'denied'`
(`test-phase4-stacking.ts:51`). Against the old code the waiter returned
`'approved'` and the second check failed.

**What the fix guarantees.** The waiter resolution and the durable DB row can no
longer disagree: the promise the executor awaits resolves with exactly the status
persisted at `consent.ts:191-200`. Combined with the consumption-side discipline
that only the EXACT string `'approved'` executes — all nine consumers gate on
`!== 'approved'` (`primitives.ts:65, 94, 274, 383`; `ops.ts:178, 292, 399`) —
any non-approve outcome (`denied`, `expired`, `frozen`) is a skip, an audit row
(`ok:false`), and an honest tool summary naming the status.

### (b) FIFO race — concurrent requestConsent calls created rows out of order

**Failure mode.** `requestConsent()` is called concurrently (a T1 read batch and
a T3 per-action request stack in the same turn). Each call performed its own
`db.awonConsent.create` with a server-generated `createdAt`; two concurrent
INSERTs race and the DB timestamps do not reliably reflect CALL order, so the
queue — which is FIFO by `createdAt` — could render in an undefined order. The
fix serializes row creation per session through a creation chain:
`consent.ts:55-65` (`creationChains` map + `enqueueCreation()`, which chains
`prev.then(fn, fn)` so each create waits for the previous one and a failed
create cannot poison the chain), used at the create site `consent.ts:91-105`.

**Production impact.** The desktop panel's consent queue is the user's mental
model of "what is the machine waiting on, in what order". Out-of-order cards
mean the user can approve card #3 believing it is #1; the tier badges and
positions stop meaning anything under load; and the consent-stacking acceptance
behavior ("T3 is answerable while the T1s wait") became timing-dependent. It
also made the regression suite flaky, which is how it surfaced.

**Test that caught it.** `scripts/test-phase4-stacking.ts` — three concurrent
`requestConsent` calls (2×T1 + 1×T3, `test-phase4-stacking.ts:24-26`) followed by
checks `'all three stack as pending'` (`:32`) and
`'queue is FIFO (T1a, T1b, T3c)'` asserting the DB rows come back in call order
(`:33`).

**What the fix guarantees.** Row creation is strictly serialized per session, so
`createdAt` order === call order and the FIFO queue is deterministic no matter
how many requests stack. The chain cannot deadlock (it never awaits the waiter
promise, only the row INSERT) and one failing create cannot wedge later ones
(`consent.ts:63` swallows the chain error for subsequent callers).

### (c) in-memory-only expiry — the 120s fail-closed clock was not durable

**Failure mode.** The 120-second fail-closed deadline existed ONLY as an
in-process `setTimeout` (`consent.ts:136-142`); the DB row's `expiresAt` column
was written but never enforced by the waiting side. The waiter map is
single-process state: after a dev-server hot reload (or in any future
multi-process deployment) the map is orphaned — pending consent rows sit in the
DB forever and the paused turn's promise never settles, so the agent turn hangs
indefinitely holding the queue. Conversely, an answer written by another process
was invisible to the orphaned waiter. The fix adds a DB poll-back as the durable
source of truth: `consent.ts:143-164` — a 2-second `setInterval` that re-reads
the row (`:151`), enforces the row's OWN `expiresAt` by expiring stale pending
rows (`:153-158`), and resolves the waiter from the persisted status for any
non-pending state (`:160-162`).

**Production impact.** With real users: anyone touching the dev server (or
running more than one app process) while a consent card was open could freeze
the agent turn permanently — the turn is paused mid-`await`, the user's answer
never lands, the only recovery is a restart, and the frozen card is stuck in
every panel reload. The fail-closed guarantee silently degraded to fail-hang,
which is worse than fail-open in user trust terms because nothing tells you it
happened.

**Test that caught it.** `scripts/test-phase4-stacking.ts` — the test shrinks
`expiresAt` DIRECTLY in the database (`test-phase4-stacking.ts:61, 65`), which
the in-memory timer knows nothing about; only the DB poll-back can resolve these
waiters. Checks: `'head expired fail-closed'` (`:67`) and
`'request behind the head kept its OWN clock (resolved independently, not frozen
by the head)'` (`:69`).

**What the fix guarantees.** Expiry is durable: every pending request settles
within ≤2s of its own deadline regardless of process restarts, and the settle
outcome is `'expired'` → treated as deny everywhere (fail-closed). Each request
still owns its clock — one expiry never auto-decides the requests stacked behind
it (`consent.ts:17-20` documents the invariant; `:69` proves it).

### (d) zombie loop — client disconnect did not stop the agent turn

**Failure mode.** When the client disconnected mid-turn (Stop button, tab close,
`reader.cancel()`), the server-side agent loop kept iterating: `req.signal` does
not fire reliably for cancelled streams in every runtime, so nothing bridged the
disconnect into `runAwonTurn`. The fix is an explicit abort bridge in
`src/app/api/awon/chat/route.ts:44-53`: the turn runs on its OWN
`AbortController` (`turnAbort`, `:48`) whose `abort()` is triggered by BOTH
`req.signal` (`:52-53`, also handling an already-aborted request) AND the
ReadableStream's `cancel()` path (`:91-94`). The signal is handed to the turn at
`:71` (`runAwonTurn({ ..., signal: turnAbort.signal })`), and the loop honors it
at every checkpoint in `src/server/awon/agent.ts` — top of iteration `:183`,
model-error path `:190`, post-model `:194`, before/after each tool `:428, :432`,
post-tool-results `:503`, regeneration loop `:566` and re-check `:636`; the
post-turn title generation is skipped when aborted (`route.ts:74`).

**Production impact.** A user hitting Stop did not stop anything: the loop kept
burning model calls for up to the full build budget (22 iterations), writing
assistant rows and artifacts the user believed were cancelled, costing tokens on
every iteration, and — on the deployed runtime — holding the function until
`maxDuration` (300s). Multiple abandoned turns could compound. This is a direct
money and trust leak: the UI says stopped, the meter keeps running.

**Test that caught it.** `scripts/test-phase4-loopdeath.ts` loop 4 — it opens a
real SSE turn, waits until an assistant row exists, then `reader.cancel()`
(`test-phase4-loopdeath.ts:78`) and asserts the message count STABILIZES:
`'turn stopped after the client disconnect (row count stabilized, no zombie
loop)'` (`:93`) and `'the turn did not burn its full iteration budget after the
drop'` (`:94`, final rows ≤ 4 where a zombie build turn writes 14+).

**What the fix guarantees.** Every disconnect path (`req.signal` abort, stream
cancel, both) lands on the same controller within one in-flight iteration: the
current SDK call is allowed to finish, then the loop exits and persists the
partial work with the honest marker `'(stopped by user mid-turn; partial work is
saved)'` (`agent.ts:462`). No zombie iterations, no silent token burn, and the
verification pipeline receipts still persist even when the SSE pipe is gone
(`agent.ts:530-536`).

---

## Section 2 — Sibling-pattern sweep for (a): computed-once authorization values & silent defaults

Rules applied to every hit (from the directive):
1. a default that resolves a pending action to anything-executable is a bug;
2. timeouts must fail closed (denied/expired, never approved);
3. cached/persisted decisions must carry the exact scope they were made for.

Greps run over `src/server/awon/**` and `src/app/api/**`:
`'approved'`/`"approved"`, `?? 'approved'`, `|| 'approved'`, `default.*approv`
(case-insensitive), `decision`, `status: '`, `findMatchingRule`, `ruleMatches`,
`authorize`, `consent`. Result: **24 distinct hit sites across 8 files; 21 SAFE,
1 safe-with-note, 2 REAL sibling bugs (both in read-only files → documented,
fix deferred to orchestrator). Zero hits for `?? 'approved'` / `|| 'approved'` /
`default.*approv` anywhere in src/.**

### REAL SIBLING BUGS (finding, fix deferred to orchestrator — consent.ts is read-only for 21-c)

**SIBLING #1 — `extractRuleScope` defaults an unknown-op typed rule to `box_trash`, the most destructive primitive.**
`src/server/awon/box/consent.ts:238`: `const op = ops.find((o) => t.includes(o)) ?? 'box_trash'`.
Repro reasoning: the shell_exec card instructs the user to type
`always allow shell_exec: <cmd>` (`primitives.ts:378`). Suppose the user instead
types a rule that names NO listed op token — e.g. `always allow git push for *`.
The op list (`consent.ts:237`: box_trash, trash, shell_exec, screen_click,
screen_type, box_move, box_write, box_copy, delete) contains none of those
words… except common ones like "for"/"push" are not ops, so `find` misses and
the rule is silently stored with `op: 'box_trash'`. The pattern extractor
(`consent.ts:240-241`) then takes the text after `for` → `*`, producing a LIVE,
ENABLED, PERMANENT rule that auto-approves EVERY `box_trash` candidate: both
rule-check call sites skip the dialog entirely on a rule match
(`primitives.ts:336-344`, `ops.ts:279-301`). The user consented to a git-push
rule; the system granted a trash-everything rule. This is exactly rule 1
violated: a default silently widens an authorization grant to an executable,
destructive scope. **Minimal patch (orchestrator):** default the op to a
never-matching value (e.g. `''`) so `findMatchingRule`'s
`where: { op, enabled: true }` (`consent.ts:252`) can never return it, or refuse
to persist the rule (return the deny path) unless the typed text names a known
op. One-line change in `consent.ts:238`; no call-site changes.

**SIBLING #2 — typed consent rules leak across sessions: `findMatchingRule` ignores the rule's `sessionId`.**
`src/server/awon/box/consent.ts:251-254`:
`db.awonConsentRule.findMany({ where: { op, enabled: true } })`. The
`AwonConsentRule` table HAS a `sessionId` column (`prisma/schema.prisma:184-194`,
`String?`, written at `consent.ts:205-212`), but the lookup never filters by it —
and the column is indexed on `[op, enabled]` only. A verbatim typed rule granted
in session A ("always allow shell_exec: python3 backup.py") permanently
auto-approves the matching destructive action in EVERY other session, forever.
That violates rule 3: a cached decision must carry the exact scope it was made
for. **Minimal patch (orchestrator):** add a `sessionId` parameter to
`findMatchingRule(op, candidatePath, sessionId)` and filter
`where: { op, enabled: true, sessionId }`; the three call sites
(`primitives.ts:336`, `primitives.ts:371`, `ops.ts:279`) all already hold
`ctx.sessionId` / `sessionId` in scope, so the change is mechanical — but it
touches three read-only files and the hot consent path, and global-vs-scoped
rules is a product decision (if GLOBAL rules are intended, the `sessionId`
column should be dropped and the behavior documented instead). Deliberately NOT
patched from this agent.

### SAFE hits (checked, with reason)

| Location | What it is | Verdict |
|---|---|---|
| `consent.ts:178` | `decideConsent` initializes `status = 'denied'` | SAFE — the default is the fail-closed direction; only explicit approve/modify/valid-rule flips it (`:179-189`) |
| `consent.ts:184-187` | rule answer without typed text (≥8 chars) | SAFE — stored as `denied`, returns `ok:false`; fail-closed |
| `consent.ts:172-176` | non-pending row / expired deadline at answer time | SAFE — late answers recorded as a no, `ok:false`; timeout never approves |
| `consent.ts:87, 108-111` | abort check before row creation + re-check after insert | SAFE — closes the kill-switch race; `frozen` is non-executable |
| `consent.ts:136-142, 148-164` | timeout timer + DB poll-back | SAFE — both resolve `expired` (= deny); this IS fix (c) |
| `consent.ts:246-249` | `ruleMatches` glob regex | SAFE-WITH-NOTE — case-insensitive (`'i'`) and `*` spans mount boundaries, so a typed rule matches slightly MORE paths than typed; widening-only, sourced from verbatim human input, and audit-logged on every match (`primitives.ts:342`). Hardening candidate, not a flip-to-approved default |
| `primitives.ts:65, 94, 274, 383` | every consent consumer gate | SAFE — exact-match `!== 'approved'` discipline; `expired`/`frozen`/`denied` all skip |
| `primitives.ts:336-344, 371-387` | typed-rule bypass of T3 dialogs | SAFE as a mechanism — the ONLY permanent path is verbatim typed text (`consent.ts:14-15`), every match audit-logged; the scope defects are SIBLING #1/#2 above |
| `ops.ts:178-181, 292-297, 399` | undo / trash-per-step / single-trash gates | SAFE — same exact-match gate; denial paths write `ok:false` audit rows |
| `ops.ts:155-184` | panel-initiated undo skips the card (`userInitiated: true`) | SAFE-BY-DESIGN — "the click IS the consent", documented at `ops.ts:155-157`, audited (`:183`); the endpoint (`src/app/api/awon/desktop/undo/route.ts:12`) is a deliberate local-trust surface like the kill switch (`abort/route.ts:5-6`) |
| `src/app/api/awon/desktop/consent/[id]/route.ts:12-14` | decision whitelist | SAFE — rejects anything outside `approve|deny|modify|rule` with 400; no default pass-through |
| `consent.ts:179-180` + `primitives.ts:108-127` | `modify` → `approved` without requiring `modifiedPayload` | SAFE-WITH-NOTE (finding, low severity) — a modify answer whose card fails to attach an edited plan (`modified?.plan?.steps` falsy) runs the ORIGINAL plan; hash discipline still binds execution to the exact card content (`ops.ts:256-260` refuses on mismatch), so the blast radius is "user intent to edit degrades to approve of what was shown", not "unreviewed content executes". Suggested hardening: require `modifiedPayload` when decision === 'modify' in `decideConsent` (read-only file; deferred) |
| `src/components/awon/store.ts:805` | optimistic UI flip `deny→'denied' else 'approved'` | SAFE — UI display only; the kernel's refusal reverts the card with the real status (`store.ts:814-817`); server state is authoritative |
| `src/lib/awon/types.ts:138` | status union type | SAFE — type-level only |
| `src/app/api/awon/chat/route.ts:17` | mode fallback `?? 'ask'` | SAFE — defaults to the least-privileged mode |
| `src/app/api/awon/desktop/state/route.ts:20` | queue listing filters `status: 'pending'` | SAFE — read-only projection |
| `src/server/awon/verify/critic.ts:206-216, 238-248` | critic failure → `unverified`, score 0 | SAFE — the verify pipeline's own "authorization" (score resolution) fails closed: `unverified` never counts as pass, `honestScore = min(builder, critic)` (`engine.ts:124-129`), kernel verdicts beat critic verdicts in the merge (`critic.ts:268`) |

---

## Section 3 — Sibling sweep for (d): long-running operations and cancel/abort bridges

Greps over `src/server/awon/**` and `src/app/api/**`: `spawn`, `exec`,
`execFile`, `ffmpeg`, `ffprobe`, `fetch(`, `ReadableStream`, `new Response(`,
`setInterval`, `setTimeout(`, `while`. 20 long-running sites audited.
**Verdict: 15 safe, 2 safe-with-note, 3 gap-classes documented (all one root
cause: the z-ai SDK calls accept no AbortSignal); ZERO fixes required in owned
files — every raw `fetch(` in the tree already carries a signal.**

### The chat-route bridge, verified (the (d) fix)

`src/app/api/awon/chat/route.ts`: one `AbortController` per turn (`:48`); armed
from `req.signal` (`:52-53`, including the already-aborted case) and from the
stream's `cancel()` (`:91-94`), covering stop-button, tab-close and
`reader.cancel()` alike; `if (!turnAbort.signal.aborted)` makes re-abort a
no-op (`:49-51`). The signal flows into `runAwonTurn` (`:71`) whose loop checks
it at 9 checkpoints (`agent.ts:183, 190, 194, 428, 432, 503, 566, 636` + title
skip `route.ts:74`). In-flight model calls are allowed to land (no mid-write
tear-down), then the loop exits and persists the honest stopped-marker
(`agent.ts:462`). Proven by `test-phase4-loopdeath.ts:78-94`.

### Inventory

| # | Site | Timeout/abort? | Client disconnect leaves it running? | Verdict |
|---|---|---|---|---|
| 1 | chat SSE turn loop (`chat/route.ts:44-94`, `agent.ts` loop) | yes — the bridge above; `maxDuration = 300` (`route.ts:6`) | no — bridge aborts within one iteration | **SAFE (verified)** |
| 2 | `agent.ts:61-71` `callLlm` (z-ai SDK) | **NO** — SDK exposes no signal | yes — a hung call blocks the iteration until the platform cap | **GAP (documented)** — hot path; wrapping in a `Promise.race` timeout would change hot-path failure semantics (a slow-but-legit call would fail the turn), so per the directive it is left untouched. Mitigations today: `MAX_ITERATIONS` (14/22), route `maxDuration`, and the loop's `stopped()` checks. Recommended: raise with the orchestrator to add a generous (≥120s) race-timeout mirroring `ledger.ts:82-96` |
| 3 | `agent.ts:83-106` `generateSessionTitle` (same SDK) | no (same class as #2) | only after `done`, wrapped in try/catch → `null` (`:103-105`) | **GAP (documented, same root cause)** — cosmetic-only failure mode |
| 4 | `tools.ts:29-86` `runShell` (`pexec`) | yes — `timeout: 15_000`, `maxBuffer` 512KB (`:65-69`) | bounded | SAFE |
| 5 | `tools.ts:109-143` `systemReport` (`pexec` ×4) | yes — 8s each (`:113`) | bounded | SAFE |
| 6 | `tools.ts` SDK calls: `runSearch` (`:88-107`), `readPage` (`:283-331`), `generateImage` (`:148-214`), `analyzeImage` (`:217-279`) | no (SDK class) | bounded by SDK internals; each tool returns an honest `ok:false` on error | **GAP (documented, same root cause as #2)** |
| 7 | `tools.ts:338-472` `analyze_video` | yes — download `fetch(..., { signal: AbortSignal.timeout(60_000) })` (`:379`), 48MB remote / 64MB local caps (`:362-384`), ffprobe 15s (`:392`), scene-detect ffmpeg 45s (`:403`), frame ffmpeg 20s each (`:437`), tmpdir cleaned in `finally` (`:469-471`) | bounded; worst case (24 frames × 20s) exceeds the 300s route cap only for pathological videos — theoretical, noted | SAFE |
| 8 | `verify/critic.ts:66-124` `providerChat` | yes — `AbortController` + `setTimeout(() => controller.abort(), timeoutMs)` (`:74-75`), signal wired to BOTH fetches (`:80, :102`), `clearTimeout` in `finally` (`:121-123`) | bounded at 60s | **SAFE (test-proven)** — `test-phase4-loopdeath.ts:40-58` points it at a black-hole address and asserts the honest `unverified` receipt in <70s |
| 9 | `verify/ledger.ts:82-96` `callLlmJson` | partial — `Promise.race` timeout (45s default, 75s for the critic) bounds the RESPONSE, but the underlying SDK promise is not aborted and the race timer is never cleared | bounded response time; socket may linger | SAFE-WITH-NOTE — acceptable (a timeout with an abandoned socket, not an unbounded wait); hygiene fix (clear the timer) is optional |
| 10 | `verify/browser.ts:48-62` `ab()` — every `agent-browser` command | yes — `execFile` timeout 30s default / 45s a11y / 8s close (`:13, :53, :120, :140, :152`), fresh session per run, `close()` in `finally` (`:155-159`) | bounded | SAFE |
| 11 | `verify/engine.ts:246-273` VLM screenshot-note call (SDK) | no (SDK class) | wrapped in try/catch; receipts persist regardless (`engine.ts:63-78`) | **GAP (documented, same root cause)** |
| 12 | `verify/benchmark.ts:186-195` competitor audits | yes — bounded to 10 audits in `Promise.all`, each under browser timeouts (`:188-190` comment + #10) | bounded | SAFE |
| 13 | `box/box.ts:65-133` `boxExec` (shell_exec) | yes — 15s `SIGTERM` timer (`:112-117`), whitelist (`:20-23`), tokenized shell-less argv (`:30-54`), registered in the process table (`:108`) | bounded | SAFE-WITH-NOTE — SIGTERM with no SIGKILL escalation (`:115`); a SIGTERM-immune child would linger but stays table-registered and kill-switch-reapable (`runtime.ts:104-115`). Read-only file; noted for the orchestrator |
| 14 | `box/screen.ts:67-83, 101-107` ffmpeg x11grab + decode | yes — 15s `execFile` timeout on both (`:76, :104`) | bounded | SAFE |
| 15 | `box/screen.ts:39-58` Xvfb (`spawnSupervised`) | intentionally NO timeout — long-lived virtual display | yes, by design | SAFE-BY-DESIGN — registered in the process table (`box.ts:137-141`), reaped by the kill switch (`ops.ts:31-46`), leak-proven by `test-phase4-leak.ts` |
| 16 | `box/consent.ts:136-164` waiter timer + poller | yes — both cleared on settle (`:129-130`) | n/a | SAFE |
| 17 | `ops.ts:42-44` global-abort one-shot reset | yes — 30s `setTimeout` | n/a | SAFE |
| 18 | `api/awon/pc/route.ts:30` diagnostics `execFile` | yes — 8s timeout, 128KB buffer, id-whitelist (`:10-17, :25-28`) | bounded | SAFE |
| 19 | export/zip/pdf/preview/download routes (`session/[id]/export`, `workspace/zip` 128MB cap `:7`, `artifact-download/[id]`, `preview/[id]/[...path]`, `artifact-file/[id]`, `verify-shot` regex-jailed `:9-20`, `workspace/file` 64MB/512KB caps `:57, :95`) | bounded sync in-memory builds + capped file reads; no loops/streams that outlive the request | no — response is a single buffer; disconnect discards it | SAFE |
| 20 | `api/awon/verify` POST (`runVerification` full pipeline) | yes — `maxDuration = 300` (`route.ts:6`) + every internal step bounded (ledger race-timeout, critic 60s, browser 30s/cmd) | a disconnect leaves the receipts pipeline finishing — INTENTIONAL: receipts persist for reload (`agent.ts:530-536`) | SAFE (documented behavior) |

### Fixes applied in this sweep

**None.** Justification: the only raw `fetch(` calls in the tree already carry
abort signals (`tools.ts:379`, `critic.ts:80/102`); every `execFile`/`spawn` has
a timeout or is a supervised-by-design server process; and the remaining gap
(z-ai SDK calls, sites #2/#3/#6/#11) cannot take an `AbortSignal` without a
wrapper that would change hot-path failure semantics — exactly the case the
directive says to document rather than touch.

---

## Section 4 — Verdict table

| Sweep area | Findings | Action taken |
|---|---|---|
| (a) fix site: `consent.ts:218-228` waiter resolution | correct — resolves actual outcome; deny default at `:178` | verified, safe |
| (b) fix site: `consent.ts:55-65, 91` creation chain | correct — per-session serialization, poison-proof (`:63`) | verified, safe |
| (c) fix site: `consent.ts:143-164` DB poll-back | correct — durable `expiresAt` enforcement (`:153-158`), resolves from row state (`:160-162`) | verified, safe |
| (d) fix site: `chat/route.ts:44-53, 71, 91-94` + `agent.ts` checkpoints | correct — dual-source bridge, 9 loop checkpoints, honest stopped-marker | verified, safe |
| Consent consumers (`primitives.ts` ×4, `ops.ts` ×3 gates) | all exact-match `!== 'approved'` | checked, safe |
| Default-value grep (`?? 'approved'`, `\|\| 'approved'`, `default.*approv`) | 0 hits in src/ | checked, safe |
| `decideConsent` modify path (`consent.ts:180` + `primitives.ts:108-127`) | modify-without-payload degrades to approve of the shown plan; hash discipline contains blast radius | **documented for orchestrator** (low sev; both files read-only for 21-c) |
| `extractRuleScope` unknown-op default (`consent.ts:238`) | **SIBLING BUG** — unknown-op typed rule becomes a live `box_trash` rule (`op ?? 'box_trash'`) | **documented for orchestrator** — 1-line fail-closed patch specified (consent.ts read-only for 21-c) |
| `findMatchingRule` scope (`consent.ts:251-254` + `schema.prisma:184-194`) | **SIBLING BUG** — typed rules ignore `sessionId`; grants leak across all sessions | **documented for orchestrator** — patch specified; needs product call on scoped-vs-global rules |
| `ruleMatches` case-insensitivity / wildcard span (`consent.ts:246-249`) | widening-only, input is verbatim human text, audited | safe-with-note (hardening candidate) |
| Panel-initiated undo bypass (`ops.ts:155-184`, `desktop/undo/route.ts`) | click-is-consent, audited, documented design | safe-by-design |
| Optimistic UI consent flip (`store.ts:805`) | UI-only, reverts on kernel refusal | safe (component, read-only for 21-c) |
| Verify-pipeline score resolution (`critic.ts`, `engine.ts`) | fails closed: `unverified` ≠ pass, honest = min, kernel wins merge | checked, safe |
| SDK model calls (`agent.ts:61-71, 83-106`; `tools.ts` ×4 tools; `engine.ts:246-273`) | no timeout/abort possible via SDK API | **documented for orchestrator** (hot-path; wrapper specified as `ledger.ts:82-96` pattern) |
| `analyze_video` download + ffmpeg chain (`tools.ts:338-472`) | 60s download signal, 48/64MB caps, 15/45/20s exec timeouts, tmp cleanup | checked, safe |
| `verify/critic.ts` provider calls | 60s AbortController wired to both fetches; test-proven | checked, safe |
| `verify/ledger.ts` `callLlmJson` race timeout | bounds response; SDK promise not aborted; timer uncleared | safe-with-note (hygiene) |
| `verify/browser.ts` + `benchmark.ts` | 30s/cmd hard timeouts; 10-audit bound | checked, safe |
| `box/box.ts` `boxExec` | 15s SIGTERM, whitelist, shell-less argv, process table | safe-with-note (no SIGKILL escalation) |
| `box/screen.ts` ffmpeg + Xvfb | 15s exec timeouts; Xvfb supervised-by-design | checked, safe |
| Diagnostics + export/zip/pdf/preview/download routes | whitelists, caps, bounded sync builds, regex-jailed paths | checked, safe (8 routes) |
| Tests (`test-phase4*.ts`, `test-cedar-leaf.ts`, `qa-phase4.sh`) | no fix changed behavior or assertions | untouched |

**Bottom line:** 4/4 postmortem fixes verified against the current tree with
test provenance; sweep (a): 24 hit sites → 2 real sibling bugs (both in
`consent.ts`, read-only — precisely specified for the orchestrator), 1 low-sev
hardening note, the rest safe with reasons; sweep (d): 20 long-running sites →
0 code gaps in owned files, 1 documented gap-class (SDK calls) + 2 hygiene
notes. Zero code changes, zero test changes, zero new dependencies.

## Bug (e) — added after the Task 21 acceptance re-run (sibling of (c), same class: state that must be durable but lived only in memory)

**Failure mode.** The kill switch's abort flags (abort-state.ts) were module-level
in-memory state. Next.js compiles each route as its own module graph, so the chat
route's executor and the desktop abort route hold *different copies* of those flags (a
dev hot-reload splits them further). A kill-switch click therefore marked the run
aborted in the DB but never in the copy of abort-state that the running executor and its
pending consent waiters consulted. In the re-run acceptance test this produced exactly
the failure the directive fears: a Tier 3 consent created seconds *after* the abort sat
`pending` for its full 120s clock while the executor waited on it — the kill switch
stopped the queue but not the waiting.

**Production impact.** After ABORT, a user could see a live actionable consent card for
a run that was already killed; approving it would execute one more action after the
switch was thrown. Trust-critical: the kill switch is the product's emergency stop.

**What caught it.** The directive's own gate — "Acceptance test 19/19 still green
(re-run)" — step 9c/9d (frozen cards=0, queue=1). The bug was latent at Phase 4 ship;
the re-run surfaced it. This is why the re-run exists.

**The fix (DB is the source of truth, mirroring fix (c)'s discipline).**
`src/server/awon/box/abort-state.ts` gained `runIsAbortedInDb()` and
`recentAbortForSessionInDb()`. Every safety checkpoint is now DB-backed:
`requestConsent` pre-insert + post-insert + its 2s DB poll-back freeze on the run row's
`aborted` status (consent.ts), the executor loop checks the run row every step (ops.ts),
and the box-primitive refuse window in the tools dispatch also checks for a
session-aborted run in the last 30s (tools.ts). A consent created before, during, or
after an abort now freezes regardless of which module graph issued the abort.

**Guarantee.** Regression `scripts/test-phase4.ts` "durable abort (cross-module-graph)"
section (6 checks): a DB-only abort with zero in-memory flags freezes a pending consent
via poll-back, refuses new consents pre-insert, leaves zero pending rows, and is visible
to the session refuse window. Units now 53/53; acceptance re-run 19/19.
