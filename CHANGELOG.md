# Changelog

All notable changes to Royal Red. Dates use the sandbox clock (2026).
Versions follow the boot version reported in the About section of the console.

## v1.9.1 (wind-up)

- First-run fallback banner: with zero provider keys stored, a calm banner
  above the composer states that Royal Red is on the built-in fallback and
  opens Settings > Providers. It clears itself once any key is saved.
- docs/INSTALL.md: "Verified limits" section with exact tested and untested
  boundaries plus next steps for Docker, WSL2, and the desktop icon.
- docs/DISTRIBUTION.md: distribution guide (GitHub primary, wormhole
  snapshots, Docker) and the one-command install story.
- Repository hygiene: .next, dev logs, tsbuildinfo, and workspace outputs are
  no longer tracked.

## v1.9.0 (Round 7)

- Settings cockpit: nine sections (Providers, Routing preferences,
  Connectors, MCP servers, Skills, General, Data and privacy, Security,
  About) with live status, immediate saves, and an audit row per change.
- Provider matrix expanded to 96 shipped providers (1,728 routes) with cost
  metadata, health probes, custom providers, and routing preferences.
- Connector registry (60 services), MCP client (stdio, HTTP, WebSocket) with
  a 13-server catalog, Claude-style skills with a 10-item catalog.
- Unified tool layer: native, connector, MCP, and skill tools share one
  registry, one consent gate, one audit log, and one error format.
- Key management: AES-256-GCM encrypted at rest, masked display, two-click
  reveal, rotate, delete, per-provider probes.

## v1.8.1 (Phase A)

- One-command install: install.sh, the royal-red launcher (8 subcommands),
  desktop entry with crown icons, multi-stage Dockerfile with first-boot
  schema, docs/INSTALL.md.
- 12-page installation guide PDF produced by Royal Red's own PDF engine.
- README demo GIF, CONTRIBUTING.md, portability pass (env-driven paths,
  /api/health, standalone output).

## v1.8 (majestic UI)

- Self-hosted fonts, warm-tinted palettes, hand-drawn crown and seal, boot
  sequence rewritten as the royal court assembling, emoji and unicode-symbol
  sweep across surfaces.

## v1.7 and earlier

- Glassmorphism signature redesign (crown UI, glass dock, segmented panel
  control, command palette with all panels), verification engine 2.0
  (critic + visual regression), consent tiers, undo journal, kill switch,
  cost-aware router with provider matrix, memory system, agent roster,
  WordPress and PDF/poster engines. See worklog.md for the full record.
