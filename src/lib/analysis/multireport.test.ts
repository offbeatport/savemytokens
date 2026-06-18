import { describe, it, expect } from 'vitest'
import { analyzeAll, reconcileCosts } from './engine'
import { ALL_REPORT_DEFS, REGISTRY } from './registry'
import { mockUsage } from './mock'
import type { ReportSlug, RevenueMap, UsageRow } from './types'

describe('analyzeAll - produces all 5 reports', () => {
  const { reports } = analyzeAll(mockUsage('acme'))

  it('has every registered report', () => {
    for (const def of ALL_REPORT_DEFS) {
      expect(reports[def.slug]).toBeTruthy()
      expect(reports[def.slug].snapshot.slug).toBe(def.slug)
      expect(reports[def.slug].report.slug).toBe(def.slug)
    }
  })

  it('the focused reports actually fire on acme', () => {
    expect(reports['model-output-waste'].report.findings.length).toBeGreaterThan(0)
    expect(reports['prompt-cache-readiness'].report.findings.length).toBeGreaterThan(0)
    expect(reports['agent-waste-detector'].report.findings.length).toBeGreaterThan(0)
  })

  it('PAYWALL holds independently for every report', () => {
    for (const def of ALL_REPORT_DEFS) {
      const { snapshot, report } = reports[def.slug]
      const blob = JSON.stringify(snapshot)
      const f = report.findings
      if (f.length >= 2) {
        const top = f.find((x) => x.rank === 1)!
        expect(snapshot.visibleInsight.title).not.toBe(top.title)
        expect(blob).not.toContain(top.fix)
        expect(blob).not.toContain(top.evidence)
        expect(snapshot.lockedCount).toBe(f.length - 1)
      } else if (f.length === 1) {
        // single-finding guard: no finding-level reveal
        expect(snapshot.visibleInsight.title).not.toBe(f[0].title)
        expect(blob).not.toContain(f[0].fix)
        expect(snapshot.lockedCount).toBe(1)
      }
    }
  })
})

describe('cost reconciliation', () => {
  const rows = mockUsage('acme')

  it('all-actual → actual', () => {
    expect(reconcileCosts(rows).costBasis).toBe('actual')
  })
  it('none-actual → estimated, caps finding confidence at medium', () => {
    const estimated: UsageRow[] = rows.map((r) => ({ ...r, costSource: 'estimated' }))
    const rec = reconcileCosts(estimated)
    expect(rec.costBasis).toBe('estimated')
    const { reports } = analyzeAll(estimated)
    const conf = reports['ai-cost-health'].report.findings.map((f) => f.confidence)
    expect(conf).not.toContain('high')
    expect(reports['ai-cost-health'].report.confidenceNote).toBeTruthy()
  })
  it('mixed → mixed', () => {
    const mixed: UsageRow[] = rows.map((r, i) => ({ ...r, costSource: i % 2 ? 'estimated' : 'actual' }))
    expect(reconcileCosts(mixed).costBasis).toBe('mixed')
  })

  it('implausible invoiceTotal (< actual) never produces >100% / negative-% note', () => {
    const r: UsageRow[] = [
      { provider: 'openai', model: 'gpt-4o', date: '2026-05-01', project: 'a', inputTokens: 0, outputTokens: 0, requests: 1, cost: 1000, costSource: 'actual' },
      { provider: 'openai', model: 'gpt-4o', date: '2026-05-01', project: 'b', inputTokens: 0, outputTokens: 0, requests: 1, cost: 200, costSource: 'estimated' },
    ]
    const rec = reconcileCosts(r, 900) // invoice below actual → ignore it
    expect(rec.actualPct).toBeLessThanOrEqual(1)
    expect(rec.actualPct).toBeGreaterThanOrEqual(0)
    expect(rec.reconciledTotal).toBe(1200) // falls back to Σ cost
    expect(rec.note).not.toMatch(/-\d|1[0-9]{2}%/) // no negative or >99% figure
  })

  it('plausible invoiceTotal (>= actual) is honored', () => {
    const r: UsageRow[] = [
      { provider: 'openai', model: 'gpt-4o', date: '2026-05-01', project: 'a', inputTokens: 0, outputTokens: 0, requests: 1, cost: 1000, costSource: 'actual' },
      { provider: 'openai', model: 'gpt-4o', date: '2026-05-01', project: 'b', inputTokens: 0, outputTokens: 0, requests: 1, cost: 200, costSource: 'estimated' },
    ]
    const rec = reconcileCosts(r, 1500)
    expect(rec.reconciledTotal).toBe(1500)
    expect(rec.actualPct).toBeCloseTo(1000 / 1500, 5)
  })
})

describe('ai-margin-leak', () => {
  const rows = mockUsage('acme')

  it('without a revenue map → cost concentration only, low confidence, metadata-limited', () => {
    const { report } = analyzeAll(rows).reports['ai-margin-leak']
    expect(report.metadataLimited).toBe(true)
    expect(report.extras?.coveragePct).toBe(0)
    for (const f of report.findings) expect(f.confidence).toBe('low')
  })

  it('with a revenue map → margin rows + below-cost flagged', () => {
    const revenueMap: RevenueMap = {
      keyBy: 'project',
      entries: [
        { key: 'checkout-agent', monthlyRevenue: 3000, plan: 'Pro' }, // cost ~4400 → below cost
        { key: 'doc-summarizer', monthlyRevenue: 2000, plan: 'Team' }, // thin
        { key: 'support-bot', monthlyRevenue: 8000, plan: 'Scale' }, // healthy
      ],
    }
    const { report } = analyzeAll(rows, { revenueMap }).reports['ai-margin-leak']
    expect(report.metadataLimited).toBeUndefined()
    expect(report.extras?.marginRows?.length).toBeGreaterThan(0)
    expect(report.extras!.coveragePct!).toBeGreaterThan(0)
    expect(report.findings.some((f) => f.id === 'margin-below-cost')).toBe(true)
    const belowRow = report.extras!.marginRows!.find((m) => m.key === 'checkout-agent')
    expect(belowRow?.belowCost).toBe(true)
  })
})

describe('agent-waste-detector - metadata limited', () => {
  it('is flagged limited and confidence-capped at medium', () => {
    const { report } = analyzeAll(mockUsage('acme')).reports['agent-waste-detector']
    expect(report.metadataLimited).toBe(true)
    expect(report.limitationNote).toMatch(/trace/i)
    for (const f of report.findings) expect(['medium', 'low']).toContain(f.confidence)
  })
})

describe('registry integrity', () => {
  it('every slug has a def with detectors', () => {
    const slugs: ReportSlug[] = [
      'ai-cost-health',
      'model-output-waste',
      'prompt-cache-readiness',
      'ai-margin-leak',
      'agent-waste-detector',
    ]
    for (const s of slugs) {
      expect(REGISTRY[s]).toBeTruthy()
      expect(REGISTRY[s].detectors.length).toBeGreaterThan(0)
    }
  })
})
