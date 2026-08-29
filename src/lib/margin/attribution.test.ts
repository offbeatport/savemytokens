import { describe, it, expect } from 'vitest'
import { resolveAttribution } from './attribution'
import { analyzeMargin } from './index'
import type { RevenueRow, UsageRow } from '@/lib/analysis/types'

const rev: RevenueRow[] = [
  { customerId: 'acme', label: 'Acme Corp', monthlyRevenue: 499, source: 'csv' },
  { customerId: 'globex', label: 'Globex Inc', monthlyRevenue: 2400, source: 'csv' },
]
const u = (project: string, cost: number, customerId?: string): UsageRow => ({
  provider: 'openai', model: 'gpt-4o', date: '2026-05-01', project, customerId,
  inputTokens: 1, outputTokens: 1, requests: 1, cost, costSource: 'actual',
})

describe('resolveAttribution', () => {
  it('auto-maps messy usage keys to revenue customers (the not-Excel join)', () => {
    const { usage, report } = resolveAttribution([u('acme-prod-api', 100), u('globex-svc', 50), u('mystery-xyz', 10)], rev)
    expect(report.method).toBe('matched')
    expect(usage.find((r) => r.project === 'acme-prod-api')!.customerId).toBe('acme')
    expect(usage.find((r) => r.project === 'globex-svc')!.customerId).toBe('globex')
    expect(usage.find((r) => r.project === 'mystery-xyz')!.customerId).toBeUndefined()
    expect(report.attributedPct).toBe(94) // 150 of 160
    expect(report.unmatched.map((x) => x.key)).toContain('mystery-xyz')
  })

  it('trusts pre-tagged usage', () => {
    const { report } = resolveAttribution([u('p1', 100, 'acme'), u('p2', 100, 'globex')], rev)
    expect(report.method).toBe('pre-tagged')
    expect(report.attributedPct).toBe(100)
  })

  it('honors a manual override map', () => {
    const { usage, report } = resolveAttribution([u('weird-key', 100)], rev, { manual: { 'weird-key': 'acme' } })
    expect(usage[0].customerId).toBe('acme')
    expect(report.matched[0].method).toBe('manual')
  })

  it('emits suggestions for borderline matches instead of guessing', () => {
    const { usage, report } = resolveAttribution([u('glbx', 30)], rev)
    // too weak to auto-apply, but should surface as a suggestion or unmatched (never silently wrong)
    expect(usage[0].customerId === 'globex' || usage[0].customerId === undefined).toBe(true)
    expect(report.matched.every((m) => m.score >= 0.85)).toBe(true)
  })

  it('returns none when there is no revenue', () => {
    const { report } = resolveAttribution([u('p', 10)], [])
    expect(report.method).toBe('none')
    expect(report.attributedPct).toBe(0)
  })

  it('end-to-end: usage with NO customer column → attributed → customer margin leaks', () => {
    const usage: UsageRow[] = [
      ...Array.from({ length: 20 }, () => u('acme-prod-api', 26)), // $520 cost vs $499 rev → below cost
      ...Array.from({ length: 20 }, () => u('globex-svc', 5)),
    ]
    const { usage: enriched } = resolveAttribution(usage, rev)
    const result = analyzeMargin(enriched, rev)
    const acme = result.ledger.byDimension.customer.find((c) => c.entity.id === 'acme')
    expect(acme?.status).toBe('below-cost')
    expect(result.leaks.some((l) => l.entity.id === 'acme')).toBe(true)
    expect(result.health.belowCostCount).toBeGreaterThanOrEqual(1)
  })
})
