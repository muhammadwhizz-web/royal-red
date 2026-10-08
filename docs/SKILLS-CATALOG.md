# ROYAL RED SKILLS CATALOG — v1.0

The contract this document satisfies: **"write skills for each task — which
products and which services — so Royal Red is ready to deliver."**
Every skill listed here is REAL (wired to kernel code) unless marked
`[PLANNED]`. A skill without an executor and a verification gate does not
enter this catalog — that rule is inherited from docs/INVARIANTS.md.

---

## A. MODE SKILLS (the four ways the console executes)

| Skill | Mode | What it does | Executor | Verification |
|---|---|---|---|---|
| **Build** | `build` | Websites, HTML apps, landing pages, multi-section products — planned, built, graded to 10/10 | agent loop → verification 2.0 | constraint ledger + adversarial critic + visual regression |
| **Research** | `research` | Live web search + page reader → sourced briefings | tool bus (search/fetch) | per-claim source citations |
| **System** | `pc` | Accounts, diagnostics, workspace ops, sandbox introspection | box ops + policy waterfall | dry-run-first, consent tiers |
| **Assist** | `ask` | General reasoning, explanation, drafting | LLM seam | honest-reply contract |

## B. ORCHESTRATION SKILLS (Phase 5 slice 1 — the "agent employees")

| Skill | Role | Law it obeys |
|---|---|---|
| **Plan** | planner sub-agent | proposes ≤3 tasks; tightest budget (50k/20k tok); reviews honestly: done / retry (once) / escalate |
| **Build-task** | builder sub-agent | executes ONE task inside the Box; 200k/100k tok; every action attributed `subAgentId` + `parentRunId` |
| **Orchestrate** | auto (orchestrator) | planner→builder→review loop; `/team <cmd>` forces it; caps: depth ≤2, width ≤4, ≤6 live runs |

Kill-switch verbs over every employee: **abort session**, **abort one
sub-agent** (scalpel), **pause/resume session** (state preserved).

## C. PRODUCT SKILLS (structured products with graded receipts)

| Product | id | Output | Receipts include |
|---|---|---|---|
| **Flashcards** | `flashcards` | N cards, letter-filtered term sets (JSON schema) | JSON parses, count, term quality, ≥80% letter rule |
| **Slide deck** | `deck` | Slides with title+bullets (JSON schema) | slide count, titles, ≥1 bullet each |
| **Resume** | `resume` | Structured CV (summary, skills, experience) | summary ≤60 words, ≥2 skills, role+company per entry |
| **Landing page** | build-mode artifact | Full HTML with research notes | 10/10 score, visual baselines, per-constraint ledger receipts |

**Service matrix behind products:** 66 providers × 7 modalities
(chat · vision · image · audio · search · embedding · video) =
**1,188 routable services today** (18 products × routes; projected 2,772 at
42 products). The router picks by capability request → cost tier → health,
with mid-stream rotation (proven: 5 provider switches, partial output kept).

## D. PROVIDER SKILLS (the API-key section answer)

The **PROVIDERS panel** (right panel → PROVIDERS, or `ctrl+k` →
"providers: api keys + health") is where a user pastes their own keys:

- keys are AES-256-GCM encrypted at rest (`providers/creds.ts`), never
  projected by Prisma `select`, never stringified in app logs;
- per-provider health probes (`MEASURE HEALTH` button);
- BYO key gating: adapters report `BYO needed` until a key exists;
- configuring a second chat provider's key flips verification receipts
  from `SAME-FAMILY FRESH CONTEXT` to `INDEPENDENT PROVIDER` with zero
  code change (the Option-B → Option-A upgrade path).

The **ROUTER panel** exposes the same matrix for dry-runs: capability
requests, fallback chains, rotation drills, cost ledger.

## E. VERIFICATION SKILLS (the honesty engine)

| Skill | What it proves |
|---|---|
| Constraint ledger | extracts testable assertions from every build command |
| Adversarial critic | independent-pass grading; label honest about same-family ceiling |
| Visual regression | browser-hands screenshots, baseline compare |
| CMS probe + 10-site benchmark | proof bus over real surfaces |
| Event-log integrity | contiguous seq, replay projection, per-run separation |
| Undo journal | .awon-trash, 7-day TTL, per-run partitioning |

## F. SERVICE CATALOG — the "400+ services" ledger (fill-in section)

The user's vision: 400+ distinct services deliverable end-to-end. Today's
truth: **1,188 routable provider routes** across 66 providers, and the
matrix GROWS one row per new product. New products are specified by adding
a `ProductDef` (JSON schema + graded checks) in
`src/server/royal-red/products/index.ts` — the router, receipts, ledger,
and panels pick it up automatically. Candidate backlog `[PLANNED]`:

1. **PDF pack** (invoice/report/one-pager) — pattern already studied
   (pdf-pipeline, fileforge: React→HTML→PDF; rebuild local, DO-NOT-PORT code)
2. **Slide deck → PPTX/PDF export** — deck-AST contract studied (slidev pattern)
3. **Coloring book / image packs** — prompt + cost-seam patterns studied
4. **Business plan doc** — markdown-instruction architecture studied
5. **Data tables** (CSV/XLSX) — xlsx-grade output with schema checks
6. **Brand kit** (logo SVG + palette + typography tokens) — visual verify
7. **Email sequences** — structured output + reviewer pass
8. **Site audit report** — browser-hands crawl + scored receipts

Each backlog item ships only with: executor → JSON/file schema → graded
checks → receipts. Nothing else enters the catalog.
