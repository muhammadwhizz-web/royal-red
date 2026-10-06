'use client'

// AWON signature: pure text wordmark, deliberately no logo.
export function Signature({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls =
    size === 'lg'
      ? 'text-5xl sm:text-7xl tracking-[0.42em]'
      : size === 'sm'
        ? 'text-xs tracking-[0.34em]'
        : 'text-lg tracking-[0.38em]'
  return (
    <span
      className={`font-mono font-bold select-none text-foreground ${cls}`}
      aria-label="AWON"
    >
      AWON
      <span className="awon-caret" aria-hidden="true" />
    </span>
  )
}
