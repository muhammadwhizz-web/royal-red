'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RoyalCrown } from './signature'
import { useRoyalRed } from './store'

// ROYAL RED boot v1.8: a royal court assembling. The crown arrives with a
// gold shimmer, the wordmark renders in the display serif, and one line per
// subsystem appears in the mono font, each sealed with a small crown the
// moment it completes. INITIALIZE is engraved stone with gold leaf on hover.
// No emojis. No em dashes. Reduced-motion respected.

const BOOT_LINES = [
  'royal red kernel v1.8.1 (majestic) .......... ok',
  'mounting sandbox workspace .................. ok',
  'loading tool bus: search fs shell accounts .. ok',
  'linking vision core: image gen + vlm eyes ... ok',
  'linking web reader: open pages, read ........ ok',
  'wiring session memory: titles, history ...... ok',
  'export engines: markdown pdf csv diff ....... ok',
  'builder loop: plan, build, verify 10/10 ..... ok',
  'constraint ledger: testable assertions ...... ok',
  'verification 2.0: critic + visual regression  ok',
  'proof bus: cms crud + 10-site benchmark ..... ok',
  'royal red box: path prison, rw/ro mount ..... ok',
  'dry-run is the product: unproposable = never  ok',
  'consent tiers: T1 read / T2 write / T3 ...... ok',
  'undo journal: 7-day ttl, no rm .............. ok',
  'kill switch: abort queue + sigterm + freeze . ok',
  'provider matrix: 66 providers, 7 modalities . ok',
  'router: capability requests + fallback ...... ok',
  'rotation: 5 mid-stream drops survive ........ ok',
  'event log: append-only, replayable .......... ok',
  'policy waterfall: 5 layers, monotonic ....... ok',
  'llm seam: every call behind one door ........ ok',
  'provider key: option b, same-family ceiling . ok',
  'phase 5 slice 1: planner + builder aboard ... ok',
  'sub-agent law: every action names who ....... ok',
  'kernel caps: depth 2 / width 4 / budget/run . ok',
  'kill verbs: abort session / abort / pause ... ok',
  'memory store: persistent, scoped, private ... ok',
  'agent employees: 66 royal roles, one crown .. ok',
  'roster law: every run carries a named role .. ok',
  'website builder: multi-page, cms crud law ... ok',
  'overlap gate: no element covers another ..... ok',
  'wordpress builder: theme + package, honest .. ok',
  'pdf engine: typography, no-overlap, vector .. ok',
  'response protocol: no emoji, no em dash ..... ok',
  'signature ui v1.8: crown, damask, gold seal . ok',
  'install: one command, launcher, docker ...... ok',
  'typography law: display serif / ui / mono ... ok',
  'all systems nominal',
]

export function BootOverlay() {
  const booted = useRoyalRed((s) => s.booted)
  const setBooted = useRoyalRed((s) => s.setBooted)
  const [shown, setShown] = useState(0)
  const done = shown >= BOOT_LINES.length

  useEffect(() => {
    if (booted || done) return
    const t = setTimeout(() => setShown((n) => n + 1), 150)
    return () => clearTimeout(t)
  }, [shown, booted, done])

  // clicking the log fast-forwards the court assembly (hasten, not skip:
  // every line still seals before INITIALIZE appears)
  const hasten = () => setShown(BOOT_LINES.length)

  return (
    <AnimatePresence>
      {!booted && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.5 }}
        >
          <div className="royalred-aurora" aria-hidden="true" />
          <div className="royalred-damask pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="royalred-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
          {/* viewport-adaptive: short screens shrink the emblem and the log so
              INITIALIZE never lands below the fold */}
          <div className="relative flex max-h-full flex-col items-center gap-4 overflow-y-auto px-6 py-4 max-sm:gap-3">
            {/* the crown arrives, then rests with its gold shimmer */}
            <div className="crown-arrive crown-shimmer rounded-full p-2 max-sm:p-1" aria-hidden="true">
              <RoyalCrown className="h-16 w-16 drop-shadow-[0_4px_14px_rgba(212,164,55,0.35)] max-h-[12vh] max-w-[12vh] min-h-10 min-w-10" />
            </div>
            <div className="crown-arrive flex flex-col items-center gap-2" style={{ animationDelay: '0.15s' }}>
              <h1 className="font-display text-4xl font-semibold tracking-[0.45em] text-foreground sm:text-5xl">
                ROYAL RED
              </h1>
              <div className="gold-hairline w-56" aria-hidden="true" />
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                the operating system for agents
              </p>
            </div>
            <div
              className="glass h-[min(420px,42vh)] w-full max-w-md shrink cursor-pointer overflow-y-auto rounded-3xl p-4 pr-5 font-mono text-[11px] leading-5 text-red-600 [scrollbar-color:theme(colors.red.600)_transparent] [scrollbar-width:thin] dark:text-red-400"
              onClick={hasten}
              role="button"
              aria-label="Boot log, click to hasten"
            >
              {BOOT_LINES.slice(0, shown).map((l) => (
                <div key={l} className="flex items-center gap-1.5 whitespace-nowrap">
                  <RoyalCrown className="h-2.5 w-2.5 shrink-0" />
                  <span>{l}</span>
                </div>
              ))}
              {!done && (
                <div className="royalred-breathe mt-1 text-[10px] text-muted-foreground">
                  the court is assembling (click to hasten)
                </div>
              )}
            </div>
            {done && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={setBooted}
                className="btn-engraved mt-1 shrink-0 px-12 py-3 text-sm max-sm:px-8"
              >
                INITIALIZE
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
