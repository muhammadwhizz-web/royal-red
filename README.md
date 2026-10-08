# ROYAL RED

<p align="center">
  <img src="qa/rr6-boot.png" alt="The Royal Red boot screen: a gold crown above the ROYAL RED wordmark and a column of sealed boot lines" width="640">
</p>

<p align="center">
  <strong>Royal Red is an agentic operating system that lives on your machine, verifies its own work, and gives you honest receipts for everything it builds.</strong>
</p>

---

## What it does

- Builds multi-page websites with working CMS panels, verified end to end in a real browser: structure, accessibility basics, and a deterministic overlap probe at desktop, tablet, and phone widths.
- Generates PDFs, posters, and documents with premium typography, embedded fonts, a real table of contents, and a hard no-overlap layout law. This project's own installation manual is produced by its PDF engine.
- Searches the web, reads pages, transcribes audio, watches videos, and analyzes images through a 96-provider matrix with a cost-aware router and mid-stream rotation.
- Runs entirely on your machine: the agent works inside a fenced workspace, every privileged action asks first with a consent card that names exactly what will happen, and every step lands in an append-only audit log.
- Remembers what you tell it across sessions, dispatches work to 66 named agent employees, and shows every action's attribution in the console.

## The 30-second proof

<p align="center">
  <img src="docs/royal-red-demo.gif" alt="Animated demo: the one-line install, royal-red start, the browser opening to the boot screen, clicking INITIALIZE, typing a prompt, the build streaming, and the verified receipt with the crown seal" width="720">
</p>

The GIF shows the real flow with no cuts: the install command, the launcher, the boot screen, INITIALIZE, a typed prompt, the build, and the receipt.

## Installation

Linux (Debian/Ubuntu or Fedora/RHEL):

```
curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash
```

Windows 11 (via WSL2): install WSL2 with `wsl --install`, open Ubuntu, then run the same line. Full walkthrough in [docs/INSTALL.md](docs/INSTALL.md).

## Quick start

```
royal-red
```

Click **INITIALIZE**, type a prompt such as `build me a landing page for a coffee shop`, and watch the plan, the build, the verification, and the receipt. The launcher keeps the server running in the background; `royal-red stop` stops it.

## Screenshots

| Boot screen | Console (dark) | Verified receipt |
| --- | --- | --- |
| ![Boot screen](qa/rr6-boot.png) | ![Console](qa/rr6-console-live.png) | ![Receipt](qa/phaseA-receipt.png) |

## The 48 services

Royal Red ships a catalog of 48 services across 7 categories. Highlights:

- **Website builder**: multi-page sites with per-page SEO, sitemap, JSON-LD, CMS with verified CRUD, and the overlap gate.
- **WordPress builder**: real installable themes (style.css header, functions.php, full template set) packaged as a zip.
- **Documents**: PDF reports with two-pass tables of contents, posters on named page sizes, all vector, fonts embedded.
- **Flashcards and decks**: study material as printable artifacts.
- **Research**: web search, page reading, video understanding, image analysis, cited briefings.
- **Voice**: speech to text and text to speech.
- **Memory**: cross-session memory store with scopes, promotion, and export.
- **Agent employees**: 66 named roles with bound providers, budgets, and attribution.
- **Settings cockpit**: 96 providers with encrypted key management, 60 connectors (20 fully wired), MCP client (stdio, http, ws), and Claude-style skills, all reachable from one Settings page.

The full catalog with statuses and API surfaces: [docs/SERVICES-CATALOG.md](docs/SERVICES-CATALOG.md).

## Architecture

One kernel process runs the conversation loop, the tool bus, and the verification engine. Sub-agents (planner, builder, roster roles) share one sandboxed Box under a path prison, one consent queue, one undo journal, and one append-only event log, with per-run budgets and full attribution. A provider matrix of 96 providers and 1,728 routes sits behind a cost-aware router that survives five mid-stream provider drops. The console is a local web app over that kernel.

```
console (browser) <-> kernel: chat, panels, SSE
                       |
        +--------------+----------------+
        |              |                |
    provider      verification      sub-agents
    matrix        engine            (planner/builder/
    (66)          (browser +        roster, shared Box,
        |         structure gate)   consent, undo)
        +--------------+----------------+
                       |
              SQLite (sessions, receipts, audit, events, memory)
```

The full architecture document: [ROYAL-RED.md](ROYAL-RED.md).

## Security and honest receipts

Royal Red runs the agent inside a path prison with read-only and read-write mounts it cannot rewrite. Privileged actions pass through consent tiers. Every file change lands in an undo journal with a 7-day TTL. Every action is attributed in the audit log. A receipt carries the gold crown seal only when verification actually passed; when it did not, the receipt says exactly what failed. The invariants and their tests: [docs/INVARIANTS.md](docs/INVARIANTS.md).

## Requirements

- Linux (Debian/Ubuntu or Fedora/RHEL family) or Windows 11 with WSL2
- 500 MB of free disk space
- An internet connection for the initial install
- Optional: an OpenAI, Anthropic, or Google API key for the INDEPENDENT PROVIDER verification tier (roughly 5 to 10 US dollars per month of typical usage); or a local Ollama model at zero cost

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md): the friendly install guide
- [docs/Royal-Red-Installation-Guide.pdf](docs/Royal-Red-Installation-Guide.pdf): the print manual, produced by Royal Red's own PDF engine
- [docs/INVARIANTS.md](docs/INVARIANTS.md): the invariants and their tests
- [docs/PHASE5-ISOLATION.md](docs/PHASE5-ISOLATION.md): sub-agent isolation rules
- [docs/SERVICES-CATALOG.md](docs/SERVICES-CATALOG.md): the 48-service catalog
- [docs/SKILLS-CATALOG.md](docs/SKILLS-CATALOG.md): per-task skills
- [ROYAL-RED.md](ROYAL-RED.md): full architecture

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it lists the project laws (no emojis, no em dashes, no overlap, honest receipts) that every change must keep.

## License

Proprietary. See [LICENSE](LICENSE). The license includes a pattern-provenance section describing what Royal Red learned from which open-source project and under which license.

## Acknowledgments

Royal Red's design borrows patterns, always cited, from open-source agent projects including cline, continue, aider, browser-use, agent-browser, bytebot, Agent S, and the deepseek-harness. The audit table that maps every pattern to its source and license: [docs/LICENSE-AUDIT.md](docs/LICENSE-AUDIT.md).
