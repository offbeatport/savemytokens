import { describe, it, expect } from 'vitest'
import { diffSnapshots, type SnapshotLite } from './trend'
import type { MarginStatus } from './types'

const s = (id: string, rev: number, cost: number, status: MarginStatus, marginPct: number | null, period: string): SnapshotLite => ({
  entityKind: 'customer', entityId: id, entityLabel: id, period, revenue: rev, cost, marginPct, status,
})

describe('diffSnapshots — crossover detection', () => {
  const prior = [s('acme', 499, 300, 'thin', 40, '2026-05'), s('globex', 2400, 200, 'strong', 92, '2026-05'), s('initech', 900, 1000, 'below-cost', -11, '2026-05')]
  const current = [
    s('acme', 499, 600, 'below-cost', -20, '2026-06'), // newly below cost
    s('globex', 2400, 300, 'strong', 88, '2026-06'),
    s('initech', 900, 700, 'thin', 22, '2026-06'), // recovered
    s('newco', 100, 150, 'below-cost', -50, '2026-06'), // new + below cost
  ]
  const d = diffSnapshots(prior, current)

  it('flags who NEWLY went below cost (the alert)', () => {
    expect(d.hasBaseline).toBe(true)
    expect(d.newlyBelowCost.map((m) => m.entity.id).sort()).toEqual(['acme', 'newco'])
  })

  it('flags who recovered', () => {
    expect(d.recovered.map((m) => m.entity.id)).toEqual(['initech'])
  })

  it('computes period totals + deltas', () => {
    expect(d.totals.costFrom).toBe(1500)
    expect(d.totals.costTo).toBe(1750)
    expect(d.totals.costDelta).toBe(250)
    expect(d.biggestMovers.length).toBeGreaterThan(0)
  })

  it('reports no baseline when prior is empty', () => {
    expect(diffSnapshots([], current).hasBaseline).toBe(false)
  })
})
