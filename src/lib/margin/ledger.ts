/**
 * The Margin Ledger — the single source of truth, computed once per ingest.
 * MarginLedger = join(Revenue by customer, Usage→Cost by every dimension) per (entity, period).
 * Customer revenue is a direct join (a fact); other dimensions allocate revenue by
 * cost-share (modeled — flagged via `allocated`). Everything else derives from this.
 */
import { reconcileCosts } from '@/lib/analysis/engine'
import type { UsageRow, RevenueRow } from '@/lib/analysis/types'
import type {
  EntityKind,
  EntityRef,
  MarginLedger,
  MarginLedgerRow,
  MarginStatus,
} from './types'
import { ENTITY_KINDS } from './types'

const round = (n: number) => Math.round(n)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export interface LedgerOptions {
  invoiceTotal?: number
  period?: string
  periodLabel?: string
}

export function marginStatus(marginPct: number | null, margin: number): MarginStatus {
  if (marginPct === null) return 'unknown'
  if (margin < 0) return 'below-cost'
  if (marginPct < 50) return 'thin'
  if (marginPct <= 80) return 'healthy'
  return 'strong'
}

/** Dominant YYYY-MM across the usage window. */
function dominantPeriod(usage: UsageRow[]): string {
  const counts = new Map<string, number>()
  for (const r of usage) {
    const p = (r.date || '').slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(p)) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  let best = ''
  let max = -1
  for (const [p, c] of counts) if (c > max) ((max = c), (best = p))
  return best || '—'
}

function periodLabel(usage: UsageRow[]): string {
  const dates = usage.map((r) => r.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (!dates.length) return 'recent usage'
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(iso + 'T00:00:00Z'),
    )
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

interface Agg {
  cost: number
  costActual: number
  costEstimated: number
  requests: number
  inputTokens: number
  outputTokens: number
  byModel: Map<string, number>
  label: string
}

const newAgg = (label: string): Agg => ({
  cost: 0,
  costActual: 0,
  costEstimated: 0,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  byModel: new Map(),
  label,
})

function keyFor(row: UsageRow, kind: EntityKind): { id: string; label: string } | null {
  switch (kind) {
    case 'customer':
      return row.customerId ? { id: row.customerId, label: row.customerId } : null
    case 'plan':
      return row.plan ? { id: row.plan, label: row.plan } : null
    case 'feature':
      return row.feature ? { id: row.feature, label: row.feature } : null
    case 'workspace':
      return row.workspace ? { id: row.workspace, label: row.workspace } : null
    case 'project':
      return { id: row.project || 'default', label: row.project || 'default' }
    case 'model':
      return { id: row.model, label: row.model }
  }
}

function rollup(usage: UsageRow[], kind: EntityKind): Map<string, Agg> {
  const map = new Map<string, Agg>()
  for (const r of usage) {
    const k = keyFor(r, kind)
    if (!k) continue
    const a = map.get(k.id) ?? newAgg(k.label)
    a.cost += r.cost
    if (r.costSource === 'actual') a.costActual += r.cost
    else a.costEstimated += r.cost
    a.requests += r.requests
    a.inputTokens += r.inputTokens
    a.outputTokens += r.outputTokens
    a.byModel.set(r.model, (a.byModel.get(r.model) ?? 0) + r.cost)
    map.set(k.id, a)
  }
  return map
}

function topModels(byModel: Map<string, number>, total: number) {
  return [...byModel.entries()]
    .map(([model, cost]) => ({ model, cost: round(cost), pct: total ? round((cost / total) * 100) : 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
}

export function buildLedger(usage: UsageRow[], revenue: RevenueRow[], opts: LedgerOptions = {}): MarginLedger {
  const hasRevenue = revenue.length > 0
  const period = opts.period ?? dominantPeriod(usage)
  const totalCost = sum(usage.map((r) => r.cost))

  // Revenue keyed by customer (sum dupes); capture each customer's plan.
  const revByCustomer = new Map<string, { revenue: number; plan?: string; label: string }>()
  for (const rr of revenue) {
    const cur = revByCustomer.get(rr.customerId) ?? { revenue: 0, plan: rr.plan, label: rr.label || rr.customerId }
    cur.revenue += rr.monthlyRevenue
    if (rr.plan) cur.plan = rr.plan
    revByCustomer.set(rr.customerId, cur)
  }
  const totalRevenue = sum([...revByCustomer.values()].map((v) => v.revenue))

  // Cost attributable to a known customer — the denominator for honest coverage.
  const attributedCost = sum(usage.filter((r) => r.customerId).map((r) => r.cost))

  // Plan → revenue, from customers that carry a plan on their revenue row.
  const revByPlan = new Map<string, number>()
  for (const v of revByCustomer.values()) {
    if (v.plan) revByPlan.set(v.plan, (revByPlan.get(v.plan) ?? 0) + v.revenue)
  }

  const buildRows = (kind: EntityKind): MarginLedgerRow[] => {
    const aggs = rollup(usage, kind)
    const rows: MarginLedgerRow[] = []
    for (const [id, a] of aggs) {
      let rev = 0
      let allocated = false
      if (hasRevenue) {
        if (kind === 'customer') {
          rev = revByCustomer.get(id)?.revenue ?? 0
        } else if (kind === 'plan' && revByPlan.size) {
          rev = revByPlan.get(id) ?? 0
        } else {
          // allocate total revenue by this dimension's cost share (modeled)
          rev = totalCost ? totalRevenue * (a.cost / totalCost) : 0
          allocated = true
        }
      }
      const cost = round(a.cost)
      const revenue = round(rev)
      const margin = revenue - cost
      const marginPct = hasRevenue && revenue > 0 ? round((margin / revenue) * 100) : null
      rows.push({
        entity: { kind, id, label: a.label },
        period,
        revenue,
        cost,
        costActual: round(a.costActual),
        costEstimated: round(a.costEstimated),
        margin,
        marginPct,
        status: marginStatus(marginPct, margin),
        requests: a.requests,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        topModels: topModels(a.byModel, a.cost),
        coverage: hasRevenue && !allocated ? 'full' : 'cost-only',
        allocated: allocated || undefined,
      })
    }
    return rows.sort((x, y) => y.cost - x.cost)
  }

  const byDimension = {} as Record<EntityKind, MarginLedgerRow[]>
  for (const k of ENTITY_KINDS) byDimension[k] = buildRows(k)
  const rows = ENTITY_KINDS.flatMap((k) => byDimension[k])

  const reconciliation = reconcileCosts(usage, opts.invoiceTotal)
  const totalMargin = totalRevenue - round(totalCost)
  return {
    period,
    periodLabel: opts.periodLabel ?? periodLabel(usage),
    rows,
    byDimension,
    totals: {
      revenue: round(totalRevenue),
      cost: round(totalCost),
      margin: round(totalMargin),
      marginPct: hasRevenue && totalRevenue > 0 ? round((totalMargin / totalRevenue) * 100) : null,
    },
    reconciliation,
    coverage: {
      hasRevenue,
      revenueCoveragePct: totalCost ? round((attributedCost / totalCost) * 100) : 0,
      attributedCostPct: totalCost ? round((attributedCost / totalCost) * 100) : 0,
    },
  }
}

export function entityKey(e: EntityRef): string {
  return `${e.kind}:${e.id}`
}
