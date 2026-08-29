import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { analyzeMargin } from './index'
import type { MarginResult } from './types'
import type { RevenueRow, UsageRow } from '@/lib/analysis/types'

// Proves the persistence round-trip: the exact margin_ingest DDL accepts the row,
// and a computed MarginResult survives JSON serialize → store → load → parse intact.
const DDL = `
  CREATE TABLE margin_ingest (
    id TEXT PRIMARY KEY, user_id TEXT, source TEXT NOT NULL, period TEXT NOT NULL,
    period_label TEXT NOT NULL, mode TEXT NOT NULL, has_revenue INTEGER NOT NULL DEFAULT 0,
    cost_basis TEXT, usage_json TEXT NOT NULL, revenue_json TEXT, result_json TEXT,
    email TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`

function fixture(): { usage: UsageRow[]; revenue: RevenueRow[] } {
  const usage: UsageRow[] = []
  for (let d = 1; d <= 10; d++) {
    usage.push({ provider: 'openai', model: 'gpt-4o', date: `2026-05-${String(d).padStart(2, '0')}`, project: 'acme', customerId: 'acme', feature: 'research', plan: 'pro', inputTokens: 4_000_000, outputTokens: 1_000_000, requests: 800, cost: 20, costSource: 'actual' })
    usage.push({ provider: 'openai', model: 'gpt-4o-mini', date: `2026-05-${String(d).padStart(2, '0')}`, project: 'globex', customerId: 'globex', feature: 'auto', plan: 'scale', inputTokens: 500_000, outputTokens: 80_000, requests: 4000, cost: 4, costSource: 'actual' })
  }
  return { usage, revenue: [
    { customerId: 'acme', label: 'Acme', plan: 'pro', monthlyRevenue: 150, source: 'csv' },
    { customerId: 'globex', label: 'Globex', plan: 'scale', monthlyRevenue: 3000, source: 'csv' },
  ] }
}

describe('margin persistence round-trip', () => {
  it('stores + reloads a MarginResult through the real schema', () => {
    const db = new Database(':memory:')
    db.exec(DDL)
    const { usage, revenue } = fixture()
    const result = analyzeMargin(usage, revenue, { periodLabel: 'May 2026' })

    db.prepare(
      `INSERT INTO margin_ingest (id, source, period, period_label, mode, has_revenue, cost_basis, usage_json, revenue_json, result_json)
       VALUES (@id,@source,@period,@period_label,@mode,@has_revenue,@cost_basis,@usage_json,@revenue_json,@result_json)`,
    ).run({
      id: 'm_test',
      source: 'sample',
      period: result.ledger.period,
      period_label: result.ledger.periodLabel,
      mode: result.mode,
      has_revenue: result.ledger.coverage.hasRevenue ? 1 : 0,
      cost_basis: result.ledger.reconciliation.costBasis,
      usage_json: JSON.stringify(usage),
      revenue_json: JSON.stringify(revenue),
      result_json: JSON.stringify(result),
    })

    const row = db.prepare('SELECT * FROM margin_ingest WHERE id = ?').get('m_test') as { result_json: string; mode: string }
    const loaded = JSON.parse(row.result_json) as MarginResult

    expect(row.mode).toBe('margin')
    expect(loaded.health.belowCostCount).toBe(result.health.belowCostCount)
    expect(loaded.leaks.length).toBe(result.leaks.length)
    expect(loaded.leaks[0].entity.label).toBe(result.leaks[0].entity.label)
    expect(loaded.recommendations[0].monthlyImpact).toBe(result.recommendations[0].monthlyImpact)
    expect(loaded.cfo.sections.length).toBeGreaterThan(4)
    db.close()
  })
})
