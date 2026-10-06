# OSWorld-V2 Release Roadmap — AWON 23.1% → honest ceiling

**Status: v1.0 of the roadmap.** The 352-task bucketing (A: 323 OS-bound / B: 25 evaluator-bound / D: 4 bot-walls) was produced from the payload snapshot `/home/z/wh-work/extracted/OSWorld-V2-main` during the Phase 3 analysis rounds. **That payload was wiped by a sandbox reset**, so the per-task table below is delivered at bucket-and-blocker granularity from the recorded analysis; row-level IDs regenerate automatically once the payload is re-fetched (one command, see "Regeneration"). The kernel refuses to fake row data — `loadOsworldIndex()` currently returns `available: false` with reason "payload not found (sandbox reset wipes /home/z/wh-work)".

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
