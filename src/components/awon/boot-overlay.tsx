'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Signature } from './signature'
import { useAwon } from './store'

const BOOT_LINES = [
  'awon kernel v1.2.0 (linux-native)',
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
  'verification 2.0: adversarial critic + visual regression ok',
  'proof bus: cms panel + 10-site benchmark harness ok',
  'linking llm core .................. ok',
  'all systems nominal',
]

export function BootOverlay() {
  const booted = useAwon((s) => s.booted)
  const setBooted = useAwon((s) => s.setBooted)
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
          <div className="awon-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative flex flex-col items-center gap-6 px-6">
            <Signature size="lg" />
            <p className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
              the operating system for agents
            </p>
            <div className="mt-2 h-[408px] w-full max-w-md font-mono text-[11px] leading-5 text-emerald-600 dark:text-emerald-400">
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
                className="awon-glow mt-2 rounded-md border border-emerald-600/50 bg-emerald-500/10 px-8 py-2.5 font-mono text-sm tracking-[0.3em] text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
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
