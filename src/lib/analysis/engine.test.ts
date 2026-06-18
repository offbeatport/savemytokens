import { describe, it, expect } from 'vitest'
import { analyzeUsage } from './engine'
import { mockUsage } from './mock'

describe('analysis engine - acme (savings found)', () => {
  const { snapshot, report } = analyzeUsage(mockUsage('acme'))

  it('prints headline numbers', () => {
    // eslint-disable-next-line no-console
    console.log('ACME', {
      spend: snapshot.spendAnalyzed,
      score: snapshot.healthScore,
      band: snapshot.band,
      savings: [snapshot.estSavingsLow, snapshot.estSavingsHigh],
      opps: snapshot.opportunityCount,
      outputPct: snapshot.outputCostPct,
      topModel: snapshot.topModel,
      visible: snapshot.visibleInsight.title,
      locked: snapshot.lockedCategories,
      findings: report.findings.map((f) => `#${f.rank} ${f.category} ${f.estMonthlyLow}-${f.estMonthlyHigh}`),
    })
    expect(snapshot.spendAnalyzed).toBeGreaterThan(0)
  })

  it('finds multiple opportunities', () => {
    expect(report.findings.length).toBeGreaterThanOrEqual(5)
    expect(snapshot.opportunityCount).toBe(report.findings.length)
  })

  it('PAYWALL: never reveals the #1 highest-impact opportunity for free', () => {
    const top = report.findings[0]
    expect(top.rank).toBe(1)
    // visible insight must not be the top finding
    expect(snapshot.visibleInsight.title).not.toBe(top.title)
    // top finding's exact fix/evidence must not leak into the snapshot blob
    const blob = JSON.stringify(snapshot)
    expect(blob).not.toContain(top.fix)
    expect(blob).not.toContain(top.evidence)
    expect(snapshot.lockedCount).toBe(report.findings.length - 1)
  })

  it('reveals a credible middle-ground insight (output share)', () => {
    expect(snapshot.visibleInsight.title.toLowerCase()).toContain('output')
    expect(snapshot.outputCostPct).toBeGreaterThan(35)
  })

  it('estimated savings range is positive and ordered', () => {
    expect(snapshot.estSavingsLow).toBeGreaterThan(0)
    expect(snapshot.estSavingsHigh).toBeGreaterThan(snapshot.estSavingsLow)
  })

  it('produces a founder memo and full breakdowns', () => {
    expect(report.founderMemo).toContain('Founder memo')
    expect(report.spendByModel.length).toBeGreaterThan(2)
    expect(report.spendByProject.length).toBeGreaterThan(2)
    expect(report.spikes.length).toBeGreaterThan(0)
    expect(report.healthy).toBe(false)
  })
})

describe('analysis engine - healthy (no savings)', () => {
  const { snapshot, report } = analyzeUsage(mockUsage('healthy'))

  it('prints + asserts healthy diagnosis', () => {
    // eslint-disable-next-line no-console
    console.log('HEALTHY', {
      spend: snapshot.spendAnalyzed,
      score: snapshot.healthScore,
      band: snapshot.band,
      outputPct: snapshot.outputCostPct,
      findings: report.findings.length,
    })
    expect(report.healthy).toBe(true)
    expect(report.findings.length).toBe(0)
    expect(snapshot.opportunityCount).toBe(0)
    expect(snapshot.visibleInsight.title.toLowerCase()).toContain('healthy')
    expect(report.healthyReport).toBeTruthy()
    expect(report.healthyReport!.budgetThresholds.length).toBeGreaterThan(0)
  })
})

describe('analysis engine - scaleup (mixed)', () => {
  const { snapshot, report } = analyzeUsage(mockUsage('scaleup'))
  it('prints + has some findings', () => {
    // eslint-disable-next-line no-console
    console.log('SCALEUP', {
      spend: snapshot.spendAnalyzed,
      score: snapshot.healthScore,
      band: snapshot.band,
      savings: [snapshot.estSavingsLow, snapshot.estSavingsHigh],
      opps: snapshot.opportunityCount,
      findings: report.findings.map((f) => `#${f.rank} ${f.category}`),
    })
    expect(report.findings.length).toBeGreaterThan(0)
  })
})
