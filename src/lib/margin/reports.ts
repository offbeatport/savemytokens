/**
 * Reports as views over the ledger. The flagship is the Weekly AI CFO Report —
 * the recurring artifact. With a single ingest there is no baseline yet, so
 * deltas are omitted and flagged (they light up once a second period exists).
 */
import { usd, pct, num } from '@/lib/format'
import type {
  CfoSection,
  MarginHealth,
  MarginLeak,
  MarginLedger,
  Recommendation,
  WeeklyCfoReport,
} from './types'

const round = (n: number) => Math.round(n)

export function renderWeeklyCfo(
  ledger: MarginLedger,
  health: MarginHealth,
  leaks: MarginLeak[],
  recs: Recommendation[],
): WeeklyCfoReport {
  const sections: CfoSection[] = []
  const top = recs[0]
  const estimatedBusinessImpact = round(recs.slice(0, 5).reduce((a, r) => a + r.monthlyImpact, 0))

  if (ledger.coverage.hasRevenue) {
    sections.push({ label: 'Revenue', value: usd(ledger.totals.revenue) })
    sections.push({ label: 'AI cost', value: usd(ledger.totals.cost) })
    sections.push({
      label: 'Gross AI margin',
      value: `${usd(ledger.totals.margin)} · ${pct(ledger.totals.marginPct ?? 0)}`,
      tone: (ledger.totals.marginPct ?? 0) >= 50 ? 'good' : (ledger.totals.marginPct ?? 0) >= 0 ? 'watch' : 'risk',
    })
    sections.push({
      label: 'New margin leaks',
      value: `${leaks.length} (${health.belowCostCount} below cost, ${health.thinCount} thin)`,
      tone: health.belowCostCount ? 'risk' : health.thinCount ? 'watch' : 'good',
    })
    const expensive = ledger.byDimension.customer.slice(0, 3).map((r) => `${r.entity.label} (${usd(r.cost)})`)
    sections.push({ label: 'Most expensive customers', value: expensive.join(', ') || '—' })
  } else {
    sections.push({ label: 'AI cost', value: usd(ledger.totals.cost) })
    sections.push({ label: 'Revenue', value: 'Not connected', tone: 'watch' })
    sections.push({ label: 'Gross AI margin', value: 'Connect Stripe to compute', tone: 'watch' })
    sections.push({ label: 'Top cost drivers', value: `${leaks.length} flagged` })
  }

  const feature = ledger.byDimension.feature.slice(0, 3).map((r) => `${r.entity.label} (${usd(r.cost)})`)
  if (feature.length) sections.push({ label: 'Most expensive features', value: feature.join(', ') })
  sections.push({
    label: 'Margin risk changes',
    value: 'Baseline — trend starts next period',
    tone: 'neutral',
  })
  sections.push({
    label: 'Recommended action',
    value: top ? `${top.title} (+${usd(top.monthlyImpact)}/mo)` : 'None above threshold',
    tone: top ? 'good' : 'neutral',
  })
  sections.push({ label: 'Estimated business impact', value: `${usd(estimatedBusinessImpact)}/mo`, tone: 'good' })

  const headline = ledger.coverage.hasRevenue
    ? health.belowCostCount > 0
      ? `${health.belowCostCount} customer${health.belowCostCount > 1 ? 's are' : ' is'} below cost. Blended AI margin ${pct(ledger.totals.marginPct ?? 0)}. Top action worth ${usd(top?.monthlyImpact ?? 0)}/mo.`
      : `Blended AI margin ${pct(ledger.totals.marginPct ?? 0)} on ${usd(ledger.totals.revenue)} revenue. ${num(estimatedBusinessImpact)}/mo of upside identified.`
    : `${usd(ledger.totals.cost)} of AI cost across ${num(ledger.byDimension.project.length)} projects. Connect Stripe to turn this into margin.`

  return {
    periodLabel: ledger.periodLabel,
    hasBaseline: false,
    headline,
    sections,
    topRecommendation: top,
    estimatedBusinessImpact,
  }
}
