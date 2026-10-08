// ROYAL RED Phase A: renders the terminal frames of the demo GIF with sharp
// (SVG -> PNG), using REAL captured output from the installer test runs.
// Run: bun scripts/make-demo-frames.ts

import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const W = 1280
const H = 720
const OUT = path.join(process.cwd(), 'qa', 'gif-frames')
mkdirSync(OUT, { recursive: true })

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function terminalFrame(title: string, lines: { text: string; kind: 'prompt' | 'cmd' | 'out' | 'ok' | 'accent' }[]): string {
  const lh = 34
  const y0 = 120
  const body = lines
    .map((l, i) => {
      const y = y0 + i * lh
      const color =
        l.kind === 'prompt' ? '#8fda9c' : l.kind === 'cmd' ? '#f3e9dc' : l.kind === 'ok' ? '#8fda9c' : l.kind === 'accent' ? '#e0a13a' : '#b9aca4'
      const weight = l.kind === 'prompt' || l.kind === 'cmd' ? '600' : '400'
      return `<text x="72" y="${y}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="21" font-weight="${weight}" fill="${color}">${esc(l.text)}</text>`
    })
    .join('\n')
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#140a09"/>
  <rect width="${W}" height="64" fill="#241311"/>
  <circle cx="36" cy="32" r="9" fill="#c25b4e"/>
  <circle cx="66" cy="32" r="9" fill="#d9a441"/>
  <circle cx="96" cy="32" r="9" fill="#7ba05b"/>
  <text x="${W / 2}" y="40" text-anchor="middle" font-family="JetBrains Mono, DejaVu Sans Mono, monospace" font-size="19" fill="#8a7a72">${esc(title)}</text>
  ${body}
</svg>`
}

// REAL output from the installer test runs (sandbox, Debian 13)
const frames: { name: string; title: string; lines: Parameters<typeof terminalFrame>[1] }[] = [
  {
    name: 't1-install-cmd',
    title: 'terminal',
    lines: [
      { text: '$ curl -fsSL https://raw.githubusercontent.com/royal-red/', kind: 'prompt' },
      { text: '    royal-red/main/install.sh | bash', kind: 'prompt' },
      { text: '', kind: 'out' },
      { text: 'ROYAL RED installer', kind: 'cmd' },
      { text: '== checking the operating system', kind: 'out' },
      { text: '   ok: detected Debian GNU/Linux 13 (trixie)', kind: 'ok' },
      { text: '== checking curl', kind: 'out' },
      { text: '   ok: curl found', kind: 'ok' },
      { text: '== checking bun (the runtime Royal Red runs on)', kind: 'out' },
      { text: '   ok: bun 1.3.14 found', kind: 'ok' },
    ],
  },
  {
    name: 't2-install-run',
    title: 'terminal',
    lines: [
      { text: '== placing Royal Red in /home/you/.royal-red/app', kind: 'out' },
      { text: '   ok: source placed', kind: 'ok' },
      { text: '== installing dependencies (this can take a minute)', kind: 'out' },
      { text: '   ok: dependencies installed', kind: 'ok' },
      { text: '== setting up the SQLite database', kind: 'out' },
      { text: '   ok: database ready', kind: 'ok' },
      { text: '== installing the royal-red command', kind: 'out' },
      { text: '   ok: command installed at ~/.local/bin/royal-red', kind: 'ok' },
      { text: '== installing the desktop entry and the crown icon', kind: 'out' },
      { text: '   ok: desktop entry and icons installed', kind: 'ok' },
    ],
  },
  {
    name: 't3-installed',
    title: 'terminal',
    lines: [
      { text: '', kind: 'out' },
      { text: 'Royal Red installed.', kind: 'accent' },
      { text: 'Run: royal-red', kind: 'cmd' },
      { text: 'Or open the Applications menu and click Royal Red.', kind: 'out' },
      { text: '', kind: 'out' },
      { text: '$ royal-red --version', kind: 'prompt' },
      { text: 'Royal Red 1.8.1', kind: 'out' },
      { text: '', kind: 'out' },
      { text: '$ royal-red', kind: 'prompt' },
    ],
  },
  {
    name: 't4-launch',
    title: 'terminal',
    lines: [
      { text: '$ royal-red', kind: 'prompt' },
      { text: 'royal-red: starting on port 3000 (auto mode),', kind: 'out' },
      { text: '    logs at ~/.royal-red/logs/server.log', kind: 'out' },
      { text: 'Royal Red is running at http://localhost:3000 (pid 833)', kind: 'ok' },
      { text: '', kind: 'out' },
      { text: '# ...the browser opens. control returns to you.', kind: 'accent' },
      { text: '', kind: 'out' },
      { text: '$ royal-red status', kind: 'prompt' },
      { text: 'running: yes', kind: 'ok' },
      { text: 'url: http://localhost:3000', kind: 'out' },
      { text: 'uptime: 00:10', kind: 'out' },
    ],
  },
  {
    name: 't5-end',
    title: 'terminal',
    lines: [
      { text: '', kind: 'out' },
      { text: '', kind: 'out' },
      { text: '        R O Y A L   R E D', kind: 'accent' },
      { text: '  the agentic OS that verifies its own work', kind: 'out' },
      { text: '', kind: 'out' },
      { text: '  install:  curl -fsSL github/royal-red/install.sh | bash', kind: 'out' },
      { text: '  launch:   royal-red', kind: 'out' },
    ],
  },
]

for (const f of frames) {
  const svg = terminalFrame(f.title, f.lines)
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  writeFileSync(path.join(OUT, `${f.name}.png`), png)
  console.log(`${f.name}.png rendered`)
}
console.log('terminal frames done')
