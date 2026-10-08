'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Signature } from './signature'
import { useRoyalRed } from './store'

const BOOT_LINES = [
  'royal red kernel v1.7.0 (glass crown ui)',
  'mounting sandbox workspace ......... ok',
  'loading tool bus: search fs shell accounts ok',
  'linking vision core: image gen + vlm eyes ok',
  'linking video core: watch mp4 webm mov ... ok',
  'linking web reader: open pages read articles ok',
  'mounting upload bus: drag drop attach ok',
  'wiring session memory: titles history retry ok',
  'pinning session index: pin export palette ok',
  'loading local command line: /help /new /theme /export ok',
  'console telemetry: /stats mode filters date groups ok',
  'export engines: markdown pdf csv diff view ok',
  'console focus: panel toggle workspace search ok',
  'loading builder loop: plan build verify 10/10 ok',
  'constraint ledger: extracting testable assertions ok',
  'verification 2.0: critic + visual regression ok',
  'proof bus: cms panel + 10-site benchmark harness ok',
  'royal red box: path-prison emulation mount table rw/ro ok',
  'dry-run is the product: unproposable ops never run ok',
  'consent tiers: T1 read / T2 write / T3 per-action ok',
  'undo journal: .awon-trash 7-day ttl no rm ok',
  'kill switch: abort queue + sigterm + freeze ok',
  'desktop mission control: /desktop tab always-abort ok',
  'provider matrix: 66 providers x 7 modalities ok',
  'router: capability requests + fallback chain ok',
  'rotation: 5 mid-stream drops survive, partial kept ok',
  'dsh port 1: session event log append-only replayable ok',
  'dsh port 2: policy waterfall 5 layers monotonic ok',
  'dsh port 3: llm seam all calls behind one door ok',
  'dsh port 4: sandbox roots declarative per-scope ok',
  'invariants doc: every claim cites its test ok',
  'provider key: option b - same-family fresh context ceiling ok',
  'run queue: n runs per session + per-run scalpel ok',
  'css guard: served stylesheet asserted each boot ok',
  'phase 5 slice 1: planner + builder sub-agents aboard ok',
  'sub-agent law: every action names who + who sent it ok',
  'kernel caps: depth 2 / width 4 / budget per run ok',
  'kill switch verbs: abort session / abort agent / pause ok',
  'signature ui v1.7: aurora + glass islands + segmented panels ok',
  'feature access: 8 panels + history on the ctrl+k palette ok',
  'skill catalog: products + provider services documented ok',
  'linking llm core .................. ok',
  'all systems nominal',
]

export function BootOverlay() {
  const booted = useRoyalRed((s) => s.booted)
  const setBooted = useRoyalRed((s) => s.setBooted)
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (booted) return
    if (shown >= BOOT_LINES.length) return
    const t = setTimeout(() => setShown((n) => n + 1), 260)
    return () => clearTimeout(t)
  }, [shown, booted])

  return (
    <AnimatePresence>
      {!booted && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.5 }}
        >
          <div className="royalred-aurora" aria-hidden="true" />
          <div className="royalred-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative flex flex-col items-center gap-6 px-6">
            <Signature size="lg" />
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              the operating system for agents
            </p>
            <div className="glass h-[520px] w-full max-w-md overflow-y-auto rounded-3xl p-4 pr-5 font-mono text-[11px] leading-5 text-red-600 [scrollbar-color:theme(colors.red.600)_transparent] [scrollbar-width:thin] dark:text-red-400">
              {BOOT_LINES.slice(0, shown).map((l) => (
                <div key={l} className="whitespace-nowrap">
                  <span className="text-muted-foreground">[</span> ok{' '}
                  <span className="text-muted-foreground">]</span> {l}
                </div>
              ))}
            </div>
            {shown >= BOOT_LINES.length && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={setBooted}
                className="btn-glossy mt-2 rounded-full px-10 py-3 font-mono text-sm tracking-[0.3em]"
              >
                <span className="relative z-10">INITIALIZE</span>
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
