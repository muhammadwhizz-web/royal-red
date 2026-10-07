# PHASE 5 BUDGET POLICY — Orchestration Cost & Ceiling Contract

**Status: SPEC ONLY. Phase 5 is NOT open.** This is the sane-default budget
regime the planner/builder/critic team will run under when Phase 5 opens. The
point of writing it now: budgets are a *safety primitive*, not a feature —
they belong in the spec before any sub-agent exists, and every number here is
changeable only with a documented reason.

---

## Defaults (v1)

| Budget | Default | Scope | Hard/soft |
|---|---|---|---|
| Max tokens per run | 200,000 in + 100,000 out | one run (sub-agent or user-initiated), cumulative across its iterations | hard |
| Max wall-clock per run | 15 min (900s) | one run, first byte of run/started to run/ended | hard |
| Max iterations per run | reuse the loop's own caps (14 normal / 22 build) | one run | hard (existing) |
| Max sub-agents per run (width) | 4 live children | per parent run | hard |
| Max spawn depth | 2 (run → sub → sub-sub) | per tree | hard (kernel, waterfall layer) |
| Max concurrent runs per session | 6 | per session, run-queue admission | hard |
| Max session wall-clock with active team | 45 min | all runs of a session | soft (warns at 30) |
| Max cost per run (BYOK metered) | $0.50 default, user-raisable per session | ledger-summed per runId | hard |
| Max cost per session-day | $5.00 default | ledger-summed per session per UTC day | hard |

The planner itself gets the *tightest* token budget of the team (it is mostly
bookkeeping): 50k in / 20k out. Critics get the second-tightest (verification
is bounded by design). Builders get the rest — the work happens there.

## Escalation rules (what happens at a ceiling)

1. **Token ceiling hit mid-run:** the run is NOT killed instantly — the seam
   finishes the in-flight model call, the loop is refused its *next* call with
   a typed `budget/exhausted` event, the run ends `done` with a partial-artifact
   receipt and an explicit "stopped by budget" line in the turn (the same
   degrade-gracefully contract as the malformed-directive path). Partial work
   is saved and versioned. Never silently dropped.
2. **Wall-clock hit:** same as (1), plus the run's pending consent cards are
   *not* auto-approved — they expire on their own 120s clocks (fail-closed).
   A run blocked >2 min on consent counts those minutes against its ceiling
   and its receipt says so (consent waits are user time, and the receipt must
   not blame the model for them — the wait is logged separately).
3. **Width/depth caps:** the spawn is denied at the policy waterfall's global
   layer (kernel cap, unwritable by prompts or grants — see ISOLATION spec Q3).
4. **Cost ceilings:** the seam refuses new *paid* calls; $0/local paths (e.g.
   ollama) remain available so a run can always finish honestly without
   spending. The refusal is a receipt event, never a silent fallback to an
   unvetted provider.
5. **Soft ceiling (session wall-clock):** a `budget/warning` event at 30 min;
   nothing else changes. It is a tripwire for humans, not a limiter.

## Ledger discipline

Every budget decision is a ledger/audit fact, not a side effect:

- tokens in/out per model attempt → cost ledger (exists, runId-attributed)
- ceiling refusals → `budget/exhausted` event + audit row (planned event type,
  merge-extensible add to the event vocabulary)
- cap denials → policy decision at the global layer (already audited as
  `policy.deny`)
- warning trips → `budget/warning` event

A Phase 5 receipt must be reconstructible from the ledger alone: what was
spent, by which run, stopped by what, with what left unspent.

## User control

Budgets are visible and raisable per session in the DESKTOP panel (planned
surface), but **never lowerable below the depth/width kernel caps** by any
agent or prompt — only by the user at the panel, audited like every rule
change. Default regime ships on; "no budget" is not an option, because an
orchestrator without ceilings is an unbounded bill and an unbounded loop.

## Relationship to the honesty doctrine

Budget stops are *honest stops*: the receipt says "stopped by budget, partial
work saved (n versions), $X of $Y spent" — the same shape as the kill-switch
report. An orchestrator that hides why it stopped is a demo; one that prints
its own ceiling on the receipt is a product.
