// ROYAL RED Phase A: generates docs/Royal-Red-Installation-Guide.pdf using the
// kernel's own PDF engine (embedded fonts, no-overlap flow, two-pass TOC,
// running headers, vector crown). This file IS the proof that the engine can
// produce the project's own documentation: no LaTeX, no Pandoc, no external
// library touches this document.
//
// Run: bun scripts/generate-installation-guide.ts [--letter]
// Out: docs/Royal-Red-Installation-Guide.pdf

import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { buildPdf, PAGE_SIZES, type PdfLine, type PageSize } from '../src/server/royal-red/pdf'
import { enforceTextLaw } from '../src/server/royal-red/text-law'

const VERSION = '1.8.1'

// the ten sections of the manual, written for a reader who has never used a
// terminal. Plain English. No em dashes. No emojis. Every claim true.
const SECTIONS: { heading: string; blocks: PdfLine[] }[] = [
  {
    heading: '1. What Royal Red is',
    blocks: [
      {
        text: 'Royal Red is an agentic operating system that lives on your machine, verifies its own work, and gives you honest receipts for everything it builds.',
        style: 'sub',
      },
      {
        text: 'It runs on your machine. The agent works inside a fenced workspace on your own computer, under rules it cannot rewrite: every file it touches stays inside a permitted path set, every privileged action asks you first, and every step lands in an audit log you can read. Your files do not leave your machine, and there is no account to create.',
        style: 'body',
      },
      {
        text: 'It verifies its own work. When Royal Red builds a website, a document, or a tool, it does not just claim the result works. It opens the result in a real browser, checks the structure, measures the layout for overlaps, and runs the checks you would run yourself. The verification report is attached to the build.',
        style: 'body',
      },
      {
        text: 'It gives you honest receipts. Every finished task carries a receipt with a crown seal. The seal appears only when verification actually passed. If something was not verified, the receipt says so in plain words. A missing seal is information, not a failure to hide.',
        style: 'body',
      },
    ],
  },
  {
    heading: '2. Before you begin',
    blocks: [
      { text: 'What you need', style: 'sub' },
      {
        text: 'A Linux computer: Debian, Ubuntu, Fedora, or a close relative. Windows 11 also works through WSL2, which Section 4 walks through step by step. About 500 MB of free disk space. An internet connection for the initial install. A normal user account with permission to install software.',
        style: 'body',
      },
      { text: 'What you do not need', style: 'sub' },
      {
        text: 'You do not need an API key. Royal Red runs in its built-in fallback mode without one, and you can add a key later if you want the full verification strength (Section 7 explains how). You do not need a powerful machine; any modern CPU is fine. You do not need prior terminal experience; this guide walks through every step, including opening a terminal.',
        style: 'body',
      },
      { text: 'A one-paragraph orientation', style: 'sub' },
      {
        text: 'A terminal is a window where you type commands and press Enter. That is all you will do here: paste one command to install, then type one short word to launch. Everything after that happens in your web browser, where Royal Red runs as a local web console.',
        style: 'body',
      },
    ],
  },
  {
    heading: '3. Installing on Linux',
    blocks: [
      { text: 'Step 1: Open a terminal', style: 'sub' },
      {
        text: 'On Ubuntu, press the Super key (the one with the Windows or Command logo), type terminal, and press Enter. On Fedora, click Activities in the top left, type terminal, and press Enter. A window with a blinking cursor appears. That window is where you paste the next command.',
        style: 'body',
      },
      { text: 'Step 2: Run the installer', style: 'sub' },
      {
        text: 'Paste this line into the terminal and press Enter:',
        style: 'body',
      },
      { text: 'curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash', style: 'code' },
      {
        text: 'What you should see: a short series of lines, each ending in ok, ending with a message that says Royal Red installed. The installer checks your operating system, installs the Bun runtime if it is missing, downloads Royal Red into a folder named royal-red inside your home directory, and adds a command named royal-red to your PATH. If curl is missing, the installer prints the exact command to install it for your distribution; run that command, then run the installer again.',
        style: 'body',
      },
      { text: 'Step 3: Verify the install', style: 'sub' },
      { text: 'Close the terminal and open a new one (so the PATH refreshes), then run:', style: 'body' },
      { text: 'royal-red --version', style: 'code' },
      {
        text: 'What you should see: one line like Royal Red 1.8.1. If instead you see command not found, sign out and sign back in, or close and reopen the terminal; the installer adds the command to your user PATH and a fresh shell picks it up.',
        style: 'body',
      },
      { text: 'Step 4: First launch', style: 'sub' },
      { text: 'Run:', style: 'body' },
      { text: 'royal-red', style: 'code' },
      {
        text: 'What you should see: a line saying the server is starting, then your default web browser opens at http://localhost:3000 and the Royal Red boot screen appears with a gold crown. The terminal returns control immediately; the server keeps running in the background. Section 5 continues from here.',
        style: 'body',
      },
      {
        text: 'Fedora and RHEL family: the same command works. The installer detects dnf and uses it when git or curl must be added. Debian and Ubuntu family: the installer uses apt the same way. Nothing is installed system-wide beyond the Bun runtime in your home directory and the royal-red command in ~/.local/bin.',
        style: 'body',
      },
    ],
  },
  {
    heading: '4. Installing on Windows 11 (via WSL2)',
    blocks: [
      {
        text: 'WSL2 is the Windows Subsystem for Linux, version 2. It runs a real Ubuntu system inside Windows 11, and it is the supported way to use Royal Red on Windows. Everything from Section 3 works the same once Ubuntu is installed.',
        style: 'body',
      },
      { text: 'Step 1: Install WSL2', style: 'sub' },
      { text: 'Click Start, type powershell, right click Windows PowerShell, and choose Run as administrator. Paste this command and press Enter:', style: 'body' },
      { text: 'wsl --install', style: 'code' },
      {
        text: 'What you should see: progress messages as Windows enables the subsystem and downloads Ubuntu. When it finishes, restart the computer. After the restart an Ubuntu window opens and asks you to create a username and password for the Linux side. These are separate from your Windows login; pick anything you like and remember the password.',
        style: 'body',
      },
      { text: 'Step 2: Open Ubuntu', style: 'sub' },
      {
        text: 'Click Start, type Ubuntu, and press Enter. A terminal window opens. This window is a full Ubuntu system. For a better terminal experience, install Windows Terminal from the Microsoft Store; it is free and made by Microsoft, and it manages Ubuntu tabs nicely. Ubuntu 22.04 or 24.04 are the recommended distributions; both work with the standard wsl --install default.',
        style: 'body',
      },
      { text: 'Step 3: Run the installer', style: 'sub' },
      { text: 'In the Ubuntu window, paste the same one-line installer from Section 3:', style: 'body' },
      { text: 'curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash', style: 'code' },
      {
        text: 'What you should see: the same ok lines as on Linux. The installer detects that it runs inside WSL and also installs wslu, a small package that provides wslview, the bridge that lets the Linux side open pages in your Windows browser.',
        style: 'body',
      },
      { text: 'Step 4: Launch', style: 'sub' },
      { text: 'In the Ubuntu window, run:', style: 'body' },
      { text: 'royal-red', style: 'code' },
      {
        text: 'What you should see: the server starts, and your default Windows browser (Edge, Chrome, or Firefox, whichever you use) opens at http://localhost:3000 with the boot screen. WSL2 forwards localhost ports to Windows automatically; no configuration is needed. If the browser does not open by itself, open it manually and type localhost:3000 in the address bar.',
        style: 'body',
      },
      { text: 'Two notes for Windows users', style: 'sub' },
      {
        text: 'Keep Royal Red inside the WSL filesystem. The installer already does this: it installs to ~/.royal-red inside Ubuntu, not under /mnt/c. Working on the Linux filesystem is many times faster and avoids permission oddities. Windows Firewall: the server binds to localhost only, so no firewall prompt should appear. If one does, allow access on private networks; Royal Red never listens on the public internet.',
        style: 'body',
      },
    ],
  },
  {
    heading: '5. First launch',
    blocks: [
      {
        text: 'Run royal-red. A short boot sequence prints while the court assembles: the kernel, the verification engine, the provider matrix, and the workspace all come online, each line ending in ok. Your browser then opens to the console.',
        style: 'body'},
      { text: 'The boot screen', style: 'sub' },
      {
        text: 'A dark burgundy field with a drifting red aurora. A gold crown arrives at the top. Below it, the word ROYAL RED in a display serif, and a column of small monospaced boot lines, each sealed with a tiny crown. At the bottom sits one engraved button: INITIALIZE. Click it. The overlay lifts and the console appears.',
        style: 'body',
      },
      { text: 'The console', style: 'sub' },
      {
        text: 'The console is a single dark page with three regions. The left column is the conversation: you type at the bottom in the composer dock, replies stream in above. The right side is a panel with tabs: PREVIEW, FILES, VERIFY, SYSTEM, DESKTOP, PROVIDERS, ROUTER, EVENTS, MEMORY, and AGENTS. The top bar carries the sessions history, the palette (Ctrl and K together opens it), and the crown. The footer states the version and the invariant names. Everything is reachable: history from the top bar, panels from the right edge or the palette.',
        style: 'body',
      },
      {
        text: 'Do not worry about breaking anything. Every privileged action asks you first with a consent card that names exactly what will happen, and an undo journal lets you roll back file changes. The kill switch in the SYSTEM panel stops everything instantly.',
        style: 'body',
      },
    ],
  },
  {
    heading: '6. Your first task',
    blocks: [
      { text: 'Type a prompt', style: 'sub' },
      {
        text: 'In the composer at the bottom, type: build me a landing page for a coffee shop. Press Enter. Royal Red answers with a plan rail: the steps it intends to take, and a constraint ledger: the rules it will hold itself to for this task, such as no overlapping elements, working navigation, and mobile support.',
        style: 'body',
      },
      { text: 'Watch the build', style: 'sub' },
      {
        text: 'The builder writes the files into its workspace. You can watch names appear in the FILES tab. When the draft is ready, the PREVIEW tab shows the page in a real browser context. The verification engine then takes over: it loads the page at desktop, tablet, and phone widths, checks the structure and accessibility basics, and probes the layout for overlapping elements.',
        style: 'body',
      },
      { text: 'Read the receipt', style: 'sub' },
      {
        text: 'When verification finishes, the reply carries a receipt. If the checks passed, the receipt carries the gold crown seal and lists what was verified: the pages, the viewport widths, the checks that ran. If something did not pass, the seal is absent and the receipt says exactly what failed and what will be retried. You can click UNDO on any step to roll it back, and the EVENTS tab shows the full ordered story of what the agent did, attributed to the sub-agent that did it.',
        style: 'body',
      },
      {
        text: 'That is the whole loop: prompt, ledger, build, verify, receipt. Everything Royal Red builds for you, from flashcard decks to WordPress themes, follows the same shape, so the first task teaches the interface for all of them.',
        style: 'body',
      },
    ],
  },
  {
    heading: '7. Configuring providers (optional)',
    blocks: [
      {
        text: 'Royal Red ships with a built-in provider so it works out of the box. Adding your own API key unlocks the full provider matrix and the strongest verification tier, where the critic that reviews a build comes from an independent provider.',
        style: 'body',
      },
      { text: 'Adding a key', style: 'sub' },
      {
        text: 'Open the PROVIDERS panel in the console, choose your provider (OpenAI, Anthropic, Google, and 60 more are in the matrix), and paste your key. Keys are encrypted with AES-256-GCM before they touch disk and never leave your machine; requests go directly from your computer to the provider you chose. Typical light usage costs roughly 5 to 10 US dollars per month.',
        style: 'body',
      },
      { text: 'What the receipt tells you', style: 'sub' },
      {
        text: 'Receipts name the verification tier. SAME-FAMILY FRESH CONTEXT means the critic reviewed the work with a fresh context from the same provider family; it is the honest ceiling when no second key exists. INDEPENDENT PROVIDER means the critic came from a different provider entirely, which is the strongest tier. If you add one OpenAI or Anthropic key, the next build with a critic step is marked INDEPENDENT PROVIDER automatically.',
        style: 'body',
      },
      { text: 'Local models with Ollama', style: 'sub' },
      {
        text: 'If you run Ollama on the same machine, Royal Red can route to it: install Ollama from ollama.com, pull a model such as llama3.1, then enable the Ollama provider in the PROVIDERS panel. Local routes cost nothing and keep every byte on your machine; they trade some capability for that privacy. The ROUTER panel shows which provider handled each call and what it cost.',
        style: 'body',
      },
    ],
  },
  {
    heading: '8. Common tasks',
    blocks: [
      { text: 'A quick reference, one line each. Run these in a terminal.', style: 'body' },
      { text: 'royal-red              start the server and open the console', style: 'code' },
      { text: 'royal-red status       is it running, which port, since when', style: 'code' },
      { text: 'royal-red stop         stop the server gracefully', style: 'code' },
      { text: 'royal-red restart      stop, then start', style: 'code' },
      { text: 'royal-red logs         follow the server log (Ctrl C to stop following)', style: 'code' },
      { text: 'royal-red update       pull the latest code, migrate the database, restart', style: 'code' },
      { text: 'royal-red --version    print the version', style: 'code' },
      { text: 'royal-red --help       list every command', style: 'code' },
      { text: 'Backups and resets', style: 'sub' },
      {
        text: 'Your data lives in ~/.royal-red/data: the SQLite database, your uploaded files, and the artifacts the agent built. To back up, copy that folder somewhere safe while the server is stopped. To reset the database to empty, stop the server, delete ~/.royal-red/data/royal-red.db, and start again; the schema is recreated on boot. To remove Royal Red entirely, run install.sh --uninstall, which asks before deleting your data.',
        style: 'body',
      },
    ],
  },
  {
    heading: '9. Troubleshooting',
    blocks: [
      { text: 'Port already in use', style: 'sub' },
      {
        text: 'The launcher tries ports 3000 through 3010 in order and tells you which one it picked. If all are taken it fails with a clear message: stop the other service, or set the port in ~/.royal-red/config.toml.',
        style: 'body',
      },
      { text: 'Bun not found after install', style: 'sub' },
      {
        text: 'A shell opened before the install does not know the new PATH. Close the terminal and open a new one. If it still fails, run: export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" and then try again, or sign out and back in.',
        style: 'body',
      },
      { text: 'Browser does not open', style: 'sub' },
      {
        text: 'On minimal Linux systems there may be no xdg-open. The launcher prints the URL instead; open http://localhost:3000 manually. On WSL2, install the wslu package (the installer does this for you) so wslview can reach the Windows browser.',
        style: 'body',
      },
      { text: 'Permissions errors', style: 'sub' },
      {
        text: 'The installer never needs sudo except when it must add curl or git through your package manager, and it tells you the exact command before asking. If you see EACCES errors on ~/.royal-red, someone once ran the server with sudo and left root-owned files; fix with: sudo chown -R "$USER" ~/.royal-red',
        style: 'body',
      },
      { text: 'WSL2 network issues', style: 'sub' },
      {
        text: 'If Windows cannot reach localhost:3000, restart WSL: in PowerShell run wsl --shutdown, then reopen Ubuntu and start Royal Red again. WSL2 forwards localhost automatically on default settings.',
        style: 'body',
      },
      { text: 'Provider key rejected', style: 'sub' },
      {
        text: 'Check the key for a trailing space or an unfinished paste. The PROVIDERS panel shows the exact error the provider returned. A rejected key never blocks the console: Royal Red falls back to its built-in provider and the receipt says which tier ran.',
        style: 'body',
      },
      { text: 'Database locked', style: 'sub' },
      {
        text: 'SQLite locks briefly during heavy writes. If you see a locked error, stop the server with royal-red stop, wait five seconds, and start again. Two servers on the same data directory cause this; the launcher prevents a second instance, but a manually started one does not.',
        style: 'body',
      },
      { text: 'Disk full', style: 'sub' },
      {
        text: 'Artifacts and logs grow over time. Logs rotate automatically at 10 MB with 5 files kept. For the data directory, check sizes with: du -sh ~/.royal-red/data/*  and delete old artifacts you no longer want; the audit journal rebuilds cleanly without them.',
        style: 'body',
      },
      { text: 'Update fails', style: 'sub' },
      {
        text: 'royal-red update refuses to discard local changes; it tells you when it finds any. If an update is interrupted, run it again: every step (fetch, install, database push, restart) is safe to repeat.',
        style: 'body',
      },
      { text: 'Uninstall leaves files behind', style: 'sub' },
      {
        text: 'install.sh --uninstall removes the application, the command, the desktop entry, the icons, and with your confirmation the data directory. Logs and backups you created elsewhere are yours to delete; the uninstaller lists anything it did not touch.',
        style: 'body',
      },
    ],
  },
  {
    heading: '10. Where to get help',
    blocks: [
      {
        text: 'The project repository is the first stop: it carries this guide, the invariants document (docs/INVARIANTS.md), the skills catalog (docs/SKILLS-CATALOG.md), and the full architecture description (ROYAL-RED.md). File issues on the repository issue tracker: include your OS, the output of royal-red --version, and the last 50 lines of ~/.royal-red/logs/server.log.',
        style: 'body',
      },
      {
        text: 'The docs/INSTALL.md file in the repository covers the same ground as this guide in a format that renders on GitHub, including a shorter troubleshooting list. For license questions see the LICENSE file; for the provenance of the open patterns Royal Red learned from, see docs/LICENSE-AUDIT.md.',
        style: 'body',
      },
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
    // push the wordmark below the crown art (crown occupies roughly
    // y 544..672 on A4: yTop = pageH - 170, scale 3.2, height 40 * 3.2)
    for (let i = 0; i < 5; i++) out.push({ text: '', style: 'display' })
    for (let i = 0; i < 6; i++) out.push({ text: '', style: 'body' })
    out.push({ text: 'R O Y A L   R E D', style: 'display', align: 'center' })
    out.push({ text: '', style: 'body' })
    out.push({ text: 'Installation and Getting Started Guide', style: 'sub', align: 'center' })
    out.push({ text: '', style: 'body' })
    out.push({ text: `Version ${VERSION}`, style: 'dim', align: 'center' })
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
      // every section opens on a fresh page: roomier and printer-friendly
      out.push({ text: s.heading, style: 'heading', section: s.heading, pageBreakBefore: true })
      for (const b of s.blocks) out.push(b)
      out.push({ text: '', style: 'body' })
    }
    return out.map(lawLine)
  }

  const opts = (tocPages: number[] | null, onMap?: (e: { page: number; text: string }[]) => void) => ({
    pageSize,
    headerTitle: 'Installation and Getting Started Guide',
    footerNote: 'ROYAL RED INSTALLATION GUIDE',
    suppressChromeOnFirstPage: true,
    crown: { cx: size.w / 2, yTop: size.h - 170, scale: 3.2 },
    info: {
      title: 'Royal Red Installation and Getting Started Guide',
      author: 'Royal Red',
      subject: 'Installing and using Royal Red on Linux and Windows 11 via WSL2',
      keywords: `royal red, installation, guide, linux, wsl2, v${VERSION}`,
    },
    onPageMap: onMap,
    // toc pages injected into the skeleton lines
    ...(tocPages ? {} : {}),
  })

  const linesWith = (tocPages: number[] | null): PdfLine[] => {
    const sk = tocSkeleton()
    if (tocPages) {
      let i = 0
      for (const l of sk) if (l.style === 'toc') l.tocPage = tocPages[i++]
    }
    return [...cover(), ...sk, { text: '', style: 'body' }, ...body()]
  }

  // pass 1: collect heading pages; pass 2: emit with the true numbers
  let headingPages: { page: number; text: string }[] = []
  buildPdf(linesWith(null), { ...opts(null), onPageMap: (e) => (headingPages = e) })
  const tocPages = SECTIONS.map((s) => headingPages.find((e) => e.text === s.heading)?.page ?? 1)
  const pdf = buildPdf(linesWith(tocPages), opts(tocPages))
  const m = pdf.toString('latin1').match(/\/Count (\d+)/)
  return { pdf, pages: m ? Number(m[1]) : 1, toc: SECTIONS.map((s, i) => ({ text: s.heading, page: tocPages[i] })) }
}

function main() {
  const letter = process.argv.includes('--letter')
  const pageSize: PageSize = letter ? 'Letter' : 'A4'
  const { pdf, pages, toc } = buildDoc(pageSize)
  const outDir = path.join(process.cwd(), 'docs')
  mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, 'Royal-Red-Installation-Guide.pdf')
  writeFileSync(out, pdf)
  console.log(`written: ${out}`)
  console.log(`page size: ${pageSize}, pages: ${pages}`)
  console.log('toc:')
  for (const t of toc) console.log(`  ${t.page}: ${t.text}`)
  // honest self-check: the text law must find nothing left to rewrite
  let dirty = 0
  for (const s of SECTIONS) for (const b of s.blocks) if (enforceTextLaw(b.text).changed) dirty++
  console.log(`text law violations in copy: ${dirty}`)
  if (dirty > 0) process.exit(1)
}

main()
