/**
 * Crossover & trend — the part that makes this a monitored product, not a file.
 * Diffs two periods' margin snapshots to surface who NEWLY went below cost (the
 * alert), who recovered, the biggest movers, and the revenue/cost/margin deltas
 * that turn the Weekly CFO Report from a snapshot into a narrative.
 */
import type { EntityKind, MarginStatus } from './types'

export interface SnapshotLite {
  entityKind: EntityKind
  entityId: string
  entityLabel: string
  period: string
  revenue: number
  cost: number
  marginPct: number | null
  status: MarginStatus
}

export interface MarginMove {
  entity: { kind: EntityKind; id: string; label: string }
  from: MarginStatus | 'new'
  to: MarginStatus
  marginPctFrom: number | null
  marginPctTo: number | null
  costFrom: number
  costTo: number
  costDelta: number
}

export interface CrossoverReport {
  hasBaseline: boolean
  periodFrom: string | null
  periodTo: string
  newlyBelowCost: MarginMove[] // ← the alert
  recovered: MarginMove[]
  biggestMovers: MarginMove[]
  totals: { revenueFrom: number; revenueTo: number; costFrom: number; costTo: number; marginFrom: number; marginTo: number; revenueDelta: number; costDelta: number; marginDelta: number }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const totalsOf = (s: SnapshotLite[]) => ({
  revenue: sum(s.map((x) => x.revenue)),
  cost: sum(s.map((x) => x.cost)),
  margin: sum(s.map((x) => x.revenue)) - sum(s.map((x) => x.cost)),
})

function move(prior: SnapshotLite | undefined, cur: SnapshotLite): MarginMove {
  return {
    entity: { kind: cur.entityKind, id: cur.entityId, label: cur.entityLabel },
    from: prior ? prior.status : 'new',
    to: cur.status,
    marginPctFrom: prior?.marginPct ?? null,
    marginPctTo: cur.marginPct,
    costFrom: prior?.cost ?? 0,
    costTo: cur.cost,
    costDelta: cur.cost - (prior?.cost ?? 0),
  }
}

/**
 * @param prior snapshots from the previous period (may be empty → no baseline)
 * @param current snapshots from the latest period
 */
export function diffSnapshots(prior: SnapshotLite[], current: SnapshotLite[]): CrossoverReport {
  const periodTo = current[0]?.period ?? '—'
  const periodFrom = prior[0]?.period ?? null
  const priorById = new Map(prior.map((s) => [s.entityId, s]))

  const newlyBelowCost: MarginMove[] = []
  const recovered: MarginMove[] = []
  const movers: MarginMove[] = []

  for (const cur of current) {
    const p = priorById.get(cur.entityId)
    const m = move(p, cur)
    movers.push(m)
    if (cur.status === 'below-cost' && (!p || p.status !== 'below-cost')) newlyBelowCost.push(m)
    if (p && p.status === 'below-cost' && cur.status !== 'below-cost') recovered.push(m)
  }

  const tf = totalsOf(prior)
  const tt = totalsOf(current)

  return {
    hasBaseline: prior.length > 0,
    periodFrom,
    periodTo,
    newlyBelowCost: newlyBelowCost.sort((a, b) => b.costTo - a.costTo),
    recovered,
    biggestMovers: movers.sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta)).slice(0, 5),
    totals: {
      revenueFrom: tf.revenue, revenueTo: tt.revenue,
      costFrom: tf.cost, costTo: tt.cost,
      marginFrom: tf.margin, marginTo: tt.margin,
      revenueDelta: tt.revenue - tf.revenue,
      costDelta: tt.cost - tf.cost,
      marginDelta: tt.margin - tf.margin,
    },
  }
}
