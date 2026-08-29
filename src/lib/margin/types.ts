/**
 * AI Margin Intelligence — domain model.
 *
 * The product answers: "which customers, plans, features, workspaces, projects,
 * and models are hurting my AI margins?" Revenue → Cost → Margin. Cost is
 * supporting EVIDENCE; margin is the primary outcome. Everything (Health, Risk,
 * Leaks, Recommendations, Reports) is a read-view of the Margin Ledger.
 */
import type {
  Confidence,
  ConfidenceTier,
  CostReconciliation,
  FindingCategory,
  FindingMetric,
  Report,
  RevenueRow,
  UsageRow,
} from '@/lib/analysis/types'

export type { RevenueRow, UsageRow } from '@/lib/analysis/types'

/** The dimensions every fact is attributable along. */
export type EntityKind = 'customer' | 'plan' | 'feature' | 'workspace' | 'project' | 'model'

export const ENTITY_KINDS: EntityKind[] = ['customer', 'plan', 'feature', 'workspace', 'project', 'model']

export interface EntityRef {
  kind: EntityKind
  id: string
  label: string
}

/** Derived margin classification — the headline language. */
export type MarginStatus = 'below-cost' | 'thin' | 'healthy' | 'strong' | 'unknown'

/** One atom of the ledger: an entity's economics for a period. */
export interface MarginLedgerRow {
  entity: EntityRef
  period: string // YYYY-MM
  revenue: number
  cost: number
  costActual: number
  costEstimated: number
  margin: number // revenue - cost
  marginPct: number | null // null when no revenue joined (Path B)
  status: MarginStatus
  requests: number
  inputTokens: number
  outputTokens: number
  topModels: { model: string; cost: number; pct: number }[]
  coverage: 'full' | 'cost-only'
  /** true when revenue was allocated by cost-share (modeled), not directly joined. */
  allocated?: boolean
}

export interface MarginLedger {
  period: string
  periodLabel: string
  rows: MarginLedgerRow[] // every (entity, dimension) row
  byDimension: Record<EntityKind, MarginLedgerRow[]>
  totals: { revenue: number; cost: number; margin: number; marginPct: number | null }
  reconciliation: CostReconciliation
  coverage: { hasRevenue: boolean; revenueCoveragePct: number; attributedCostPct: number }
}

/** A former cost finding, now subordinate to a margin leak. */
export interface Evidence {
  category: FindingCategory
  title: string
  detail: string
  estMonthlyLow: number
  estMonthlyHigh: number
  confidence: Confidence
  confidenceTier: ConfidenceTier
  metrics: FindingMetric[]
  affectedModels: string[]
}

/** The PARENT object. Always tied to a concrete entity. */
export interface MarginLeak {
  id: string
  entity: EntityRef
  status: MarginStatus
  revenue: number
  cost: number
  marginPct: number | null
  monthlyImpact: number // recoverable / at-risk $ this leak represents
  summary: string // plain-English, business-first
  evidence: Evidence[] // cost detectors attach here
  confidenceTier: ConfidenceTier
}

export type MarginBand = 'strong' | 'healthy' | 'watch' | 'leaking'

export interface MarginHealth {
  score: number // 0..100
  band: MarginBand
  bandLabel: string
  hasRevenue: boolean
  revenue: number
  cost: number
  margin: number
  marginPct: number | null
  revenueAtRisk: number // $ of revenue on below-cost + thin accounts
  belowCostCount: number
  thinCount: number
  summary: string
}

export type RiskKind = 'concentration' | 'trend' | 'thin-margin'

export interface MarginRisk {
  id: string
  kind: RiskKind
  entity?: EntityRef
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  available: boolean // false when we lack the data (e.g. no history for trend)
}

export type RecAction =
  | 'reprice'
  | 'rate-limit'
  | 'model-downgrade'
  | 'enable-caching'
  | 'cap-output'
  | 'fix-retries'
  | 'trim-prompt'
  | 'investigate'

export interface Recommendation {
  id: string
  entity: EntityRef // ALWAYS a customer/plan/feature/workspace/project — never generic
  leakId: string
  title: string
  action: RecAction
  monthlyImpact: number
  confidence: number // 0..1
  ease: number // 0..1
  score: number // monthlyImpact × confidence × ease
  difficulty: 'low' | 'medium' | 'high'
  rationale: string // ties cost evidence to the margin outcome
  evidence: Evidence[]
}

export interface CfoSection {
  label: string
  value: string
  delta?: string
  tone?: 'good' | 'watch' | 'risk' | 'neutral'
}

export interface WeeklyCfoReport {
  periodLabel: string
  hasBaseline: boolean
  headline: string
  sections: CfoSection[]
  topRecommendation?: Recommendation
  estimatedBusinessImpact: number
}

/* ── Attribution (usage → customer) ──────────────────────────── */

export type AttributionMethod = 'explicit' | 'manual' | 'exact' | 'fuzzy' | 'unmatched'

export interface AttributionMatch {
  key: string // the usage attribution key (project / workspace / api-key)
  customerId: string
  customerLabel: string
  method: AttributionMethod
  score: number // 0..1
  cost: number // cost attributed via this match
}

export interface AttributionSuggestion {
  key: string
  customerId: string
  customerLabel: string
  score: number
  cost: number
}

/** How well usage was tied to revenue customers — the not-Excel layer. */
export interface AttributionReport {
  method: 'pre-tagged' | 'matched' | 'none'
  attributedPct: number // % of cost mapped to a customer
  matched: AttributionMatch[]
  unmatched: { key: string; cost: number }[]
  suggestions: AttributionSuggestion[] // fuzzy hits to confirm
}

/** The complete read-model produced from one ingest. */
export interface MarginResult {
  ledger: MarginLedger
  health: MarginHealth
  leaks: MarginLeak[]
  risks: MarginRisk[]
  recommendations: Recommendation[]
  cfo: WeeklyCfoReport
  mode: 'margin' | 'cost' // margin = Path A (revenue joined); cost = Path B
  attribution?: AttributionReport
  /** Full cost-health report (spend-by-model, diagnostics, market, memo) → the Cost breakdown tab. */
  costReport?: Report
}
