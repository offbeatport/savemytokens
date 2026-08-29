import { describe, it, expect } from 'vitest'
import { analyzeMargin } from './index'
import type { UsageRow, RevenueRow } from '@/lib/analysis/types'

// Two customers: acme is below cost (pays little, burns a lot on premium models);
// globex is healthy. Usage carries customer/feature dimensions.
function usage(): UsageRow[] {
  const rows: UsageRow[] = []
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}`
  for (let d = 1; d <= 28; d++) {
    // acme — heavy gpt-4o on a research feature, high cost
    rows.push({
      provider: 'openai', model: 'gpt-4o', date: day(d), project: 'acme',
      customerId: 'acme', feature: 'research-assistant', plan: 'pro',
      inputTokens: 4_000_000, outputTokens: 1_200_000, requests: 1200, cost: 22, costSource: 'actual',
    })
    // globex — cheap gpt-4o-mini, low cost
    rows.push({
      provider: 'openai', model: 'gpt-4o-mini', date: day(d), project: 'globex',
      customerId: 'globex', feature: 'autocomplete', plan: 'scale',
      inputTokens: 800_000, outputTokens: 120_000, requests: 5000, cost: 5, costSource: 'actual',
    })
  }
  return rows
}

const revenue: RevenueRow[] = [
  { customerId: 'acme', label: 'Acme Corp', plan: 'pro', monthlyRevenue: 200, source: 'csv' },
  { customerId: 'globex', label: 'Globex', plan: 'scale', monthlyRevenue: 4000, source: 'csv' },
]

describe('analyzeMargin — Path A (revenue joined)', () => {
  const r = analyzeMargin(usage(), revenue, { periodLabel: 'May 2026' })

  it('runs in margin mode and computes a ledger across dimensions', () => {
    expect(r.mode).toBe('margin')
    expect(r.ledger.byDimension.customer.length).toBe(2)
    expect(r.ledger.byDimension.feature.length).toBe(2)
    expect(r.ledger.totals.revenue).toBe(4200)
    expect(r.ledger.totals.cost).toBeGreaterThan(0)
  })

  it('flags acme below cost and globex healthy', () => {
    const acme = r.ledger.byDimension.customer.find((x) => x.entity.id === 'acme')!
    const globex = r.ledger.byDimension.customer.find((x) => x.entity.id === 'globex')!
    expect(acme.status).toBe('below-cost')
    expect(acme.margin).toBeLessThan(0)
    expect(['healthy', 'strong']).toContain(globex.status)
  })

  it('produces a below-cost leak with attached cost evidence', () => {
    const leak = r.leaks.find((l) => l.entity.id === 'acme')
    expect(leak).toBeTruthy()
    expect(leak!.status).toBe('below-cost')
    expect(leak!.monthlyImpact).toBeGreaterThan(0)
    expect(leak!.confidenceTier).toBe('confirmed')
    expect(leak!.evidence.length).toBeGreaterThan(0) // cost detectors attached
  })

  it('ranks a recommendation tied to the customer entity', () => {
    expect(r.recommendations.length).toBeGreaterThan(0)
    const top = r.recommendations[0]
    expect(top.entity.kind).toBeDefined()
    expect(top.score).toBeGreaterThan(0)
    expect(top.monthlyImpact).toBeGreaterThan(0)
    expect(top.rationale).toContain(top.entity.label)
  })

  it('scores margin health and a CFO report', () => {
    expect(r.health.hasRevenue).toBe(true)
    expect(r.health.belowCostCount).toBeGreaterThanOrEqual(1)
    expect(r.health.score).toBeGreaterThanOrEqual(5)
    expect(r.cfo.sections.length).toBeGreaterThan(4)
    expect(r.cfo.estimatedBusinessImpact).toBeGreaterThan(0)
  })
})

describe('analyzeMargin — Path B (no revenue)', () => {
  const r = analyzeMargin(usage(), [], { periodLabel: 'May 2026' })

  it('runs in cost mode with unknown margin', () => {
    expect(r.mode).toBe('cost')
    expect(r.ledger.coverage.hasRevenue).toBe(false)
    expect(r.ledger.totals.marginPct).toBeNull()
    expect(r.health.hasRevenue).toBe(false)
  })

  it('still surfaces cost-driver leaks + a health score', () => {
    expect(r.health.score).toBeGreaterThan(0)
    // acme is the dominant cost driver → should appear as a cost leak
    expect(r.leaks.length).toBeGreaterThanOrEqual(1)
    expect(r.leaks[0].status).toBe('unknown')
  })
})
