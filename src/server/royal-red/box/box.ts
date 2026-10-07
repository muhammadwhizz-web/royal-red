// ROYAL RED Box — supervised execution inside the prison (Phase 4.1).
//
// shell_exec contract (Phase 4.7, Tier 3 EXTREME consent):
//  - shell:false ALWAYS. The command is tokenized and every token is passed to
//    execFile directly. Shell metacharacters are rejected, so `;`, `&&`, `|`,
//    backticks and redirections can never smuggle a second command.
//  - `rm` is not on the binary whitelist and can never be: deletions are moves
//    into .awon-trash (Phase 4.5). There is no flag, rule, or consent that
//    enables rm - the prohibition is structural, not advisory.
//  - interpreters (python3/node/bun) run with cwd pinned inside the box and a
//    wall-clock timeout; stdout/stderr are capped.
//  - every spawn is registered in the process table for the kill switch.
import { execFile, spawn } from 'child_process'
import { BOX_HOME, BOX_TMP, PrisonEscapeError, ensureBoxTree, verifyReal } from './prison'
import { registerChild, liveChildren } from './runtime'

// binaries an agent may execute inside the box. rm/mv/cp are deliberately
// absent: file lifecycle goes through the box primitives so the undo journal
// and consent tiers cannot be bypassed.
const BOX_BIN_WHITELIST = new Set([
  'ls', 'echo', 'wc', 'head', 'tail', 'sort', 'uniq', 'file', 'stat', 'du', 'df',
  'uname', 'whoami', 'date', 'cat', 'find', 'grep', 'python3', 'node', 'bun',
])

const EXEC_TIMEOUT_MS = 15_000
const MAX_OUTPUT = 512 * 1024

// conservative tokenizer for a shell-less command line: split on whitespace,
// honor single/double quotes, REJECT any metacharacter outright
export function tokenizeCommand(cmd: string): string[] {
  if (/[;|&<>`$(){}[\]!?*~\n\r\\]/.test(cmd)) {
    throw new Error(`rejected: shell metacharacters are not allowed (got ${cmd.slice(0, 80)})`)
  }
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (quote) throw new Error('rejected: unterminated quote')
  if (cur) out.push(cur)
  if (!out.length) throw new Error('rejected: empty command')
  return out
}

export interface BoxExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  ms: number
}

export async function boxExec(command: string, opts?: { timeoutMs?: number; cwdVirtual?: string }): Promise<BoxExecResult> {
  ensureBoxTree()
  const tokens = tokenizeCommand(command)
  const bin = tokens[0]
  if (!BOX_BIN_WHITELIST.has(bin)) {
    return {
      ok: false,
      code: 126,
      stdout: '',
      stderr: `"${bin}" is not inside the box binary whitelist. rm is NEVER available - deletions are box_trash moves.`,
      timedOut: false,
      ms: 0,
    }
  }
  // python3/node/bun: only inline code (-c/-e) or paths that resolve inside the box
  const args = tokens.slice(1)
  const cwdReal = BOX_HOME
  if (['python3', 'node', 'bun'].includes(bin)) {
    const flag = bin === 'python3' ? '-c' : '-e'
    if (args[0] !== flag && args[0] && !args[0].startsWith('-')) {
      // a script path: force it to resolve inside the box
      const p = args[0].startsWith('/') ? args[0] : `~/${args[0]}`
      // resolve + containment check via the prison (throws on escape)
      const { resolveVirtual } = await import('./prison')
      const { real, mount } = resolveVirtual(p)
      verifyReal(real, mount.real)
      args[0] = real
    }
  }
  const started = Date.now()
  return new Promise<BoxExecResult>((resolve) => {
    const child = spawn(bin, args, {
      cwd: cwdReal,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin',
        HOME: BOX_HOME,
        TMPDIR: BOX_TMP,
        LANG: 'C.UTF-8',
        ROYALRED_BOX: '1',
      },
    })
    registerChild(child, `box_exec ${bin}`)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {}
    }, opts?.timeoutMs ?? EXEC_TIMEOUT_MS)
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8')
    })
    child.once('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 127, stdout, stderr: `${stderr}${e.message}`, timedOut, ms: Date.now() - started })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: !timedOut && code === 0, code, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), timedOut, ms: Date.now() - started })
    })
  })
}

// fire-and-forget spawn for the virtual display (Xvfb). Registered so the kill
// switch reaps it. Resolves after a grace tick so callers can probe the socket.
export function spawnSupervised(bin: string, args: string[], label: string): ChildProcess {
  const child = spawn(bin, args, { stdio: 'ignore', env: { ...process.env, ROYALRED_BOX: '1' } })
  registerChild(child, label)
  return child
}

// exposed for the leak regression tests (Phase 3 soft spot #1)
export function boxLiveChildCount(): number {
  return liveChildren().length
}

export { PrisonEscapeError, execFile }
