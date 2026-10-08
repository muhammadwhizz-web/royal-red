'use client'

import { useId } from 'react'

// ROYAL RED signature (v1.8): the majestic crown. Hand-drawn, five points,
// jewels, gold-foil gradient, ribbon at the base. The crown is the signature
// mark: when the user sees it, it means "verified", "sealed", or "the
// sovereign did this". Rendered inline (build-integrity constraint: no asset
// fetch can fail), with per-instance gradient ids so any number of crowns can
// coexist on one screen without SVG id collisions.

export function RoyalCrown({ className, gold = true }: { className?: string; gold?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const bodyId = `rrc-body-${uid}`
  const bandId = `rrc-band-${uid}`
  const sheenId = `rrc-sheen-${uid}`

  // gold foil (the verified seal) vs ruby (the app tile identity)
  const body = gold
    ? { a: '#f7dd8a', b: '#d4a437', c: '#a16207' }
    : { a: '#fecaca', b: '#ef4444', c: '#991b1b' }
  const edge = gold ? 'rgba(124, 81, 3, 0.65)' : 'rgba(127, 29, 29, 0.55)'

  return (
    <svg viewBox="0 0 48 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={bodyId} x1="6" y1="4" x2="42" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor={body.a} />
          <stop offset="0.45" stopColor={body.b} />
          <stop offset="1" stopColor={body.c} />
        </linearGradient>
        <linearGradient id={bandId} x1="5" y1="29" x2="43" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor={body.b} />
          <stop offset="0.5" stopColor={body.a} />
          <stop offset="1" stopColor={body.c} />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* crown body: five points rising from the base */}
      <path
        d="M7.5 29.5 L4.8 11.5 L13.4 19.5 L15 7.2 L21 17.6 L24 4.2 L27 17.6 L33 7.2 L34.6 19.5 L43.2 11.5 L40.5 29.5 Z"
        fill={`url(#${bodyId})`}
        stroke={edge}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* soft sheen across the upper half of the body */}
      <path
        d="M7.5 29.5 L4.8 11.5 L13.4 19.5 L15 7.2 L21 17.6 L24 4.2 L27 17.6 L33 7.2 L34.6 19.5 L43.2 11.5 L40.5 29.5 Z"
        fill={`url(#${sheenId})`}
        opacity="0.22"
      />
      {/* tip jewels: orbs on all five points */}
      <circle cx="4.8" cy="10" r="1.7" fill={`url(#${bandId})`} stroke={edge} strokeWidth="0.6" />
      <circle cx="15" cy="5.8" r="1.9" fill={`url(#${bandId})`} stroke={edge} strokeWidth="0.6" />
      <circle cx="24" cy="3" r="2.1" fill={gold ? '#ef4444' : '#fbbf24'} stroke={edge} strokeWidth="0.6" />
      <circle cx="33" cy="5.8" r="1.9" fill={`url(#${bandId})`} stroke={edge} strokeWidth="0.6" />
      <circle cx="43.2" cy="10" r="1.7" fill={`url(#${bandId})`} stroke={edge} strokeWidth="0.6" />
      {/* base band */}
      <rect x="6.2" y="29.5" width="35.6" height="4.6" rx="1.6" fill={`url(#${bandId})`} stroke={edge} strokeWidth="0.8" />
      {/* center gem on the band */}
      <rect x="21.6" y="30.6" width="4.8" height="2.4" rx="1.2" fill={gold ? '#b91c1c' : '#fef2f2'} stroke={edge} strokeWidth="0.5" />
      {/* ribbon tails under the band */}
      <path d="M18 34.1 L15.4 38.4 L19.4 37.2 L21 34.1 Z" fill={`url(#${bodyId})`} stroke={edge} strokeWidth="0.5" strokeLinejoin="round" />
      <path d="M30 34.1 L32.6 38.4 L28.6 37.2 L27 34.1 Z" fill={`url(#${bodyId})`} stroke={edge} strokeWidth="0.5" strokeLinejoin="round" />
    </svg>
  )
}

// the verified seal: crown + word in a gold hairline chip (receipts that passed)
export function RoyalSeal({ label = 'verified' }: { label?: string }) {
  return (
    <span className="royal-seal font-mono text-[10px] uppercase tracking-[0.2em]">
      <RoyalCrown className="h-3 w-3" />
      {label}
    </span>
  )
}

// the app signature: crown in the ruby glass tile + display-serif wordmark
export function Signature({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls =
    size === 'lg'
      ? 'text-4xl sm:text-6xl tracking-[0.42em]'
      : size === 'sm'
        ? 'text-xs tracking-[0.34em]'
        : 'text-lg tracking-[0.38em]'
  const tile =
    size === 'lg'
      ? 'h-20 w-20 rounded-[1.5rem] mb-2'
      : size === 'sm'
        ? 'h-6 w-6 rounded-lg'
        : 'h-9 w-9 rounded-xl'
  const crown =
    size === 'lg'
      ? 'h-12 w-12'
      : size === 'sm'
        ? 'h-3.5 w-3.5'
        : 'h-5 w-5'
  return (
    <span className="flex select-none items-center gap-2.5" aria-label="ROYAL RED">
      <span
        className={`royalred-gloss-tile glass relative inline-flex shrink-0 items-center justify-center overflow-hidden ${tile}`}
        aria-hidden="true"
      >
        <RoyalCrown className={`${crown} drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]`} />
        {/* candy sheen */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      </span>
      <span className={`font-display font-semibold text-foreground ${cls}`}>
        ROYAL RED
        <span className="royalred-caret" aria-hidden="true" />
      </span>
    </span>
  )
}
