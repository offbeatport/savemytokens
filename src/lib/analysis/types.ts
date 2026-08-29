export type Provider = 'openai' | 'anthropic' | 'gemini' | 'other'
export type SourceKind = 'upload' | 'openai' | 'anthropic' | 'gemini' | 'sample'

/** The 5 reports a single scan produces. */
export type ReportSlug =
  | 'ai-cost-health'
  | 'model-output-waste'
  | 'prompt-cache-readiness'
  | 'ai-margin-leak'
  | 'agent-waste-detector'

/** Which full-report renderer family a report uses. */
export type ReportKind = 'findings' | 'margin'

/** The only usage data we ever need - no prompts or responses. */
export interface UsageRow {
  provider: Provider
  model: string
  date: string // YYYY-MM-DD
  project: string // project or API-key label
  // Dimensional attribution (optional → back-compatible). Margin Intelligence rolls
  // usage up along each of these axes; `project` remains the always-present fallback.
  customerId?: string // joins to Stripe/revenue
  plan?: string
  feature?: string
  workspace?: string
  inputTokens: number
  outputTokens: number
  requests: number
  cost: number // USD for this aggregate row
  latencyMs?: number
  errors?: number
  /** Reasoning/thinking tokens (subset of output), when the export breaks them out. */
  reasoningTokens?: number
  /** Provider cache-read input tokens (billed at a discount), when present. */
  cacheReadTokens?: number
  /** Provider cache-write/creation input tokens (billed at a premium), when present. */
  cacheWriteTokens?: number
  /** Whether `cost` came from the provider ('actual') or list-price estimate. */
  costSource?: 'actual' | 'estimated'
}

export type Severity = 'high' | 'medium' | 'low'
export type Confidence = 'high' | 'medium' | 'low'

/**
 * Provability tier (orthogonal to `confidence`/`costSource`):
 * - 'confirmed' = provable from metadata alone, no behavioral assumption
 *   (deprecated-model price facts, cost-vs-revenue comparisons, pure aggregations).
 * - 'suspected' = inferential — a flag to investigate, not a proven number.
 */
export type ConfidenceTier = 'confirmed' | 'suspected'

export type FindingCategory =
  | 'model-downgrade'
  | 'output-caps'
  | 'prompt-caching'
  | 'retry-waste'
  | 'project-leak'
  | 'legacy-model'
  | 'prompt-bloat'

export interface Finding {
  id: string
  rank: number // 1 = highest estimated impact
  title: string
  category: FindingCategory
  categoryLabel: string
  severity: Severity
  confidence: Confidence
  estMonthlyLow: number
  estMonthlyHigh: number
  affectedProjects: string[]
  affectedModels: string[]
  evidence: string // data-backed observation
  fix: string // exact recommended change
  detail: string // longer explanation for the paid report
  metrics?: FindingMetric[] // the receipts: the exact math behind this finding (paid report only)
  /** Provability tier - assigned centrally in assembleReport (same pattern as rank/metrics). */
  confidenceTier?: ConfidenceTier
  /** One-line plain-English rationale for the tier (Confirmed vs Suspected). */
  tierReason?: string
}

/** One line of the "receipts" shown under a finding - a checkable number. */
export interface FindingMetric {
  label: string
  value: string
  emphasis?: boolean // render as the headline figure
}

export type Band = 'healthy' | 'watch' | 'leaking'

export interface SpendByModel {
  model: string
  provider: Provider
  cost: number
  pct: number
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface SpendByProject {
  project: string
  cost: number
  pct: number
  requests: number
}

export interface TokenSplit {
  inputCost: number
  outputCost: number
  inputTokens: number
  outputTokens: number
  outputCostPct: number
  outputTokenPct: number
}

export interface Spike {
  date: string
  cost: number
  baseline: number
  deltaPct: number
  note: string
}

export interface TrendPoint {
  date: string
  cost: number
}

/** Cost provenance for a scan, surfaced on snapshot/report. */
export interface CostReconciliation {
  costBasis: 'actual' | 'estimated' | 'mixed'
  spendActual: number
  spendEstimated: number
  actualPct: number // 0..1
  invoiceTotal?: number
  reconciledTotal: number
  note: string
}

/** Optional project→revenue mapping that upgrades ai-margin-leak. */
export interface RevenueEntry {
  key: string
  monthlyRevenue: number
  plan?: string
}
export interface RevenueMap {
  keyBy: 'project'
  entries: RevenueEntry[]
}

/** Customer-keyed revenue (Margin Intelligence). Source = Stripe pull or CSV/manual. */
export interface RevenueRow {
  customerId: string
  label: string
  plan?: string
  monthlyRevenue: number // normalized MRR
  source: 'stripe' | 'csv' | 'manual'
  asOf?: string // YYYY-MM-DD
}

/** A margin-leak table row (full report only). */
export interface MarginRow {
  key: string
  plan?: string
  cost: number
  revenue?: number
  marginPct?: number
  belowCost: boolean
}

export interface ReportExtras {
  marginRows?: MarginRow[]
  coveragePct?: number
}

/** Per-tier rollup for the snapshot headline. Confirmed and Suspected are
 * presented separately and NEVER summed into one number. */
export interface TierSummary {
  savingsLow: number
  savingsHigh: number
  count: number
  /** Locked category labels in this tier (excludes the one free-revealed insight). */
  categories: string[]
}

/** Free preview - deliberately withholds the top/highest-value opportunity. */
export interface Snapshot {
  spendAnalyzed: number
  periodLabel: string
  healthScore: number
  band: Band
  bandLabel: string
  estSavingsLow: number
  estSavingsHigh: number
  opportunityCount: number
  visibleInsight: { title: string; body: string }
  lockedCount: number
  lockedCategories: string[]
  topModel: { model: string; pct: number }
  outputCostPct: number
  // multi-report additions (optional → back-compatible)
  slug?: ReportSlug
  costBasis?: CostReconciliation['costBasis']
  metadataLimited?: boolean
  /** Confidence-tier split. Confirmed leads; the two are never summed into one headline. */
  confirmed?: TierSummary
  suspected?: TierSummary
}

export interface HealthyReport {
  whatLooksGood: string[]
  whatToMonitor: string[]
  warningSigns: string[]
  budgetThresholds: { label: string; value: string }[]
}

/**
 * A visibility metric that is NOT a dollar-savings finding (so it never enters
 * the leak ledger): reasoning-token share, unattributed-spend score, cache
 * health. `status` drives the badge; `available: false` means the data wasn't
 * in the export and we say so rather than guess.
 */
export interface DiagnosticMetric {
  id: string
  label: string
  value: string
  status: 'good' | 'watch' | 'risk' | 'info'
  benchmark?: string
  detail: string
  available: boolean
  /** 'confirmed' when this is a measured fact present in the data; else undefined. */
  confidenceTier?: ConfidenceTier
}

/** One row of the market & quality check: the user's model vs the market. */
export interface MarketRow {
  model: string
  provider: Provider
  cost: number // user's monthly spend on this model
  inPer1m?: number
  outPer1m?: number
  qualityIndex?: number // third-party intelligence index (0-100)
  arenaElo?: number
  deprecated?: boolean
  successor?: string
  batchEligible?: boolean
  promptCaching?: boolean
  /** Cheapest credible equivalent destination for this model's work. */
  bestAlt?: {
    model: string
    host: string
    inPer1m: number
    outPer1m: number
    qualityIndex?: number
    arenaElo?: number
    sameModel: boolean
    cheaperPct: number // 0..1 blended savings vs the user's model
  }
}

/** Full paid report. */
export interface Report {
  spendAnalyzed: number
  periodLabel: string
  healthScore: number
  band: Band
  bandLabel: string
  healthy: boolean
  estMonthlyImpactLow: number
  estMonthlyImpactHigh: number
  /** Confidence-tier split of the impact (never summed in the UI). */
  confirmedImpactLow?: number
  confirmedImpactHigh?: number
  suspectedImpactLow?: number
  suspectedImpactHigh?: number
  executiveSummary: string
  findings: Finding[]
  topLeaks: Finding[]
  spendByModel: SpendByModel[]
  spendByProject: SpendByProject[]
  tokenSplit: TokenSplit
  spikes: Spike[]
  trend: TrendPoint[]
  founderMemo: string // markdown
  healthyReport?: HealthyReport
  generatedFromLlm: boolean
  // multi-report additions (optional → back-compatible)
  slug?: ReportSlug
  kind?: ReportKind
  reconciliation?: CostReconciliation
  extras?: ReportExtras
  metadataLimited?: boolean
  limitationNote?: string
  confidenceNote?: string
  /** Visibility metrics (reasoning %, unattributed %, cache health) - not savings. */
  diagnostics?: DiagnosticMetric[]
  /** The user's models joined against current market prices + quality benchmarks. */
  marketRows?: MarketRow[]
  marketAsOf?: string
}

export interface ScanResult {
  snapshot: Snapshot
  report: Report
}
