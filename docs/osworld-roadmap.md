# OSWorld-V2 Release Roadmap — AWON 23.1% → honest ceiling

**Status: v1.1 of the roadmap.** The 352-task bucketing (A: 323 OS-bound / B: 25 evaluator-bound / D: 4 bot-walls) was produced from the payload snapshot `/home/z/wh-work/extracted/OSWorld-V2-main` during the Phase 3 analysis rounds. **That payload was wiped by a sandbox reset (twice)**, so the per-task table below is delivered at bucket-and-blocker granularity from the recorded analysis; row-level IDs regenerate automatically once the payload is re-fetched (one command, see "Regeneration"). The kernel refuses to fake row data — `loadOsworldIndex()` currently returns `available: false` with reason "payload not found (sandbox reset wipes /home/z/wh-work)".

**v1.1 additions:** (1) the clean-room downloader `whget2.mjs` has been rebuilt (worklog Task 21-a, offline self-tests 27/27) and is ready to re-run the moment a fresh one-time wormhole code is provided; (2) the A3 "pilotable today" claim is no longer a claim — **5 representative A3-class tasks have been executed through the real Box kernel with per-task pass/fail receipts** (worklog Task 21, `scripts/test-a3-pilot.ts`, 31/31 checks, Xvfb screenshot receipts in `qa/a3-*.png`); (3) the pilot found and fixed two real planner bugs (nested-mkdir expansion, in-plan mkdir target resolution) — see "A3 pilot" below.

## The 352 tasks at a glance

| Bucket | Count | Blocker class | Fix | Cost (eng-days) | Ships Phase |
|---|---|---|---|---|---|
| **A1** — OS-bound, needs real desktop INPUT | 128 | No input backend: xdotool/xinput absent (no root); click/type primitives fail closed by design | Install xdotool in a privileged image; wire `screen_click`/`screen_type` to the existing consent-gated primitives (zero design change) | 3 | 4.1 (next env) |
| **A2** — OS-bound, needs real desktop APPS | 96 | Xvfb has no window manager, no LibreOffice/GIMP/Thunderbird/VS Code; screenshots of an empty desktop cannot ground tasks | Appliance image: Xvfb + xfce4 + task apps (bytebot recipe, already analyzed in worklog Task 4-d) | 5 | 5 |
| **A3** — OS-bound, FILE-MANAGER class | 71 | Tasks live in a user home tree (Downloads/Documents organization, rename, archive) — **exactly what the AWON Box now does** | Mount the task fixture as the box home; box_plan cleanup + moves already cover ~most of this class today | 2 | ✅ NOW (pilot) |
| **A4** — OS-bound, deep-OS (registry-equiv, drivers, multi-user) | 28 | Linux has no analog for Windows-only settings; some tasks assume a single-user desktop session | Split: Linux-analog rewrites (~17) + honest non-run (~11) | 4 | 5/6 |
| **B** — evaluator reads DOM/app state | 25 | Evaluators parse app-internal state (DOM of a specific app, sqlite of a specific app) that our runner cannot reach | Port evaluators to artifact+box probes; or run the app inside the appliance so the evaluator ships with it | 6 | 5 |
| **D** — bot-walls (CAPTCHA / anti-bot / ToS-adjacent) | 4 | Tasks require defeating anti-bot measures | **Honest non-run, permanently.** Documented, never attempted | 0 | never |

Totals: **A 323 + B 25 + D 4 = 352.** Cost to run the reachable set (A1+A2+A3+B) ≈ **16 eng-days** after an appliance image exists; A3 alone is pilotable **today**.

## Bucket A — subdivided honestly

**真 OS 需求 (genuinely needs a desktop OS):** A1+A2+A4 ≈ 252 tasks. No amount of sandbox plumbing fakes these; they need the appliance image.

**仅因沙箱缺真实桌面 (blocked only by our sandbox, not by the task):** A3's 71 file-manager tasks. The Phase 4 Box (dry-run plans, consent tiers, undo journal) is the product surface for exactly this class.

## What the NEW Phase 4 Xvfb pipeline unlocks — precisely

| Capability | Unlocks | Does NOT unlock |
|---|---|---|
| Xvfb lifecycle + x11grab screenshots (real pixels, supervised) | Grounding reads for A2 apps **once apps exist** in the display; screen-state verification receipts | Input — there is no input backend here; `screen_click`/`screen_type` fail closed honestly |
| Heuristic segmentation w/ confidence (labeled as heuristic) | Region proposals for A2 grounding; regression screenshots for the VERIFY tab | Semantic labels — it is a variance heuristic, not a model |
| The Box (path prison + dry-run + journal + tiers) | **A3 file-manager class today** (71 tasks) | Anything outside the emulated home; host FS is not mounted |
| 13 consent-gated primitives | The permission UX that makes A-class runs auditable and undoable | Bulk input tasks until an input backend ships |

## Regeneration (row-level table)

When the payload is restored to `/home/z/wh-work/extracted/OSWorld-V2-main`:

```
bun --env-file=.env -e "import {loadOsworldIndex, formatOsworldReport} from './src/server/awon/osworld/harness'; const i = loadOsworldIndex(); console.log(formatOsworldReport(i, []))"
```

The harness re-indexes every example JSON (`Task ID | App | Category | Evaluator type`), and the buckets re-map mechanically: evaluator-type `dom`/`app-state` → B, task-content `captcha`/`anti-bot` → D, rest → A split by the table above. Estimated effort to regenerate the 352-row sheet: < 1 hour, fully scripted.

## A3 pilot — 5 tasks actually executed (v1.1)

**Provenance (plain):** the canonical OSWorld rows are payload-absent, so these are
A3-CLASS pilots defined from the recorded bucket definition ("tasks that live in a user
home tree: Downloads/Documents organization, rename, archive") — representative, NOT
canonical OSWorld task IDs. Every task ran through the REAL kernel path:
`planOperations → consent gate → executePlan → write-ahead journal`, with Tier 3
per-action consents answered programmatically (the same gate the UI answers), plus an
Xvfb screenshot receipt per task.

| Pilot | A3-class task | Result | Receipt |
|---|---|---|---|
| P1 | `clean_downloads` — classify ~/Downloads, trash junk/installers (T3 per-action), file documents/images/archives | **PASS** (10/10 checks; 3 T3 dialogs, journal 6/6, junk in `.awon-trash/<runId>`) | `qa/a3-p1-clean-downloads.png` |
| P2 | `organize_by_type` — create nested folder tree + sort png/pdf/zip/txt by type | **PASS** (8/8; 6/6 steps incl. both expanded mkdirs) | `qa/a3-p2-organize-by-type.png` |
| P3 | `archive_old_reports` — create archive dir + move 4 reports into it | **PASS** (5/5; journal 5/5, source dir empty) | `qa/a3-p3-archive-old-reports.png` |
| P4 | `normalize_filenames` — rename space/uppercase names to kebab-case (move-in-place) | **PASS** (4/4; exact rename targets on the card) | `qa/a3-p4-normalize-filenames.png` |
| P5 | `make_space` — trash installers/partial downloads (T3 ×3), keep-set untouched, trash-stats growth verified | **PASS** (7/7; 3 T3 dialogs, trash-only, never rm) | `qa/a3-p5-make-space.png` |

**Suite:** `bun scripts/test-a3-pilot.ts` — 31 passed, 0 failed, idempotent across re-runs.

**Real kernel bugs the pilot caught and fixed** (this is why "actually run them" matters):
1. `src/server/awon/box/dryrun.ts` — the planner proposed `mkdir ~/a/b` when `~/a` did
   not exist; the executor's non-recursive mkdir then failed with ENOENT. The plan card
   promised something execution could not do — a dry-run-is-the-product violation.
   Fix: the planner expands nested mkdirs into explicit ancestor mkdir steps, so the
   card shows exactly what will run (executor unchanged, still non-recursive).
2. `src/server/awon/box/dryrun.ts` — moves into a directory that an EARLIER step of the
   same plan creates were resolved as literal file paths, producing in-plan collisions
   (3 of 4 moves refused) or wrong final paths. Fix: the planner tracks in-plan mkdir
   targets (`plannedDirs`) and resolves later move/copy targets into them as
   dir/basename — the card now shows the true final path.

**What the pilot proves:** the Box covers the A3 file-manager task *shape* end to end
today — planning, per-action consent, journaled execution, trash-only deletion. What it
does NOT prove: parity with the canonical 71 OSWorld A3 rows (payload required) and any
task needing an input backend (A1) or real desktop apps (A2) — those blockers are
unchanged and listed above.
