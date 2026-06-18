import { Badge } from '@/components/ui/badge'
import type { Band, Severity, Confidence } from '@/lib/analysis/types'

const BAND_TONE: Record<Band, 'good' | 'watch' | 'risk'> = {
  healthy: 'good',
  watch: 'watch',
  leaking: 'risk',
}

export function BandBadge({ band, label }: { band: Band; label: string }) {
  return (
    <Badge tone={BAND_TONE[band]} dot>
      {label}
    </Badge>
  )
}

const SEVERITY: Record<Severity, { tone: 'good' | 'watch' | 'risk'; label: string }> = {
  high: { tone: 'risk', label: 'High impact' },
  medium: { tone: 'watch', label: 'Medium impact' },
  low: { tone: 'good', label: 'Low impact' },
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <Badge tone={s.tone} dot size="sm">
      {s.label}
    </Badge>
  )
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const label = `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`
  return (
    <Badge tone="neutral" size="sm">
      {label}
    </Badge>
  )
}
