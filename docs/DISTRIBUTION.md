# Distributing Royal Red

This document answers two questions: how do I hand Royal Red to other people,
and how do they get it running with the least friction.

## The rule of one command

The entire install story must always reduce to one command on a fresh machine.
Today that command is:

```
git clone <repo-url> royal-red && cd royal-red && bash install.sh
```

The installer detects the OS (Ubuntu, Debian, Fedora, Arch, WSL2), installs
bun if missing, runs the schema push, deploys the `royal-red` command, the
desktop entry, and the crown icons, starts the server, and opens the console.
No questions that a stranger cannot answer. No manual steps.

When a domain is chosen for the project, the same installer will be reachable
as `curl -fsSL https://get.royalred.dev | bash`. Until that DNS decision is
made, the raw-GitHub form works:

```
curl -fsSL https://raw.githubusercontent.com/<user>/royal-red/main/install.sh | bash
```

Both forms run the same script. The canonical URL is a one-line change.

## Distribution channels, in order of recommendation

### 1. GitHub repository (primary)

- Create the repo (private by default; the owner decides when to open it).
- Push the full history. The tree already contains LICENSE, README.md,
  CONTRIBUTING.md, CHANGELOG.md, docs/, .github issue and PR templates,
  and CODE_OF_CONDUCT.md.
- Tag releases: the current state is `v1.8.1` plus the Round 7 and wind-up
  commits; tag each milestone so `royal-red update` can diff cleanly.
- The clone test to run before every tagged release, on a fresh container:
  clone, `bun install`, `bun run db:push`, `bun run dev`, expect the console
  on port 3000; and a second run with `bash install.sh` from the clone.

### 2. Wormhole transfer for full snapshots (backup and direct handoff)

Every round ends with a fresh off-site backup uploaded through wormhole.app.
The uploader lives in the sandbox workspace (`whput2.mjs`) and follows the
wormhole protocol: the file is stream-encrypted end to end (AES-256-GCM,
RFC 8188 record framing), packed as an encrypted torrent, stored on Backblaze
B2, and the 16-byte key travels only in the URL fragment. The server never
sees plaintext. Each link is live for 24 hours and allows 100 downloads.

Round-trip verification is part of the round: the uploader's output is
downloaded again, every piece sha1 is checked against the torrent metadata,
the file is decrypted, and the sha256 must match the source before the link
is reported. If the uploader is ever lost with a sandbox reset, rebuild it
first, before anything else; the protocol notes in the worklog are enough.

### 3. Docker image (for servers)

The repository ships a multi-stage Dockerfile that produces a standalone
runtime. For a server deployment:

```
docker build -t royal-red .
docker run -d -p 3000:3000 -v royalred-data:/data --name royal-red royal-red
```

Data (database, keys, audit log) lives in the volume, so container upgrades
preserve state. Note: this path is verified structurally; a real daemon run
is the documented next step in docs/INSTALL.md ("Verified limits").

## What people get on first run

The first-run experience is designed for zero API key errors:

- With no keys configured, the console loads normally and a single calm
  banner above the composer explains that Royal Red is running on the
  built-in fallback and links straight to Settings > Providers.
- Every prompt still produces a real response through the built-in fallback.
- Saving a key in Settings validates the format, stores it AES-256-GCM
  encrypted, probes the provider in the background, and shows the result
  honestly. The banner disappears the moment one key is stored.
- The router degrades silently: a missing key, an invalid key, a rate limit,
  or a dead provider is skipped in favor of the next candidate, and the
  decision is written to the audit log. The user never sees a raw error.

## The update path

- `royal-red update` pulls the latest code, installs dependencies, pushes the
  schema, restarts the server, and preserves all user data (sessions, memory,
  audit log, keys).
- Running `bash install.sh` again over an existing install performs the same
  upgrade in place. Uninstalling (`royal-red uninstall` or
  `install.sh --uninstall`) removes the app and command, and always asks
  before touching user data.

## The honest boundary

Three paths cannot be fully verified without real hardware, and docs/INSTALL.md
carries a "Verified limits" section saying exactly what was tested and what
the next step is for Docker, WSL2, and the desktop icon. Distribution copy
should quote that section rather than overclaim.
