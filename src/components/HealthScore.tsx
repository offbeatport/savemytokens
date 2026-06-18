import { cn } from '@/lib/utils'
import type { Band } from '@/lib/analysis/types'

const BAND_COLOR: Record<Band, string> = {
  healthy: 'var(--color-good)',
  watch: 'var(--color-watch)',
  leaking: 'var(--color-risk)',
}

/** Signature circular health-score gauge (0–100). */
export function HealthScore({
  score,
  band,
  label,
  size = 168,
  className,
}: {
  score: number
  band: Band
  label?: string
  size?: number
  className?: string
}) {
  const stroke = size > 130 ? 12 : 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const color = BAND_COLOR[band]

  return (
    <div
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`AI spend health score ${Math.round(score)} of 100${label ? ` - ${label}` : ''}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-sunken)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-display leading-none tnum" style={{ fontSize: size * 0.3, color }}>
            {Math.round(score)}
          </div>
          <div className="mt-1 text-xs font-medium text-faint tnum">/ 100</div>
          {label && <div className="mt-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{label}</div>}
        </div>
      </div>
    </div>
  )
}
