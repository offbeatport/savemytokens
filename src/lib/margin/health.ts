/**
 * AI Margin Health Score + Margin Risk — both derived purely from the ledger.
 * Path A (revenue joined) scores true margin; Path B falls back to a cost-health
 * proxy and prompts the Stripe upgrade.
 */
import { usd, pct } from '@/lib/format'
import type { MarginBand, MarginHealth, MarginLedger, MarginRisk } from './types'

const round = (n: number) => Math.round(n)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function bandFor(score: number): { band: MarginBand; label: string } {
  if (score >= 80) return { band: 'strong', label: 'Strong margins' }
  if (score >= 60) return { band: 'healthy', label: 'Healthy' }
  if (score >= 40) return { band: 'watch', label: 'Watch' }
  return { band: 'leaking', label: 'Leaking margin' }
}

export function scoreMargin(ledger: MarginLedger): MarginHealth {
  const { totals } = ledger
  if (!ledger.coverage.hasRevenue) {
    // Path B — cost-only proxy: penalize concentration; invite the revenue join.
    const top = ledger.byDimension.project[0]
    const topShare = totals.cost && top ? top.cost / totals.cost : 0
    const score = clamp(round(100 - topShare * 55), 20, 95)
    const { band, label } = bandFor(score)
    return {
      score,
      band,
      bandLabel: label,
      hasRevenue: false,
      revenue: 0,
      cost: totals.cost,
      margin: 0,
      marginPct: null,
      revenueAtRisk: 0,
      belowCostCount: 0,
      thinCount: 0,
      summary: `${usd(totals.cost)} of AI cost analyzed. Connect Stripe to turn this into a per-customer margin score and see who's below cost.`,
    }
  }

  const customers = ledger.byDimension.customer
  const belowCost = customers.filter((r) => r.status === 'below-cost')
  const thin = customers.filter((r) => r.status === 'thin')
  const revenueAtRisk = round([...belowCost, ...thin].reduce((a, r) => a + r.revenue, 0))
  const atRiskPct = totals.revenue ? revenueAtRisk / totals.revenue : 0
  const marginPct = totals.marginPct ?? 0

  const marginComponent = clamp(((marginPct + 20) / 120) * 70, 0, 70) // marginPct 100→70, 0→~12, −20→0
  const riskComponent = (1 - atRiskPct) * 30
  const score = clamp(round(marginComponent + riskComponent), 5, 100)
  const { band, label } = bandFor(score)

  const summary =
    belowCost.length > 0
      ? `${belowCost.length} customer${belowCost.length > 1 ? 's are' : ' is'} below cost (${usd(revenueAtRisk)} of revenue at risk). Blended AI margin ${pct(marginPct)}.`
      : thin.length > 0
        ? `Blended AI margin ${pct(marginPct)}; ${thin.length} thin-margin account${thin.length > 1 ? 's' : ''} to watch.`
        : `Blended AI margin ${pct(marginPct)} across ${usd(totals.revenue)} of revenue — healthy.`

  return {
    score,
    band,
    bandLabel: label,
    hasRevenue: true,
    revenue: totals.revenue,
    cost: totals.cost,
    margin: totals.margin,
    marginPct: totals.marginPct,
    revenueAtRisk,
    belowCostCount: belowCost.length,
    thinCount: thin.length,
    summary,
  }
}

export function assessRisk(ledger: MarginLedger): MarginRisk[] {
  const risks: MarginRisk[] = []
  const { totals } = ledger

  // Concentration risk (cost concentrated in one customer/project).
  const dim = ledger.coverage.hasRevenue ? ledger.byDimension.customer : ledger.byDimension.project
  const top = dim[0]
  if (top && totals.cost) {
    const share = round((top.cost / totals.cost) * 100)
    if (share >= 35) {
      risks.push({
        id: 'risk-concentration',
        kind: 'concentration',
        entity: top.entity,
        severity: share >= 60 ? 'high' : 'medium',
        title: `${pct(share)} of AI cost is concentrated in "${top.entity.label}"`,
        detail: `A single ${top.entity.kind} drives ${pct(share)} of spend. Concentration magnifies any inefficiency and any margin slip there hits the whole P&L.`,
        available: true,
      })
    }
  }

  // Thin-margin risk (Path A only).
  if (ledger.coverage.hasRevenue) {
    const thin = ledger.byDimension.customer.filter((r) => r.status === 'thin')
    if (thin.length) {
      risks.push({
        id: 'risk-thin',
        kind: 'thin-margin',
        severity: thin.length >= 3 ? 'high' : 'medium',
        title: `${thin.length} account${thin.length > 1 ? 's' : ''} run thin (AI > 50% of revenue)`,
        detail: `These are profitable today but flip to losses as usage grows. ${thin.map((t) => t.entity.label).slice(0, 5).join(', ')}.`,
        available: true,
      })
    }
  }

  // Trend risk — needs history we don't have yet (single ingest).
  risks.push({
    id: 'risk-trend',
    kind: 'trend',
    severity: 'low',
    title: 'Margin trend not yet available',
    detail: 'Trend & "who is about to go below cost" unlock once a second period is recorded. Re-scan next month to start the time-series.',
    available: false,
  })

  return risks
}
