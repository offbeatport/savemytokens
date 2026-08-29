import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marginIngest, marginSnapshot, type MarginIngestRow } from '@/lib/db/schema'
import { analyzeMargin, resolveAttribution, diffSnapshots, type MarginResult, type SnapshotLite, type CrossoverReport } from '@/lib/margin'
import { analyzeUsage } from '@/lib/analysis/engine'
import { parseUsage, parseRevenue } from '@/lib/analysis/parse'
import type { EntityKind, MarginStatus } from '@/lib/margin'
import type { RevenueRow, UsageRow } from '@/lib/analysis/types'
import { genId } from '@/lib/id'
import { resolveUser } from './guards'
import { fetchStripeRevenue } from './connectors/stripe'
import { ConnectorError } from './connectors'

/** Run the full pipeline: attribute usage → customers, then compute margin. */
function runAnalysis(
  usage: UsageRow[],
  revenue: RevenueRow[],
  manual?: Record<string, string>,
): { result: MarginResult; usage: UsageRow[] } {
  const { usage: enriched, report } = resolveAttribution(usage, revenue, { manual })
  const result = analyzeMargin(enriched, revenue)
  result.attribution = report
  // Full cost-health report → powers the "Cost breakdown" tab (evidence).
  result.costReport = analyzeUsage(enriched, { periodLabel: result.ledger.periodLabel }).report
  return { result, usage: enriched }
}

/** Tiny key,customer mapping CSV → { key: customerId }. */
function parseMapping(csv: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of csv.split(/\r?\n/)) {
    const [key, customer] = line.split(',').map((s) => s?.trim())
    if (key && customer && key.toLowerCase() !== 'key' && key.toLowerCase() !== 'project') map[key] = customer
  }
  return map
}

/* ── Persistence ─────────────────────────────────────────────── */

async function persist(
  result: MarginResult,
  meta: { source: string; usage: UsageRow[]; revenue: RevenueRow[]; email?: string },
): Promise<string> {
  const user = await resolveUser().catch(() => null)
  const id = genId('m_')
  await db.insert(marginIngest).values({
    id,
    userId: user?.id ?? null,
    source: meta.source,
    period: result.ledger.period,
    periodLabel: result.ledger.periodLabel,
    mode: result.mode,
    hasRevenue: result.ledger.coverage.hasRevenue,
    costBasis: result.ledger.reconciliation.costBasis,
    usageJson: JSON.stringify(meta.usage),
    revenueJson: meta.revenue.length ? JSON.stringify(meta.revenue) : null,
    resultJson: JSON.stringify(result),
    email: meta.email ?? null,
  })
  // Time-series snapshot rows for Trend/Risk (customer axis for Path A; project for Path B).
  const dim = result.ledger.coverage.hasRevenue
    ? result.ledger.byDimension.customer
    : result.ledger.byDimension.project
  if (dim.length) {
    await db.insert(marginSnapshot).values(
      dim.slice(0, 200).map((row) => ({
        id: genId('ms_'),
        ingestId: id,
        userId: user?.id ?? null,
        entityKind: row.entity.kind,
        entityId: row.entity.id,
        entityLabel: row.entity.label,
        period: row.period,
        revenue: row.revenue,
        cost: row.cost,
        marginPct: row.marginPct,
        status: row.status,
      })),
    )
  }
  return id
}

function resultFromRow(row: MarginIngestRow): MarginResult {
  if (row.resultJson) return JSON.parse(row.resultJson) as MarginResult
  const usage = JSON.parse(row.usageJson) as UsageRow[]
  const revenue = row.revenueJson ? (JSON.parse(row.revenueJson) as RevenueRow[]) : []
  const result = analyzeMargin(usage, revenue)
  db.update(marginIngest).set({ resultJson: JSON.stringify(result) }).where(eq(marginIngest.id, row.id)).run()
  return result
}

/* ── CREATE ──────────────────────────────────────────────────── */

export type MarginUploadResult =
  | { ok: true; id: string; rowCount: number; mode: 'margin' | 'cost'; hasRevenue: boolean; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

export const createMarginScan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1),
        revenueCsv: z.string().optional(),
        stripeKey: z.string().optional(), // pull MRR straight from Stripe instead of a CSV
        mappingCsv: z.string().optional(), // optional key,customer overrides for attribution
        source: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<MarginUploadResult> => {
    const parsed = parseUsage(data.csv)
    if (parsed.rows.length === 0) {
      return {
        ok: false,
        warnings: parsed.warnings,
        error: parsed.warnings[0] ?? "We couldn't find usage rows in that file. Export usage from your provider and try again.",
      }
    }
    const warnings = [...parsed.warnings]
    let revenue: RevenueRow[] = []
    if (data.stripeKey && data.stripeKey.trim()) {
      try {
        revenue = await fetchStripeRevenue(data.stripeKey.trim())
      } catch (e) {
        if (e instanceof ConnectorError) return { ok: false, warnings, error: e.message }
        return { ok: false, warnings, error: 'Could not pull revenue from Stripe.' }
      }
    } else if (data.revenueCsv && data.revenueCsv.trim()) {
      const rev = parseRevenue(data.revenueCsv)
      revenue = rev.rows
      warnings.push(...rev.warnings)
    }
    const manual = data.mappingCsv ? parseMapping(data.mappingCsv) : undefined
    const { result, usage } = runAnalysis(parsed.rows, revenue, manual)
    const id = await persist(result, { source: data.source ?? 'upload', usage, revenue })
    return { ok: true, id, rowCount: parsed.rowCount, mode: result.mode, hasRevenue: result.ledger.coverage.hasRevenue, warnings }
  })

/** Sample margin scan — usage tagged with messy project keys (no customer column),
 * revenue keyed by customer. Showcases the attribution engine doing the join. */
export const createMarginSample = createServerFn({ method: 'POST' }).handler(async (): Promise<{ id: string }> => {
  const { usage, revenue } = marginSample()
  const { result, usage: enriched } = runAnalysis(usage, revenue)
  const id = await persist(result, { source: 'sample', usage: enriched, revenue })
  return { id }
})

/* ── Trend / crossover (the monitored, not-Excel layer) ──────── */

export const compareMargin = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }): Promise<CrossoverReport | null> => {
    const cur = await db.select().from(marginIngest).where(eq(marginIngest.id, data.id)).get()
    if (!cur) return null
    const toLite = (rows: typeof marginSnapshot.$inferSelect[]): SnapshotLite[] =>
      rows.map((s) => ({
        entityKind: s.entityKind as EntityKind,
        entityId: s.entityId,
        entityLabel: s.entityLabel,
        period: s.period,
        revenue: s.revenue,
        cost: s.cost,
        marginPct: s.marginPct,
        status: s.status as MarginStatus,
      }))
    const current = toLite(await db.select().from(marginSnapshot).where(eq(marginSnapshot.ingestId, cur.id)).all())
    // Prior ingest = same user, earlier createdAt (only when signed in).
    let prior: SnapshotLite[] = []
    if (cur.userId) {
      const priorIngest = await db
        .select()
        .from(marginIngest)
        .where(and(eq(marginIngest.userId, cur.userId), lt(marginIngest.createdAt, cur.createdAt)))
        .orderBy(desc(marginIngest.createdAt))
        .get()
      if (priorIngest) prior = toLite(await db.select().from(marginSnapshot).where(eq(marginSnapshot.ingestId, priorIngest.id)).all())
    }
    return diffSnapshots(prior, current)
  })

/* ── READ ────────────────────────────────────────────────────── */

export interface MarginPayload {
  id: string
  createdAt: number
  result: MarginResult
}

export const getMargin = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }): Promise<MarginPayload | null> => {
    const row = await db.select().from(marginIngest).where(eq(marginIngest.id, data.id)).get()
    if (!row) return null
    return {
      id: row.id,
      createdAt: (row.createdAt as unknown as Date)?.getTime?.() ?? Date.now(),
      result: resultFromRow(row),
    }
  })

/* ── Sample data (dimensional) ───────────────────────────────── */

function marginSample(): { usage: UsageRow[]; revenue: RevenueRow[] } {
  // 3 customers across features; one below cost (research-assistant on a premium model),
  // one thin, one strong. Deterministic.
  const usage: UsageRow[] = []
  // Usage carries a messy project/api-key label (NO customer column) — exactly
  // what a real gateway export looks like. Attribution resolves key → customer.
  const rows = [
    { key: 'acme-prod-api', plan: 'pro', model: 'gpt-4o', feature: 'research-assistant', in: 5_000_000, out: 1_500_000, cost: 26, req: 900 },
    { key: 'acme-prod-api', plan: 'pro', model: 'gpt-4-turbo', feature: 'research-assistant', in: 600_000, out: 120_000, cost: 9, req: 120 },
    { key: 'globex-svc', plan: 'scale', model: 'gpt-4o-mini', feature: 'autocomplete', in: 1_200_000, out: 180_000, cost: 4, req: 6000 },
    { key: 'globex-svc', plan: 'scale', model: 'gpt-4o', feature: 'summarize', in: 900_000, out: 220_000, cost: 6, req: 800 },
    { key: 'initech-app', plan: 'team', model: 'claude-3-5-sonnet', feature: 'chat', in: 2_000_000, out: 500_000, cost: 12, req: 1500 },
    { key: 'initech-app', plan: 'team', model: 'claude-3-5-haiku', feature: 'classify', in: 3_000_000, out: 200_000, cost: 3, req: 9000 },
  ]
  for (let d = 1; d <= 28; d++) {
    const date = `2026-05-${String(d).padStart(2, '0')}`
    for (const c of rows) {
      usage.push({
        provider: c.model.includes('claude') ? 'anthropic' : 'openai',
        model: c.model,
        date,
        project: c.key, // messy gateway key — no customerId
        plan: c.plan,
        feature: c.feature,
        inputTokens: c.in,
        outputTokens: c.out,
        requests: c.req,
        cost: c.cost,
        costSource: 'actual',
      })
    }
  }
  const revenue: RevenueRow[] = [
    { customerId: 'acme', label: 'Acme Corp', plan: 'pro', monthlyRevenue: 499, source: 'stripe' },
    { customerId: 'globex', label: 'Globex Inc', plan: 'scale', monthlyRevenue: 2400, source: 'stripe' },
    { customerId: 'initech', label: 'Initech LLC', plan: 'team', monthlyRevenue: 900, source: 'stripe' },
  ]
  return { usage, revenue }
}
