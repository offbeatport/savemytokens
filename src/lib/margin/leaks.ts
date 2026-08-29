/**
 * Margin Leak detection. A leak is the PARENT object, always tied to a concrete
 * entity (customer/plan/feature/project). The existing cost detectors run on the
 * entity's own usage subset and attach as EVIDENCE — they no longer stand alone.
 */
import { buildContext, assembleReport } from '@/lib/analysis/engine'
import { REGISTRY } from '@/lib/analysis/registry'
import type { Finding, UsageRow } from '@/lib/analysis/types'
import { usd, pct } from '@/lib/format'
import type { Evidence, MarginLeak, MarginLedger, MarginLedgerRow } from './types'

const round = (n: number) => Math.round(n)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mid = (e: Evidence) => (e.estMonthlyLow + e.estMonthlyHigh) / 2

function toEvidence(f: Finding): Evidence {
  return {
    category: f.category,
    title: f.title,
    detail: f.detail,
    estMonthlyLow: f.estMonthlyLow,
    estMonthlyHigh: f.estMonthlyHigh,
    confidence: f.confidence,
    confidenceTier: f.confidenceTier ?? 'suspected',
    metrics: f.metrics ?? [],
    affectedModels: f.affectedModels,
  }
}

/** Run the cost detectors over one entity's usage and return them as evidence. */
function evidenceFor(rows: UsageRow[], periodLabel: string): Evidence[] {
  if (!rows.length) return []
  const ctx = buildContext(rows, { periodLabel })
  const { report } = assembleReport(REGISTRY['ai-cost-health'], ctx)
  return report.findings
    .filter((f) => f.category !== 'project-leak') // the leak itself IS the concentration
    .map(toEvidence)
    .sort((a, b) => mid(b) - mid(a))
}

function subsetFor(usage: UsageRow[], row: MarginLedgerRow): UsageRow[] {
  const { kind, id } = row.entity
  return usage.filter((r) => {
    switch (kind) {
      case 'customer': return r.customerId === id
      case 'plan': return r.plan === id
      case 'feature': return r.feature === id
      case 'workspace': return r.workspace === id
      case 'project': return (r.project || 'default') === id
      case 'model': return r.model === id
    }
  })
}

export function detectLeaks(ledger: MarginLedger, usage: UsageRow[]): MarginLeak[] {
  const label = ledger.periodLabel
  const leaks: MarginLeak[] = []

  if (ledger.coverage.hasRevenue) {
    // Path A — real margin leaks on the CUSTOMER axis (the confirmed dimension).
    const candidates = ledger.byDimension.customer
      .filter((r) => r.status === 'below-cost' || r.status === 'thin')
    for (const row of candidates) {
      const evidence = evidenceFor(subsetFor(usage, row), label)
      const recoverable = sum(evidence.map(mid))
      const monthlyImpact =
        row.status === 'below-cost'
          ? round(row.cost - row.revenue) // gap to break-even
          : round(Math.min(recoverable, row.cost * 0.3))
      const summary =
        row.status === 'below-cost'
          ? `${row.entity.label} costs ${usd(row.cost)} in AI on ${usd(row.revenue)} of revenue — losing ${usd(row.cost - row.revenue)}/mo (negative margin).`
          : `${row.entity.label} runs at ${pct(row.marginPct ?? 0)} margin — AI is ${pct(100 - (row.marginPct ?? 0))} of its revenue and fragile to any growth.`
      leaks.push({
        id: `leak-${row.entity.kind}-${row.entity.id}`,
        entity: row.entity,
        status: row.status,
        revenue: row.revenue,
        cost: row.cost,
        marginPct: row.marginPct,
        monthlyImpact: Math.max(monthlyImpact, 0),
        summary,
        evidence,
        confidenceTier: 'confirmed',
      })
    }
    return leaks.sort((a, b) => b.monthlyImpact - a.monthlyImpact).slice(0, 12)
  }

  // Path B — no revenue. Surface top COST DRIVERS as cost-concentration leaks.
  const total = ledger.totals.cost
  const dim = ledger.byDimension.feature.length > 1 ? ledger.byDimension.feature : ledger.byDimension.project
  for (const row of dim.slice(0, 8)) {
    const evidence = evidenceFor(subsetFor(usage, row), label)
    const recoverable = round(sum(evidence.map(mid)))
    if (recoverable < 25) continue
    const share = total ? round((row.cost / total) * 100) : 0
    leaks.push({
      id: `cost-${row.entity.kind}-${row.entity.id}`,
      entity: row.entity,
      status: 'unknown',
      revenue: 0,
      cost: row.cost,
      marginPct: null,
      monthlyImpact: recoverable,
      summary: `${row.entity.label} is a top cost driver at ${usd(row.cost)}/mo (${pct(share)} of spend). Connect Stripe to see if it's profitable.`,
      evidence,
      confidenceTier: 'suspected',
    })
  }
  return leaks.sort((a, b) => b.monthlyImpact - a.monthlyImpact).slice(0, 12)
}
