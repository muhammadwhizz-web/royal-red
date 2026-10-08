# ROYAL-RED.md

The living memory of Royal Red. Every future session reads this file first to reconstruct context. Written in plain English. No emojis. No em dashes. Data appears in hacking-terminal mono where it matters.

---

## 1.1 What Royal Red is

Royal Red is an agentic operating system that lives inside the user's computer. It takes commands in plain language, plans them, builds the artifacts (websites, documents, PDFs, posters, WordPress themes, research reports), and then proves its own work: every build passes a verification pipeline, every action lands in an append-only event log, every file move is undoable, every token spent carries a receipt. The aesthetic is a majestic royal court: deep royal red, gold reserved for verified seals, glass surfaces, terminal mono for data. The one-sentence pitch: Claude Code can write code; Royal Red can prove what it did, in a UI that feels like a throne, with receipts that carry a crown seal.

## 1.2 The invariants

See docs/INVARIANTS.md (v1.1). Do not duplicate them here. They are law: S-1 through S-10 (system invariants: path prison, consent gate, kill switch, budget ceiling, audit attribution, event log integrity, honest receipts, artifact versions, artifact shape, provider honesty) and C-1 through C-7 (console invariants). Section F records the provider-key decision (Option B).

## 1.3 The architecture in one diagram

```
                          +---------------------------+
                          |        UI CONSOLE         |
                          |  boot, chat, 10 panels    |
                          |  preview files verify     |
                          |  system desktop providers |
                          |  router events memory     |
                          |  agents, palette, history |
                          +------------+--------------+
                                       | SSE + REST
                          +------------v--------------+
                          |     AGENT RUNTIME (agent.ts)      |
                          |  directive loop, mode rules,      |
                          |  tool dispatch, SSE emit          |
                          +------+---------------------+
                                 |  compound commands
                          +------v---------------------+
                          |   ORCHESTRATOR (slice 1)   |
                          |  Supreme Planner -> Royal  |
                          |  Builder -> planner review |
                          |  kill switch: 3 verbs      |
                          +------+---------------------+
                                 |
        +------------------------+------------------------+
        |                        |                        |
+-------v-------+      +---------v--------+      +--------v--------+
| BOX (path     |      | LLM SEAM         |      | VERIFICATION    |
| prison)       |      | harness port:    |      | ENGINE          |
| ops, consent, |      | house provider,  |      | ledger, critic, |
| dry-run, undo |      | router fallback, |      | visual shots,   |
| journal       |      | breaker, ledger  |      | cms test, bench |
+---------------+      +--------+---------+      +-----------------+
                                |
                       +--------v---------+
                       | PROVIDER MATRIX  |
                       | 96 providers     |
                       | 7 modalities     |
                       | 1,728 routes     |
                       | cost-aware router|
                       +------------------+

  Cross-cutting: EVENT LOG (append-only, typed, replayable)
                 COST LEDGER (every token, every call)
                 UNDO JOURNAL (move/copy/trash/mkdir/write)
                 MEMORY STORE (persistent, cross-session, Section 2)
                 AGENT ROSTER (66 named roles, Section 3)
```

One line each:

- UI console: the throne room. Boot sequence, chat stream, ten panels, command palette, session history.
- Agent runtime: the directive loop. Plans, calls tools, persists artifacts, streams events.
- Orchestrator: Phase 5 slice 1. A Supreme Planner spawns Royal Builders, reviews their work, escalates or accepts.
- Box: the path prison. All agent file writes stay inside royalred-box. Consent tiers guard the gates. Every op is undoable.
- LLM seam: every model call flows through one seam. House provider, router fallback, breaker, cost ledger.
- Verification engine: constraint ledger grading, adversarial critique, visual regression screenshots, real CMS CRUD tests, competitor benchmark. Honest score = min(builder, critic).
- Provider matrix: 96 providers across 8 modalities, all keys encrypted at rest (AES-256-GCM), routed by cost-aware policy.
- Event log: append-only, typed, per-session monotonic seq. Replayable. Nothing is ever edited.
- Undo journal: every move, copy, trash, mkdir, write is journaled and reversible.
- Memory store: persistent, scoped, cross-session memory with user approval on agent-inferred writes.
- Agent roster: 66 named royal roles, virtualized (instantiated on demand, max 4 concurrent).

## 1.4 The current version and boot state

- Version: v1.8.0 ("Majestic") as of this round. Previous: v1.7.0 ("Glass Crown").
- Boot sequence lives in src/components/royal-red/boot-overlay.tsx.
- The boot displays: the crown emblem with gold shimmer, the wordmark ROYAL RED, one line per subsystem as it assembles (each sealed with a small crown when complete), and the INITIALIZE button.
- Boot v1.8 lines cover: the memory store, the 66-role roster, the majestic UI law, the website builder pipeline, the WordPress builder, the PDF/poster/document engine, the response protocol (no emojis, no em dashes), and the Option B honesty ceiling (SAME-FAMILY FRESH CONTEXT).

## 1.5 The 48 services catalog

Status vocabulary: shipped / in-progress / planned / backlog. The catalog is the roadmap for the next ten rounds.

Website and CMS (10):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 1 | HTML website builder | shipped (upgraded this round: multi-page, signature typography, overlap gate) | src/server/royal-red/agent.ts + verify | build mode turn |
| 2 | CMS panel generator | shipped (verified by real CRUD in the verification engine) | verify/cms.ts | /verify |
| 3 | WordPress theme builder | shipped this round | src/server/royal-red/wordpress/ | /api/royal-red/wordpress |
| 4 | WordPress full package builder | shipped this round (theme + plugins manifest zip) | src/server/royal-red/wordpress/ | /api/royal-red/wordpress?package=1 |
| 5 | Landing page builder | shipped (upgraded: overlap gate, SEO checks) | agent.ts + verify | build mode turn |
| 6 | E-commerce page builder | backlog | - | - |
| 7 | Blog builder | backlog | - | - |
| 8 | Portfolio builder | backlog | - | - |
| 9 | Docs site builder | backlog | - | - |
| 10 | Multi-language site builder | backlog | - | - |

Content and documents (10):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 11 | PDF generator | shipped (upgraded this round: typography, no-overlap engine) | src/server/royal-red/pdf.ts | /export pdf |
| 12 | Poster generator | shipped this round | src/server/royal-red/poster.ts | /api/royal-red/poster |
| 13 | Document generator | shipped this round (reports with TOC, page numbers) | src/server/royal-red/document.ts | /api/royal-red/document |
| 14 | Slide deck generator | shipped (products/deck) | products/index.ts | product: deck |
| 15 | Resume builder | shipped (products/resume) | products/index.ts | product: resume |
| 16 | Invoice generator | backlog | - | - |
| 17 | Contract generator | backlog | - | - |
| 18 | Letter generator | backlog | - | - |
| 19 | Book/ebook generator | backlog | - | - |
| 20 | Menu generator | backlog | - | - |

Visual and media (8):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 21 | Logo generator | shipped | agent.ts (image providers) | build mode turn |
| 22 | Image generator | shipped | provider matrix, image modality | build mode turn |
| 23 | Image analyzer (VLM) | shipped | provider matrix, vision modality | build/pc modes |
| 24 | Video analyzer | shipped | ffmpeg + VLM | build mode turn |
| 25 | Video editor | backlog | - | - |
| 26 | Icon generator | backlog | - | - |
| 27 | Illustration generator | backlog | - | - |
| 28 | Chart generator (vector, in PDFs) | shipped this round (bar, line, pie as PDF vectors) | src/server/royal-red/pdf.ts | pdf ops |

Research and data (8):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 29 | Web search | shipped | provider matrix, search modality | research mode |
| 30 | Page reader | shipped | research mode | research mode |
| 31 | Multi-page research report | shipped | research mode | research mode |
| 32 | Competitor analysis (10-site benchmark) | shipped | verify/benchmark.ts | /verify benchmark |
| 33 | Market analysis | backlog | - | - |
| 34 | Data analysis (CSV, spreadsheets) | shipped (basic) | tools.ts | build mode turn |
| 35 | Chart from data | shipped this round (vector charts feed PDFs and posters) | pdf.ts | pdf ops |
| 36 | Trend analysis | backlog | - | - |

Automation (6):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 37 | Browser automation | shipped | browser hands | /api/royal-red/pc |
| 38 | Desktop automation | shipped (Phase 4) | box + consent tiers | /api/royal-red/desktop |
| 39 | File automation | shipped | box/ops.ts | files panel |
| 40 | Email drafting | backlog | - | - |
| 41 | Calendar scheduling | backlog | - | - |
| 42 | Task management integration | backlog | - | - |

Communication and memory (6):

| # | Service | Status | Where | API surface |
|---|---------|--------|-------|-------------|
| 43 | Memory system | shipped this round | src/server/royal-red/memory.ts | /api/royal-red/memory |
| 44 | Session history | shipped | sessions sheet | ctrl+j |
| 45 | Event log | shipped | event-log.ts | events panel |
| 46 | Voice interface | backlog (Phase 6) | - | - |
| 47 | Notification system | backlog | - | - |
| 48 | Multi-user collaboration | backlog | - | - |

## 1.6 The 96 providers

96 providers across 8 modalities (chat, vision, embedding, rerank, image, search, audio, video), all keys encrypted at rest with AES-256-GCM, 1,728 routable routes. See docs/PROVIDERS.md for the full catalog.

## 1.7 The sub-agent roster (66 agent employees)

The roster is virtualized: roles are defined, bound to providers, and instantiated on demand. At most 4 run concurrently (docs/PHASE5-BUDGET.md). Every action a role takes is attributed with its agentRole in the audit log and the event log.

Planning and orchestration (5): Supreme Planner (plans and reviews; bound: anthropic), Deputy Planner (backup planner; bound: openai), Orchestrator (dispatch; bound: royalred-builtin), Router (provider routing; bound: royalred-builtin), Budget Keeper (spend ceilings; bound: royalred-builtin).

Building (10): Website Builder (openai), Code Builder (anthropic), Component Builder (openai), Page Builder (openai), CMS Builder (openai), WordPress Builder (anthropic), PDF Builder (royalred-builtin), Poster Builder (royalred-builtin), Document Builder (royalred-builtin), Slide Builder (openai).

Critique and verification (8): Crown Critic (anthropic), Visual Verifier (google), Accessibility Verifier (royalred-builtin, deterministic checks), SEO Verifier (royalred-builtin, deterministic checks), Performance Verifier (royalred-builtin), Honesty Auditor (anthropic), Constraint Checker (royalred-builtin, deterministic grading), Receipt Writer (royalred-builtin).

Research (8): Web Researcher (google), Page Reader (royalred-builtin), Video Watcher (google), Image Analyst (openai), Source Verifier (anthropic), Citation Writer (anthropic), Market Analyst (openai), Competitor Scout (google).

Writing and content (8): Copywriter (anthropic), Editor (anthropic), Typographer (royalred-builtin), SEO Writer (openai), Headline Writer (openai), Meta Writer (openai), Scribe (royalred-builtin), Translator (google).

Data and analysis (6): Data Analyst (openai), Chart Builder (royalred-builtin), Report Writer (anthropic), Table Builder (royalred-builtin), CSV Handler (royalred-builtin), Spreadsheet Builder (royalred-builtin).

Operations (6): File Manager (royalred-builtin), Archive Manager (royalred-builtin), Download Handler (royalred-builtin), Upload Handler (royalred-builtin), Trash Keeper (royalred-builtin), Undo Officer (royalred-builtin).

Browser hands (5): Navigator (royalred-builtin), Clicker (royalred-builtin), Typer (royalred-builtin), Reader (royalred-builtin), Screenshotter (royalred-builtin).

Desktop hands (4): Window Watcher (royalred-builtin), Screen Reader (royalred-builtin), Click Officer (royalred-builtin), Keyboard Officer (royalred-builtin).

Memory and state (3): Archivist (royalred-builtin), Memory Keeper (royalred-builtin), Historian (royalred-builtin).

Communication (2): Herald (royalred-builtin), Notifier (royalred-builtin).

Specialist (1): The Sovereign (final arbiter when two agents disagree; bound: anthropic).

The authoritative machine-readable roster lives in src/server/royal-red/roster.ts with a test asserting exactly 66 roles, unique names, valid provider bindings, and category completeness.

## 1.8 How to extend Royal Red

- Add a service: write the generator module under src/server/royal-red/, give it structured constraint checks, a verification plan, and an honest failure path. Register it in the catalog above with status. Never ship a service without a verification story.
- Add a provider: append a ProviderDef to src/server/royal-red/providers/registry.ts with id, label, protocol, modalities, model list, and cost metadata. The router picks it up automatically. Keys go in the PROVIDERS panel, encrypted at rest.
- Add a sub-agent role: append to src/server/royal-red/roster.ts with name, category, role, bound provider, budget, capabilities. The roster test enforces the 66 ceiling and name uniqueness. Changing the roster size requires updating the ceiling test deliberately.
- Add a UI panel: create the tab component under src/components/royal-red/, add it to right-panel.tsx TabsList, add it to the palette PANELS group, and add a boot line. Panels show mono-font data with gold hairline borders.
- Add an invariant: document it in docs/INVARIANTS.md, then write an executable check in scripts/test-arch-invariants.ts or the relevant suite. An invariant without a test is a wish, not an invariant.

## 1.9 The provenance log

Every competitor pattern ported into Royal Red carries a file:line citation and a license verdict. The canonical record is the Pattern Provenance section of the LICENSE file at repo root. Summary: DeepSeek-harness (MIT) primitives ported with citations; GPL/AGPL projects used as pattern-only references (no code); Open WebUI branding untouched; AI-Resume-Generator clean-roomed. The full audit table from Round 2 lives in the worklog and the LICENSE section; this file is the pointer, not the duplicate.

## 1.10 The decision log (append-only)

1. Provider-key decision (Round 4): Option B on record. No second provider key purchased. SAME-FAMILY FRESH CONTEXT is the permanent honest ceiling for the critique path, stated on every receipt and boot. Upgrading to Option A (INDEPENDENT PROVIDER) costs zero code: configure a key and the label flips. docs/INVARIANTS.md section F.
2. Wormhole payloads (Round 5): the two 18-repo links were the already-integrated payload. Decision: no re-download. Raw zips are gone (sandbox wipes), patterns survive in code plus citations. Off-site backups: R2 (xmakeA), R3 (nbaA5d), R4 (52z24N).
3. Roster virtualization (Round 6): 66 agent employees are named roles bound to providers, not 66 live processes. Instantiation on demand, max 4 concurrent. Saves tokens and compute; the AGENTS panel shows the truth either way.
4. Memory privacy (Round 6): memories never leave the machine. No cloud sync. If cloud sync ever arrives it must be end-to-end encrypted and opt-in.
5. Design law (Round 6, permanent): no emojis anywhere in Royal Red surfaces. Real SVG icons only (Lucide). Gold reserved for the crown and verified seals. No em or en dashes in kernel text output (PDFs, documents, posters, receipts, agent messages, boot). Self-hosted fonts only. Display: Cormorant Garamond. UI: Inter. Data: JetBrains Mono.
6. WordPress verification honesty (Round 6): this sandbox has no PHP runtime and no Docker, so generated themes get static Theme-Check-style audits plus an honest "verification pending real WordPress" label on the receipt. Never faked.
7. CMS law (Round 6): a generated site's CMS is verified by a real login, create, read, delete cycle in the verification engine. A decorative CMS is a build failure.
8. Emoji carve-out (Round 6): the alphabet flashcards product keeps emoji artwork because its own product spec demands it (each card is illustrated by one emoji). That is user-requested content inside an artifact, not a Royal Red surface. Every kernel surface (console, boot, receipts, agent messages, tool outputs, PDFs, posters, documents) is emoji-free and em-dash-free by construction.

## 1.11 The next round's objective

Round 6 shipped the memory store, the 66-role roster, the majestic UI v1.8, the multi-page website builder with overlap and SEO gates, the WordPress theme builder with honest verification, the PDF/poster/document engine with the no-overlap rule, the 48-service catalog, and the response quality protocol. The next round (Round 7) should pick up the backlog by demand: e-commerce page builder, blog builder, portfolio builder, invoice and contract generators, or the voice interface. It should also consider Option A activation if the user buys a second provider key (the label flips automatically), and theme verification in a real WordPress install if the user provides one.
