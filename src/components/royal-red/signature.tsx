'use client'

// ROYAL RED signature: crown glyph in a glossy glass tile + pure text wordmark.
// The crown is inline SVG (build-integrity sweep renders inline SVGs; no asset
// fetch can fail), the tile reuses the v1.7 glass system for the Apple finish.
export function Signature({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls =
    size === 'lg'
      ? 'text-4xl sm:text-6xl tracking-[0.42em]'
      : size === 'sm'
        ? 'text-xs tracking-[0.34em]'
        : 'text-lg tracking-[0.38em]'
  const tile =
    size === 'lg'
      ? 'h-16 w-16 rounded-[1.25rem] mb-1'
      : size === 'sm'
        ? 'h-6 w-6 rounded-lg'
        : 'h-9 w-9 rounded-xl'
  const crown =
    size === 'lg'
      ? 'h-8 w-8'
      : size === 'sm'
        ? 'h-3 w-3'
        : 'h-4.5 w-4.5'
  return (
    <span className="flex select-none items-center gap-2.5" aria-label="ROYAL RED">
      <span
        className={`royalred-gloss-tile glass relative inline-flex shrink-0 items-center justify-center overflow-hidden ${tile}`}
        aria-hidden="true"
      >
        {/* ruby crown, drawn inline so it can never fail to load */}
        <svg viewBox="0 0 24 24" fill="none" className={`${crown} drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]`}>
          <path
            d="M3 8.5 6.2 11.2 9.1 6.4c.6-1 2-1.1 2.7-.2l0.2 0.2 2.9 4.8L18 8.5c.9-.7 2.2 0 2.1 1.1l-.9 7.2c-.1.7-.7 1.2-1.4 1.2H6.2c-.7 0-1.3-.5-1.4-1.2l-.9-7.2C3.8 8.5 5.1 7.8 6 8.5Z"
            fill="url(#rr-crown-fill)"
            stroke="rgba(127,29,29,0.55)"
            strokeWidth="0.75"
            strokeLinejoin="round"
          />
          <circle cx="6.2" cy="6.2" r="1.15" fill="url(#rr-crown-fill)" />
          <circle cx="12" cy="4.1" r="1.3" fill="url(#rr-crown-fill)" />
          <circle cx="17.8" cy="6.2" r="1.15" fill="url(#rr-crown-fill)" />
          <defs>
            <linearGradient id="rr-crown-fill" x1="3" y1="4" x2="21" y2="18" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fca5a5" />
              <stop offset="0.45" stopColor="#ef4444" />
              <stop offset="1" stopColor="#991b1b" />
            </linearGradient>
          </defs>
        </svg>
        {/* candy sheen */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      </span>
      <span className={`font-mono font-bold text-foreground ${cls}`}>
        ROYAL RED
        <span className="royalred-caret" aria-hidden="true" />
      </span>
    </span>
  )
}
