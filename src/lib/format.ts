/** Formatting helpers - used everywhere money/metrics are shown. */

export function usd(n: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n)
}

/** Compact money for tight spaces: $8.4k, $1.2M */
export function usdCompact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n)
}

export function usdRange(low: number, high: number): string {
  return `${usd(low)}–${usd(high)}`
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

/** 1_240_000 -> 1.24M tokens */
export function tokens(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(n)
}

export function dateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''))
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}
