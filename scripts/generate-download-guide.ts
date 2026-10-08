// ROYAL RED: generates docs/Royal-Red-Download-and-Install-Guide.pdf using the
// kernel's own PDF engine (embedded fonts, no-overlap flow, two-pass TOC,
// running headers, vector crown). The deep royal red and gold palette is the
// engine's own: no LaTeX, no Pandoc, no external library touches this file.
//
// Run: bun scripts/generate-download-guide.ts [--letter]
// Out: docs/Royal-Red-Download-and-Install-Guide.pdf

import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { buildPdf, PAGE_SIZES, type PdfLine, type PageSize } from '../src/server/royal-red/pdf'
import { enforceTextLaw } from '../src/server/royal-red/text-law'

const VERSION = '1.9.1'
const REPO = 'muhammadwhizz-web/royal-red'
const RAW = `https://raw.githubusercontent.com/${REPO}/main/install.sh`
const GOLD: number[] = [0.631, 0.384, 0.027]

const SECTIONS: { heading: string; blocks: PdfLine[] }[] = [
  {
    heading: '1. What Royal Red is',
    blocks: [
      {
        text: 'Royal Red is an agentic operating system that lives on your machine, verifies its own work, and gives you honest receipts for everything it builds.',
        style: 'sub',
      },
      {
        text: 'It runs on your computer. The agent works inside a fenced workspace, every privileged action asks you first with a card that names exactly what will happen, and every step lands in an audit log you can read. Your files stay on your machine. There is no account to create and nothing to subscribe to.',
        style: 'body',
      },
      {
        text: 'It comes with a matrix of 96 AI providers behind one cost-aware router, 60 service connectors, a Model Context Protocol client, Claude-style skills, 66 named agent employees, a website builder, a WordPress builder, and a vector PDF engine. This very document was produced by that engine.',
        style: 'body',
      },
      {
        text: 'The project is open source under the MIT license. Anyone can use it, study it, change it, and ship it. The repository lives at github.com/muhammadwhizz-web/royal-red.',
        style: 'body',
      },
    ],
  },
  {
    heading: '2. Choose your path',
    blocks: [
      { text: 'One question decides everything: which system are you on?', style: 'sub' },
      {
        text: 'Windows 11: follow Section 3. It installs a real Ubuntu system inside Windows (WSL2, the official Microsoft way) and then runs the one-line installer. About ten minutes, mostly waiting.',
        style: 'body',
      },
      {
        text: 'Ubuntu, Debian, Fedora, or a close relative: follow Section 4. One command. Two minutes.',
        style: 'body',
      },
      {
        text: 'Any system, or you want the code and future updates: follow Section 5. This is the developer path: clone the repository, install dependencies, run it. It is also the macOS path.',
        style: 'body',
      },
      {
        text: 'You only want to read the code and the documents: skip to Section 9 and download the ZIP. No terminal needed for reading.',
        style: 'body',
      },
      {
        text: 'What you need in every case: about 500 MB of free disk space, an internet connection for the first install, and a normal user account. You do not need an API key to begin; Section 6 explains how the built-in fallback works and how to add a key when you are ready.',
        style: 'body',
      },
    ],
  },
  {
    heading: '3. Windows 11, step by step (WSL2)',
    blocks: [
      { text: 'Step 1: open PowerShell as administrator', style: 'sub' },
      {
        text: 'Click the Start button, type powershell, right click Windows PowerShell, and choose Run as administrator. A blue window with a blinking cursor appears.',
        style: 'body',
      },
      { text: 'Step 2: install WSL2', style: 'sub' },
      { text: 'Paste this command and press Enter:', style: 'body' },
      { text: 'wsl --install', style: 'code' },
      {
        text: 'What you should see: progress messages as Windows enables the subsystem and downloads Ubuntu. When it finishes, restart the computer. After the restart an Ubuntu window opens and asks you to create a username and password. These belong to the Linux side only; pick anything you will remember.',
        style: 'body',
      },
      { text: 'Step 3: open Ubuntu', style: 'sub' },
      {
        text: 'Click Start, type Ubuntu, and press Enter. A terminal window opens. This window is a full Ubuntu Linux system. Tip: the free Windows Terminal app from the Microsoft Store manages Ubuntu tabs nicely.',
        style: 'body',
      },
      { text: 'Step 4: run the installer', style: 'sub' },
      { text: 'In the Ubuntu window, paste this line and press Enter:', style: 'body' },
      { text: `curl -fsSL ${RAW} | bash`, style: 'code' },
      {
        text: 'What you should see: a short series of steps, each ending in ok, ending with a message that Royal Red is installed. The installer installs the Bun runtime if it is missing, places the app under your home directory, adds the royal-red command, and prepares your data directory.',
        style: 'body',
      },
      { text: 'Step 5: launch', style: 'sub' },
      { text: 'Type:', style: 'body' },
      { text: 'royal-red', style: 'code' },
      {
        text: 'What you should see: the server starts, and your default Windows browser opens the Royal Red boot screen with a gold crown. Click INITIALIZE. Section 6 continues from here. To stop it later, run royal-red stop; to start it again, open Ubuntu and run royal-red.',
        style: 'body',
      },
    ],
  },
  {
    heading: '4. Linux in one line',
    blocks: [
      { text: 'Step 1: open a terminal', style: 'sub' },
      {
        text: 'On Ubuntu, press the Super key, type terminal, and press Enter. On Fedora, click Activities, type terminal, and press Enter.',
        style: 'body',
      },
      { text: 'Step 2: run the installer', style: 'sub' },
      { text: 'Paste this line and press Enter:', style: 'body' },
      { text: `curl -fsSL ${RAW} | bash`, style: 'code' },
      {
        text: 'If curl is missing, the installer prints the exact command to install it for your distribution. Run that, then run the installer again.',
        style: 'body',
      },
      { text: 'Step 3: launch and verify', style: 'sub' },
      { text: 'Close the terminal, open a fresh one (so the PATH refreshes), and run:', style: 'body' },
      { text: 'royal-red', style: 'code' },
      {
        text: 'The browser opens the boot screen. Click INITIALIZE. The launcher keeps the server running in the background; royal-red stop stops it, royal-red status shows whether it is running, and royal-red update pulls the next version without touching your data.',
        style: 'body',
      },
    ],
  },
  {
    heading: '5. The clone path (developers and macOS)',
    blocks: [
      { text: 'Step 1: install Bun, the one runtime dependency', style: 'sub' },
      { text: 'From bun.sh, or with one line:', style: 'body' },
      { text: 'curl -fsSL https://bun.sh/install | bash', style: 'code' },
      { text: 'Close and reopen the terminal afterwards so the bun command is on your PATH.', style: 'body' },
      { text: 'Step 2: clone the repository', style: 'sub' },
      { text: 'git clone https://github.com/muhammadwhizz-web/royal-red.git', style: 'code' },
      { text: 'cd royal-red', style: 'code' },
      { text: 'Step 3: dependencies and database', style: 'sub' },
      { text: 'bun install', style: 'code' },
      { text: 'cp .env.example .env', style: 'code' },
      {
        text: 'Open .env in any editor and set DATABASE_URL to an absolute path where your data should live, for example file:/home/yourname/royal-red-data/royal-red.db. Then create the database:',
        style: 'body',
      },
      { text: 'bun run db:push', style: 'code' },
      { text: 'Step 4: run it', style: 'sub' },
      { text: 'bun run dev', style: 'code' },
      {
        text: 'Open http://localhost:3000 and click INITIALIZE. To update later: git pull, bun install, bun run db:push. Your sessions, memory, audit log, and encrypted keys live in your own database file and survive every update.',
        style: 'body',
      },
    ],
  },
  {
    heading: '6. First run: the two-minute ritual',
    blocks: [
      {
        text: 'The boot screen shows a gold crown and a column of sealed boot lines. Click INITIALIZE. The console opens.',
        style: 'body',
      },
      {
        text: 'If you have not added an API key yet, a calm banner appears above the composer: Royal Red is running on the built-in fallback. Add an API key in Settings to unlock the full model roster.',
        style: 'sub',
      },
      {
        text: 'This banner is not an error. It is the design working. Without any key you can still chat, build websites, generate PDFs, and use the fallback provider, with honest limits. Nothing crashes, nothing turns red.',
        style: 'body',
      },
      {
        text: 'When you are ready for the full 96-provider roster, click Open Settings on the banner. The Providers section opens. Pick any provider, click ADD KEY, paste your key, and save. The key is encrypted with AES-256-GCM before it touches the disk and is never sent back in full to any screen.',
        style: 'body',
      },
      {
        text: 'Royal Red tests the connection in the background and shows Connected in green, or the provider real error in amber. Either way the key is saved; a typo in a key never blocks you. The banner disappears the moment one key is saved, and it rechecks automatically every 20 seconds.',
        style: 'body',
      },
    ],
  },
  {
    heading: '7. What you can do on day one',
    blocks: [
      { text: 'Ask for products, not commands', style: 'sub' },
      {
        text: 'Type what you want in plain language: build me a landing page for a coffee shop, make me a WordPress theme for a photography portfolio, make me a poster for a product launch. Royal Red plans, builds, verifies the result in a real browser, and hands you a receipt.',
        style: 'body',
      },
      { text: 'The crown seal', style: 'sub' },
      {
        text: 'Every finished task carries a receipt. The gold crown seal appears only when verification actually passed. If something was not verified, the receipt says exactly what failed. A missing seal is information, not a failure to hide.',
        style: 'body',
      },
      { text: 'The Settings cockpit', style: 'sub' },
      {
        text: 'One page holds everything: 96 providers with live health probes, 60 connectors, MCP servers, skills, routing preferences, security, and data export. It saves immediately, never needs a refresh button, and every change writes an audit row.',
        style: 'body',
      },
    ],
  },
  {
    heading: '8. Updating and uninstalling',
    blocks: [
      { text: 'Installer users (Section 3 or 4)', style: 'sub' },
      { text: 'royal-red update', style: 'code' },
      {
        text: 'That pulls the latest version, reinstalls dependencies, and keeps every byte of your data. royal-red stop stops the background service; royal-red uninstall removes the app, the command, and the desktop entry, and asks before touching your data.',
        style: 'body',
      },
      { text: 'Clone users (Section 5)', style: 'sub' },
      {
        text: 'git pull, then bun install, then bun run db:push. The same data guarantee applies: the database file is yours.',
        style: 'body',
      },
    ],
  },
  {
    heading: '9. If something goes wrong',
    blocks: [
      { text: 'The five common cases', style: 'sub' },
      {
        text: 'curl: command not found. Windows: you are in PowerShell, use the Ubuntu window instead. Linux: install curl with sudo apt install curl or sudo dnf install curl, then retry.',
        style: 'body',
      },
      {
        text: 'bun: command not found after install. Close and reopen the terminal, or run source ~/.bashrc. The installer adds Bun to your PATH; a fresh shell picks it up.',
        style: 'body',
      },
      {
        text: 'Port 3000 already in use. The launcher picks a free port automatically. In dev mode, stop the other process with royal-red stop and start again.',
        style: 'body',
      },
      {
        text: 'DATABASE_URL error on first boot. You skipped the environment step in Section 5: copy .env.example to .env and set an absolute path.',
        style: 'body',
      },
      {
        text: 'Everything broken, start clean. Stop Royal Red, delete your royal-red.db file, start again. This erases sessions, memory, and stored keys; export anything you care about first from Settings, Data and privacy.',
        style: 'body',
      },
      { text: 'Where to get help', style: 'sub' },
      {
        text: 'Open an issue at github.com/muhammadwhizz-web/royal-red/issues. Include your operating system, the output of royal-red --version, and what you expected versus what happened. The README troubleshooting table covers more cases.',
        style: 'body',
      },
    ],
  },
  {
    heading: '10. License and links',
    blocks: [
      { text: 'MIT, for everyone', style: 'sub' },
      {
        text: 'Royal Red is released under the MIT license. You can use it, copy it, change it, merge it, publish it, and sell things built with it. Keep the copyright notice; that is the only condition. The open-source patterns the design learned from are credited in docs/LICENSE-AUDIT.md.',
        style: 'body',
      },
      { text: 'The links', style: 'sub' },
      { text: 'Repository: https://github.com/muhammadwhizz-web/royal-red', style: 'code' },
      { text: 'Releases: https://github.com/muhammadwhizz-web/royal-red/releases', style: 'code' },
      { text: 'Issues: https://github.com/muhammadwhizz-web/royal-red/issues', style: 'code' },
      { text: `Install (Linux and WSL2): curl -fsSL ${RAW} | bash`, style: 'code' },
      { text: '', style: 'body' },
      {
        text: 'Thank you for installing Royal Red. The door is the same for everyone: one command in, one word to launch, one crown when the work is verified.',
        style: 'sub',
      },
    ],
  },
]

const lawLine = (l: PdfLine): PdfLine => {
  const r = enforceTextLaw(l.text)
  return { ...l, text: r.text }
}

function buildDoc(pageSize: PageSize): { pdf: Buffer; pages: number; toc: { text: string; page: number }[] } {
  const size = PAGE_SIZES[pageSize]

  const cover = (): PdfLine[] => {
    const out: PdfLine[] = []
    // crown art occupies roughly y 544..672 on A4 (yTop = pageH - 170, scale 3.2)
    for (let i = 0; i < 5; i++) out.push({ text: '', style: 'display' })
    for (let i = 0; i < 6; i++) out.push({ text: '', style: 'body' })
    out.push({ text: 'R O Y A L   R E D', style: 'display', align: 'center' })
    out.push({ text: '', style: 'body' })
    out.push({ text: 'Download and Install Guide', style: 'sub', align: 'center' })
    out.push({ text: '', style: 'body' })
    out.push({ text: 'From zero to the boot screen in ten minutes', style: 'dim', align: 'center' })
    out.push({ text: '', style: 'body' })
    out.push({ text: `Version ${VERSION}, MIT licensed`, style: 'dim', align: 'center', color: GOLD })
    out.push({
      text: new Date().toISOString().slice(0, 10),
      style: 'dim',
      align: 'center',
    })
    return out.map(lawLine)
  }

  const tocSkeleton = (): PdfLine[] => {
    const out: PdfLine[] = [
      { text: '', style: 'body', pageBreakBefore: true },
      { text: 'CONTENTS', style: 'heading' },
    ]
    for (const s of SECTIONS) out.push({ text: s.heading, style: 'toc' })
    return out.map(lawLine)
  }

  const body = (): PdfLine[] => {
    const out: PdfLine[] = []
    for (const s of SECTIONS) {
      out.push({ text: s.heading, style: 'heading', section: s.heading, pageBreakBefore: true })
      for (const b of s.blocks) out.push(b)
      out.push({ text: '', style: 'body' })
    }
    return out.map(lawLine)
  }

  const opts = (onMap?: (e: { page: number; text: string }[]) => void) => ({
    pageSize,
    headerTitle: 'Download and Install Guide',
    footerNote: 'ROYAL RED, MIT LICENSED, YOURS TO KEEP',
    suppressChromeOnFirstPage: true,
    crown: { cx: size.w / 2, yTop: size.h - 170, scale: 3.2 },
    info: {
      title: 'Royal Red Download and Install Guide',
      author: 'Royal Red',
      subject: 'Installing Royal Red on Windows 11 via WSL2, Linux, and from source',
      keywords: `royal red, download, install, guide, linux, wsl2, mit, v${VERSION}`,
    },
    onPageMap: onMap,
  })

  const linesWith = (tocPages: number[] | null): PdfLine[] => {
    const sk = tocSkeleton()
    if (tocPages) {
      let i = 0
      for (const l of sk) if (l.style === 'toc') l.tocPage = tocPages[i++]
    }
    return [...cover(), ...sk, { text: '', style: 'body' }, ...body()]
  }

  let headingPages: { page: number; text: string }[] = []
  buildPdf(linesWith(null), { ...opts(), onPageMap: (e) => (headingPages = e) })
  const tocPages = SECTIONS.map((s) => headingPages.find((e) => e.text === s.heading)?.page ?? 1)
  const pdf = buildPdf(linesWith(tocPages), opts())
  const m = pdf.toString('latin1').match(/\/Count (\d+)/)
  return { pdf, pages: m ? Number(m[1]) : 1, toc: SECTIONS.map((s, i) => ({ text: s.heading, page: tocPages[i] })) }
}

function main() {
  const letter = process.argv.includes('--letter')
  const pageSize: PageSize = letter ? 'Letter' : 'A4'
  const { pdf, pages, toc } = buildDoc(pageSize)
  const outDir = path.join(process.cwd(), 'docs')
  mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, 'Royal-Red-Download-and-Install-Guide.pdf')
  writeFileSync(out, pdf)
  console.log(`written: ${out}`)
  console.log(`page size: ${pageSize}, pages: ${pages}`)
  console.log('toc:')
  for (const t of toc) console.log(`  ${t.page}: ${t.text}`)
  let dirty = 0
  for (const s of SECTIONS) for (const b of SECTIONS[0] ? s.blocks : []) if (enforceTextLaw(b.text).changed) dirty++
  console.log(`text law violations in copy: ${dirty}`)
  if (dirty > 0) process.exit(1)
}

main()
