import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { scan, scanUnlock } from '@/lib/db/schema'
import { analyzeAll } from '@/lib/analysis/engine'
import { mockUsage, type ScenarioKey } from '@/lib/analysis/mock'
import { parseUsage, parseRevenueMap } from '@/lib/analysis/parse'
import type {
  ScanResult,
  Snapshot,
  Report,
  UsageRow,
  ReportSlug,
  RevenueMap,
  CostReconciliation,
} from '@/lib/analysis/types'
import { REPORTS, REPORT_PRICE } from '@/lib/reports/catalog'
import { genId } from '@/lib/id'
import { resolveUser, requireAdmin } from './guards'
import { isUnlocked, unlockedSlugs } from './store'
import { fetchOpenAIUsage, fetchAnthropicUsage, ConnectorError } from './connectors'

type ScanRowT = typeof scan.$inferSelect
type Bundle = Record<ReportSlug, ScanResult>

function periodLabelFor(rows: UsageRow[]): string {
  const dates = rows.map((r) => r.date).filter((d) => d > '2000-01-01').sort()
  if (!dates.length) return 'last 30 days'
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(iso + 'T00:00:00Z'),
    )
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

interface PersistMeta {
  source: string
  scenario: string
  email?: string
  rows: UsageRow[]
  revenueMap?: RevenueMap
}

async function persistBundle(
  bundle: { reconciliation: CostReconciliation; reports: Bundle },
  meta: PersistMeta,
): Promise<string> {
  const user = await resolveUser().catch(() => null)
  const id = genId('s_')
  const health = bundle.reports['ai-cost-health']
  await db.insert(scan).values({
    id,
    userId: user?.id ?? null,
    source: meta.source,
    scenario: meta.scenario,
    spendAnalyzed: health.snapshot.spendAnalyzed,
    healthScore: health.snapshot.healthScore,
    snapshotJson: JSON.stringify(health.snapshot),
    reportJson: JSON.stringify(health.report),
    unlocked: false,
    email: meta.email ?? null,
    rowsJson: JSON.stringify(meta.rows),
    reportsJson: JSON.stringify(bundle.reports),
    revenueMapJson: meta.revenueMap ? JSON.stringify(meta.revenueMap) : null,
    costBasis: bundle.reconciliation.costBasis,
    engineVersion: 2,
  })
  return id
}

/** Load all reports for a scan, backfilling from rows_json or legacy columns. */
function reportsFromRow(row: ScanRowT): Bundle {
  if (row.reportsJson) return JSON.parse(row.reportsJson) as Bundle
  if (row.rowsJson) {
    const rows = JSON.parse(row.rowsJson) as UsageRow[]
    const revenueMap = row.revenueMapJson ? (JSON.parse(row.revenueMapJson) as RevenueMap) : undefined
    const { reports, reconciliation } = analyzeAll(rows, { periodLabel: periodLabelFor(rows), revenueMap })
    db.update(scan)
      .set({ reportsJson: JSON.stringify(reports), costBasis: reconciliation.costBasis, engineVersion: 2 })
      .where(eq(scan.id, row.id))
      .run()
    return reports
  }
  // Pre-migration legacy row: only ai-cost-health is available.
  return {
    'ai-cost-health': {
      snapshot: JSON.parse(row.snapshotJson) as Snapshot,
      report: JSON.parse(row.reportJson) as Report,
    },
  } as Bundle
}

function unlockedFor(row: ScanRowT, slug: string): boolean {
  return isUnlocked(row.id, slug) || (slug === 'ai-cost-health' && !!row.unlocked)
}

const createdMs = (row: ScanRowT) => (row.createdAt as unknown as Date)?.getTime?.() ?? Date.now()

/* ── CREATE ──────────────────────────────────────────────────── */

const SOURCES = ['upload', 'openai', 'anthropic', 'gemini', 'sample'] as const

export const createScan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        source: z.enum(SOURCES).default('sample'),
        scenario: z.enum(['acme', 'healthy', 'scaleup']).default('acme'),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ id: string }> => {
    const rows = mockUsage(data.scenario as ScenarioKey)
    const bundle = analyzeAll(rows, { periodLabel: periodLabelFor(rows) })
    const id = await persistBundle(bundle, { source: data.source, scenario: data.scenario, rows })
    return { id }
  })

export type UploadResult =
  | { ok: true; id: string; rowCount: number; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

export const createScanFromUpload = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({ csv: z.string().min(1), filename: z.string().optional(), revenueMapCsv: z.string().optional() })
      .parse(d),
  )
  .handler(async ({ data }): Promise<UploadResult> => {
    const parsed = parseUsage(data.csv)
    if (parsed.rows.length === 0) {
      return {
        ok: false,
        warnings: parsed.warnings,
        error:
          parsed.warnings[0] ??
          "We couldn't find usage rows in that file. Export usage from your provider (see the guide below) and try again.",
      }
    }
    const revenueMap = data.revenueMapCsv ? parseRevenueMap(data.revenueMapCsv).map : undefined
    const bundle = analyzeAll(parsed.rows, { periodLabel: periodLabelFor(parsed.rows), revenueMap })
    const id = await persistBundle(bundle, {
      source: 'upload',
      scenario: 'upload',
      rows: parsed.rows,
      revenueMap,
    })
    return { ok: true, id, rowCount: parsed.rowCount, warnings: parsed.warnings }
  })

/**
 * Pull usage directly from a provider with a pasted Admin key. The key is used
 * once here (server-side) and never stored or logged. Gemini has no key-based
 * usage API → directs to upload.
 */
export const createScanFromConnector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ provider: z.enum(['openai', 'anthropic', 'gemini']), apiKey: z.string().min(16) }).parse(d),
  )
  .handler(async ({ data }): Promise<UploadResult> => {
    if (data.provider === 'gemini') {
      return {
        ok: false,
        warnings: [],
        error: 'Gemini usage runs through Google Cloud Billing - export a billing report and upload it below.',
      }
    }
    try {
      const rows =
        data.provider === 'openai'
          ? await fetchOpenAIUsage(data.apiKey)
          : await fetchAnthropicUsage(data.apiKey)
      const bundle = analyzeAll(rows, { periodLabel: periodLabelFor(rows) })
      const id = await persistBundle(bundle, { source: data.provider, scenario: 'connect', rows })
      return { ok: true, id, rowCount: rows.length, warnings: [] }
    } catch (e) {
      return {
        ok: false,
        warnings: [],
        error:
          e instanceof ConnectorError
            ? e.message
            : 'We could not pull usage from that provider. Check the key and try again.',
      }
    }
  })

/* ── READ ────────────────────────────────────────────────────── */

export interface HubCard {
  slug: string
  status: string
  name: string
  tagline: string
  icon: string
  snapshot: Snapshot | null
  unlocked: boolean
  price: number
  available: boolean
}
export interface ReportHub {
  id: string
  source: string
  createdAt: number
  costBasis: string | null
  reconciliation: CostReconciliation | null
  reports: HubCard[]
}

function hubFor(id: string): ReportHub | null {
  const row = db.select().from(scan).where(eq(scan.id, id)).get()
  if (!row) return null
  const reports = reportsFromRow(row)
  const unlocked = unlockedSlugs(row.id)
  const cards: HubCard[] = REPORTS.map((meta) => {
    const entry = reports[meta.slug as ReportSlug]
    return {
      slug: meta.slug,
      status: meta.status,
      name: meta.name,
      tagline: meta.tagline,
      icon: meta.icon,
      snapshot: entry ? entry.snapshot : null,
      unlocked: unlocked.has(meta.slug) || unlocked.has('bundle') || (meta.slug === 'ai-cost-health' && !!row.unlocked),
      price: REPORT_PRICE,
      available: !!entry,
    }
  })
  return {
    id: row.id,
    source: row.source,
    createdAt: createdMs(row),
    costBasis: row.costBasis ?? null,
    reconciliation: reports['ai-cost-health']?.report.reconciliation ?? null,
    reports: cards,
  }
}

export const getReportHub = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }): Promise<ReportHub | null> => hubFor(data.id))

function snapshotFor(id: string, slug: string): { slug: string; snapshot: Snapshot; unlocked: boolean } | null {
  const row = db.select().from(scan).where(eq(scan.id, id)).get()
  if (!row) return null
  const reports = reportsFromRow(row)
  const entry = reports[slug as ReportSlug]
  if (!entry) return null
  return { slug, snapshot: entry.snapshot, unlocked: unlockedFor(row, slug) }
}

export const getReportSnapshot = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string(), slug: z.string() }).parse(d))
  .handler(async ({ data }) => snapshotFor(data.id, data.slug))

function fullFor(id: string, slug: string): { unlocked: boolean; report: Report | null; snapshot: Snapshot | null } {
  const row = db.select().from(scan).where(eq(scan.id, id)).get()
  if (!row) return { unlocked: false, report: null, snapshot: null }
  const reports = reportsFromRow(row)
  const entry = reports[slug as ReportSlug]
  if (!entry) return { unlocked: false, report: null, snapshot: null }
  if (!unlockedFor(row, slug)) return { unlocked: false, report: null, snapshot: entry.snapshot }
  return { unlocked: true, report: entry.report, snapshot: entry.snapshot }
}

export const getFullReport = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string(), slug: z.string() }).parse(d))
  .handler(async ({ data }) => fullFor(data.id, data.slug))

/** Attach a project→revenue map and re-run ai-margin-leak (unlock untouched). */
export const attachRevenueMap = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ scanId: z.string(), csv: z.string().min(1) }).parse(d))
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; matched: number; unmatched: number; coveragePct: number; warnings: string[] }> => {
      const row = db.select().from(scan).where(eq(scan.id, data.scanId)).get()
      if (!row || !row.rowsJson) {
        return { ok: false, matched: 0, unmatched: 0, coveragePct: 0, warnings: ['Scan not found or not re-runnable.'] }
      }
      const { map, warnings } = parseRevenueMap(data.csv)
      const rows = JSON.parse(row.rowsJson) as UsageRow[]
      const bundle = analyzeAll(rows, { periodLabel: periodLabelFor(rows), revenueMap: map })
      const reports = reportsFromRow(row)
      reports['ai-margin-leak'] = bundle.reports['ai-margin-leak']
      const projectKeys = new Set(rows.map((r) => r.project))
      const matched = map.entries.filter((e) => projectKeys.has(e.key)).length
      const coveragePct = bundle.reports['ai-margin-leak'].report.extras?.coveragePct ?? 0
      await db
        .update(scan)
        .set({ reportsJson: JSON.stringify(reports), revenueMapJson: JSON.stringify(map) })
        .where(eq(scan.id, data.scanId))
      return { ok: true, matched, unmatched: map.entries.length - matched, coveragePct, warnings }
    },
  )

/* ── Back-compat shims (DESIGN.md contract) ──────────────────── */

export interface ScanPublic {
  id: string
  source: string
  createdAt: number
  unlocked: boolean
  snapshot: Snapshot
}

export const getScan = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }): Promise<ScanPublic | null> => {
    const row = db.select().from(scan).where(eq(scan.id, data.id)).get()
    if (!row) return null
    const s = snapshotFor(data.id, 'ai-cost-health')
    if (!s) return null
    return { id: row.id, source: row.source, createdAt: createdMs(row), unlocked: s.unlocked, snapshot: s.snapshot }
  })

export const getScanReport = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => fullFor(data.id, 'ai-cost-health'))

/* ── Admin ───────────────────────────────────────────────────── */

export const listScans = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  const rows = db.select().from(scan).orderBy(desc(scan.createdAt)).limit(100).all()
  const unlocks = db.select().from(scanUnlock).all()
  const unlockCount = new Map<string, number>()
  for (const u of unlocks) unlockCount.set(u.scanId, (unlockCount.get(u.scanId) ?? 0) + 1)
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    scenario: r.scenario,
    spendAnalyzed: r.spendAnalyzed,
    healthScore: r.healthScore,
    costBasis: r.costBasis,
    unlocked: r.unlocked,
    unlockedReports: unlockCount.get(r.id) ?? (r.unlocked ? 1 : 0),
    email: r.email,
    createdAt: createdMs(r),
  }))
})
