#!/usr/bin/env bun
// ROYAL RED GitHub ship script: creates the repository, sets metadata,
// pushes main + tags, and cuts the GitHub release. Pure REST, no gh CLI.
//
// Usage:
//   export GITHUB_TOKEN=github_pat_...     # fine-grained PAT, see help below
//   bun scripts/github/ship.mjs            # public repo "royal-red"
//   PRIVATE=1 bun scripts/github/ship.mjs  # private repo instead
//   REPO=other-name bun scripts/github/ship.mjs
//   FORCE=1 bun scripts/github/ship.mjs    # allow pushing over a non-empty remote
//   DRY_RUN=1 GITHUB_TOKEN=x bun scripts/github/ship.mjs   # show the plan, touch nothing
//
// The token is read from the environment only, is never printed, never
// written to disk, and never lands in a git remote URL (auth travels via
// an http extraheader for the push commands only).

import fs from 'node:fs'
import path from 'node:path'

const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'
const REPO_NAME = process.env.REPO || 'royal-red'
const TOKEN = process.env.GITHUB_TOKEN || ''
const PRIVATE = process.env.PRIVATE === '1'
const FORCE = process.env.FORCE === '1'
const DRY_RUN = process.env.DRY_RUN === '1'
const ROOT = path.resolve(import.meta.dir, '..', '..')
const TAG = 'v1.9.1'

function die(msg) {
  console.error(`[ship] ERROR: ${msg}`)
  process.exit(1)
}
function step(msg) {
  console.log(`[ship] ${msg}`)
}

if (!TOKEN) {
  console.log(`Royal Red GitHub ship script.

Needed: a GitHub fine-grained personal access token with:
  - Repository access: the repo you will create (or All repositories)
  - Permissions: Administration (read/write), Contents (read/write), Metadata (read)
Create one at: https://github.com/settings/personal-access-tokens/new
Then run:
  export GITHUB_TOKEN=your_token
  bun scripts/github/ship.mjs
Options: PRIVATE=1 private repo, REPO=name repo name, FORCE=1 overwrite guard off,
DRY_RUN=1 print the plan only.`)
  process.exit(DRY_RUN ? 0 : 1)
}

async function gh(method, url, body, isUpload = false) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'royal-red-ship',
  }
  if (body && !isUpload) headers['Content-Type'] = 'application/json'
  if (isUpload) headers['Content-Type'] = 'application/octet-stream'
  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isUpload ? body : JSON.stringify(body)) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 200) } }
  if (!res.ok) {
    const err = new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`)
    err.status = res.status
    throw err
  }
  return json
}

function sh(cmd, opts = {}) {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', ...opts })
  if (p.exitCode !== 0) die(`command failed: ${cmd.join(' ')}\n${new TextDecoder().decode(p.stderr)}`)
  return new TextDecoder().decode(p.stdout).trim()
}

// ---- 1. guards -------------------------------------------------------------
if (!DRY_RUN) {
  const dirty = sh(['git', 'status', '--porcelain'])
  if (dirty) die(`working tree is dirty, commit first:\n${dirty}`)
}
step(`repo: ${PRIVATE ? 'private' : 'public'} github.com/<owner>/${REPO_NAME}, tag ${TAG}${DRY_RUN ? ' (DRY RUN)' : ''}`)

// ---- 2. who am I -----------------------------------------------------------
const me = DRY_RUN ? { login: 'YOUR_OWNER' } : await gh('GET', `${API}/user`)
const OWNER = me.login
step(`authenticated as ${OWNER}`)

// ---- 3. substitute the placeholder in docs ---------------------------------
const FILES_WITH_PLACEHOLDER = ['README.md', 'docs/INSTALL.md', 'CONTRIBUTING.md', 'docs/DISTRIBUTION.md', 'install.sh']
let substituted = []
for (const f of FILES_WITH_PLACEHOLDER) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  const before = fs.readFileSync(p, 'utf8')
  const after = before.split('YOUR_GITHUB_USERNAME').join(OWNER)
  if (after !== before) {
    if (DRY_RUN) substituted.push(f)
    else { fs.writeFileSync(p, after); substituted.push(f) }
  }
}
if (!DRY_RUN && substituted.length) {
  sh(['git', 'add', ...substituted])
  sh(['git', 'commit', '-m', `docs: point install and clone URLs at github.com/${OWNER}/${REPO_NAME}`])
  step(`substituted owner in: ${substituted.join(', ')} (committed)`)
} else if (substituted.length) {
  step(`would substitute owner in: ${substituted.join(', ')}`)
} else {
  step('no placeholder left to substitute (already done)')
}

// ---- 4. create the repo if missing -----------------------------------------
let repo
if (!DRY_RUN) {
  try {
    repo = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}`)
    step(`repository already exists: ${repo.html_url} (${repo.private ? 'private' : 'public'})`)
  } catch (e) {
    if (e.status !== 404) throw e
    step('creating repository...')
    repo = await gh('POST', `${API}/user/repos`, {
      name: REPO_NAME,
      description: 'Royal Red: a local-first agentic operating system with 96 providers, 60 connectors, MCP, skills, real verification, and honest receipts.',
      homepage: '',
      private: PRIVATE,
      has_issues: true,
      has_wiki: false,
      has_downloads: true,
      auto_init: false,
    })
    step(`created: ${repo.html_url}`)
  }
}

// ---- 5. push main + tags ---------------------------------------------------
const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`
if (!DRY_RUN) {
  step('pushing main + tags (guard: refuses over a non-empty remote unless FORCE=1)')
  const head = sh(['git', 'rev-parse', 'HEAD'])
  const listCmd = ['git', '-c', `http.https://github.com/.extraheader=${authHeader}`, 'ls-remote', `https://github.com/${OWNER}/${REPO_NAME}.git`]
  const remoteHeads = sh(listCmd)
  if (remoteHeads && !FORCE) die(`remote is not empty; refusing to push. Inspect it, then rerun with FORCE=1 if you are sure.`)
  const pushArgs = ['git', '-c', `http.https://github.com/.extraheader=${authHeader}`, 'push', `https://github.com/${OWNER}/${REPO_NAME}.git`, 'main', '--tags', '--follow-tags']
  if (FORCE) pushArgs.push('--force')
  sh(pushArgs)
  step(`pushed main (${head.slice(0, 10)}) + tags`)
}

// ---- 6. metadata: description, homepage, topics ----------------------------
if (!DRY_RUN) {
  await gh('PATCH', `${API}/repos/${OWNER}/${REPO_NAME}`, {
    description: 'Royal Red: a local-first agentic operating system with 96 providers, 60 connectors, MCP, skills, real verification, and honest receipts.',
    homepage: `https://github.com/${OWNER}/${REPO_NAME}#readme`,
  })
  await gh('PUT', `${API}/repos/${OWNER}/${REPO_NAME}/topics`, {
    names: ['ai', 'agent', 'llm', 'local-first', 'nextjs', 'bun', 'mcp', 'connectors', 'self-hosted', 'sqlite', 'verification', 'provider-matrix'],
  })
  step('description + topics set')
}

// ---- 7. release ------------------------------------------------------------
const NOTES = `# Royal Red v1.9.1

## What this is

An agentic operating system that runs on your machine: 96-provider matrix behind a cost-aware router, 60 connectors (20 fully wired), an MCP client (stdio, HTTP, WebSocket), Claude-style skills, 66 agent employees, a website builder, a WordPress builder, a vector PDF engine, and a Settings cockpit that puts every key and integration in one place.

## Highlights since v1.8.1

- 30 new providers (96 total, 1,728 routes): Groq, Gemini, NVIDIA NIM, Cerebras, SambaNova, SiliconFlow, HF Inference, and more, with honest cost metadata
- Settings cockpit: 11 sections, live health probes, encrypted key management (AES-256-GCM), routing preferences, immediate save, searchable
- Unified tool layer: one registry, one consent gate (read-only, write, destructive), one audit log, one error shape
- First-run key UX: a calm banner when no key is stored, Open Settings lands on Providers, the banner clears the moment a key is saved
- Off-site backup tooling committed to the repo (scripts/offsite), round-trip verified end to end
- Fresh-clone boot proven: clone, bun install, db push, dev server up, health OK

## Install

    curl -fsSL https://raw.githubusercontent.com/${OWNER}/${REPO_NAME}/main/install.sh | bash

or clone and run by hand: see the README.

## Honest limits

Docker, WSL2, and desktop-icon paths are structurally verified and documented as needing real-machine confirmation (docs/INSTALL.md, Verified limits). Without any API key the app runs on the built-in fallback, clearly labeled.`
if (!DRY_RUN) {
  let release
  try {
    release = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}/releases/tags/${TAG}`)
    step(`release for ${TAG} already exists, reusing it`)
  } catch (e) {
    if (e.status !== 404) throw e
    release = await gh('POST', `${API}/repos/${OWNER}/${REPO_NAME}/releases`, {
      tag_name: TAG,
      name: `Royal Red ${TAG}`,
      body: NOTES,
      draft: false,
      prerelease: false,
    })
    step(`release created: ${release.html_url}`)
  }
  const assetPath = path.join(ROOT, 'install.sh')
  const assets = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}/releases/${release.id}/assets`)
  if (!assets.some((a) => a.name === 'install.sh')) {
    await gh('POST', `${UPLOADS}/repos/${OWNER}/${REPO_NAME}/releases/${release.id}/assets?name=install.sh`, fs.readFileSync(assetPath), true)
    step('uploaded asset: install.sh (so the one-liner also works from the releases page)')
  }
}

// ---- 8. verify and report --------------------------------------------------
if (!DRY_RUN) {
  const check = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}`)
  const tags = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}/tags`)
  const rel = await gh('GET', `${API}/repos/${OWNER}/${REPO_NAME}/releases/tags/${TAG}`)
  console.log('\n[ship] VERIFIED:')
  console.log(`  repository : ${check.html_url} (${check.private ? 'private' : 'public'}, default branch ${check.default_branch})`)
  console.log(`  tags       : ${tags.map((t) => t.name).join(', ')}`)
  console.log(`  release    : ${rel.html_url}`)
  console.log(`  clone      : git clone ${check.clone_url}`)
  console.log(`  one-liner  : curl -fsSL https://raw.githubusercontent.com/${OWNER}/${REPO_NAME}/main/install.sh | bash`)
} else {
  console.log('\n[ship] DRY RUN complete: nothing was created, pushed, or published.')
}
