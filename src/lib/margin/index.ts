/**
 * AI Margin Intelligence — top-level orchestrator.
 *
 *   Revenue + Usage + Cost  ─▶  Margin Ledger  ─▶  Health / Leaks / Risk / Recs / CFO Report
 *
 * One pure pass over the data. `revenue` empty ⇒ Path B (Cost Intelligence) with
 * the Stripe upsell; `revenue` present ⇒ Path A (full Margin Intelligence).
 */
import type { RevenueRow, UsageRow } from '@/lib/analysis/types'
import { buildLedger, type LedgerOptions } from './ledger'
import { detectLeaks } from './leaks'
import { scoreMargin, assessRisk } from './health'
import { rank } from './recommend'
import { renderWeeklyCfo } from './reports'
import type { MarginResult } from './types'

export * from './types'
export { buildLedger, marginStatus, entityKey } from './ledger'
export { detectLeaks } from './leaks'
export { scoreMargin, assessRisk } from './health'
export { rank, recommendForLeak } from './recommend'
export { renderWeeklyCfo } from './reports'
export { resolveAttribution } from './attribution'
export { diffSnapshots } from './trend'
export type { SnapshotLite, CrossoverReport, MarginMove } from './trend'

export function analyzeMargin(
  usage: UsageRow[],
  revenue: RevenueRow[] = [],
  opts: LedgerOptions = {},
): MarginResult {
  const ledger = buildLedger(usage, revenue, opts)
  const leaks = detectLeaks(ledger, usage)
  const health = scoreMargin(ledger)
  const risks = assessRisk(ledger)
  const recommendations = rank(leaks)
  const cfo = renderWeeklyCfo(ledger, health, leaks, recommendations)
  return {
    ledger,
    health,
    leaks,
    risks,
    recommendations,
    cfo,
    mode: ledger.coverage.hasRevenue ? 'margin' : 'cost',
  }
}
