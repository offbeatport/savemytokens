import type { UsageRow, Provider } from './types'

/**
 * Mock usage datasets. Each scenario is defined as per-(project,model)
 * monthly aggregates, then deterministically spread across a fixed 30-day
 * window (anchored dates → stable tests) with one engineered spike day.
 * No randomness, so the engine output is reproducible.
 */

export type ScenarioKey = 'acme' | 'healthy' | 'scaleup'

interface Aggregate {
  project: string
  model: string
  provider: Provider
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
  errors?: number
}

// Fixed 30-day window so snapshots are deterministic across runs/tests.
const ANCHOR_END = '2026-06-06'

// 30 daily weights: gentle waves + weekend dips + a spike on day index 21.
const WEIGHTS = [
  0.9, 1.0, 1.05, 1.0, 0.95, 0.6, 0.55, 0.95, 1.1, 1.15, 1.05, 1.0, 0.65, 0.6,
  1.0, 1.1, 1.2, 1.15, 1.05, 0.7, 0.6, 2.6, 1.2, 1.1, 1.0, 0.95, 0.65, 0.6, 1.0,
  1.05,
]
const WEIGHT_SUM = WEIGHTS.reduce((a, b) => a + b, 0)

function dateList(): string[] {
  const end = new Date(ANCHOR_END + 'T00:00:00Z')
  const out: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(end.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function expand(aggs: Aggregate[]): UsageRow[] {
  const dates = dateList()
  const rows: UsageRow[] = []
  for (const a of aggs) {
    for (let i = 0; i < dates.length; i++) {
      const w = WEIGHTS[i] / WEIGHT_SUM
      const requests = Math.round(a.requests * w)
      if (requests <= 0) continue
      rows.push({
        provider: a.provider,
        model: a.model,
        date: dates[i],
        project: a.project,
        inputTokens: Math.round(a.inputTokens * w),
        outputTokens: Math.round(a.outputTokens * w),
        requests,
        cost: Math.round(a.cost * w * 100) / 100,
        costSource: 'actual',
        errors: a.errors ? Math.round(a.errors * w) : 0,
        latencyMs: undefined,
      })
    }
  }
  return rows
}

/* ── Scenario: "acme" - the canonical savings demo ───────────────
   ~$8.4k analyzed, 6 opportunities, output ≈ 41% of spend, one spike.
   Designed so model-downgrade (gpt-4o) is the highest-impact (locked)
   finding and output-caps is the visible middle-ground insight. */
const ACME: Aggregate[] = [
  // checkout-agent - dominant project (~52%), premium models
  { project: 'checkout-agent', model: 'gpt-4o', provider: 'openai', requests: 229500, inputTokens: 229500 * 3500, outputTokens: 229500 * 650, cost: 3500 },
  { project: 'checkout-agent', model: 'claude-3-opus', provider: 'anthropic', requests: 17650, inputTokens: 17650 * 2000, outputTokens: 17650 * 280, cost: 900 },
  // support-bot
  { project: 'support-bot', model: 'gpt-4o-mini', provider: 'openai', requests: 1395000, inputTokens: 1395000 * 2500, outputTokens: 1395000 * 450, cost: 900 },
  { project: 'support-bot', model: 'gpt-4o', provider: 'openai', requests: 91600, inputTokens: 91600 * 1500, outputTokens: 91600 * 280, cost: 600 },
  // doc-summarizer - large repeated prompts (caching) + verbose output
  { project: 'doc-summarizer', model: 'claude-3-5-sonnet', provider: 'anthropic', requests: 30100, inputTokens: 30100 * 9000, outputTokens: 30100 * 1300, cost: 1400 },
  // batch-classifier - high volume + errors (retry waste)
  { project: 'batch-classifier', model: 'gpt-4o-mini', provider: 'openai', requests: 1515000, inputTokens: 1515000 * 1800, outputTokens: 1515000 * 320, cost: 700, errors: 130000 },
  // internal-tools - small, right-sized (no finding)
  { project: 'internal-tools', model: 'gemini-1.5-pro', provider: 'gemini', requests: 88400, inputTokens: 88400 * 2200, outputTokens: 88400 * 400, cost: 420 },
]

/* ── Scenario: "healthy" - no obvious savings ─────────────────────
   Right-sized cheap models, balanced output share, no concentration. */
const HEALTHY: Aggregate[] = [
  { project: 'search-rerank', model: 'gpt-4o-mini', provider: 'openai', requests: 2400000, inputTokens: 2400000 * 1500, outputTokens: 2400000 * 180, cost: 800 },
  { project: 'tagging', model: 'gemini-1.5-flash', provider: 'gemini', requests: 4200000, inputTokens: 4200000 * 1200, outputTokens: 4200000 * 150, cost: 780 },
  { project: 'inbox-assist', model: 'claude-3-5-haiku', provider: 'anthropic', requests: 900000, inputTokens: 900000 * 1400, outputTokens: 900000 * 220, cost: 820 },
  { project: 'moderation', model: 'gpt-4o-mini', provider: 'openai', requests: 2300000, inputTokens: 2300000 * 1300, outputTokens: 2300000 * 160, cost: 760 },
]

/* ── Scenario: "scaleup" - mid-size, a few findings ───────────────── */
const SCALEUP: Aggregate[] = [
  { project: 'rag-api', model: 'gpt-4o', provider: 'openai', requests: 120000, inputTokens: 120000 * 4200, outputTokens: 120000 * 700, cost: 1800 },
  { project: 'rag-api', model: 'gpt-4o-mini', provider: 'openai', requests: 900000, inputTokens: 900000 * 2000, outputTokens: 900000 * 300, cost: 420 },
  { project: 'agents', model: 'claude-3-5-sonnet', provider: 'anthropic', requests: 40000, inputTokens: 40000 * 6500, outputTokens: 40000 * 1500, cost: 1100, errors: 9000 },
  { project: 'analytics', model: 'gemini-1.5-flash', provider: 'gemini', requests: 1800000, inputTokens: 1800000 * 1100, outputTokens: 1800000 * 160, cost: 300 },
]

const SCENARIO_AGGS: Record<ScenarioKey, Aggregate[]> = {
  acme: ACME,
  healthy: HEALTHY,
  scaleup: SCALEUP,
}

export interface ScenarioMeta {
  key: ScenarioKey
  label: string
  blurb: string
}

export const SCENARIOS: ScenarioMeta[] = [
  { key: 'acme', label: 'Acme AI (savings found)', blurb: '~$8.4k analyzed · 6 opportunities · output-heavy' },
  { key: 'scaleup', label: 'Scaleup (mixed)', blurb: '~$3.6k analyzed · a few opportunities' },
  { key: 'healthy', label: 'Lean Co (healthy)', blurb: '~$3.2k analyzed · spend looks healthy' },
]

export function mockUsage(scenario: ScenarioKey = 'acme'): UsageRow[] {
  return expand(SCENARIO_AGGS[scenario] ?? ACME)
}

/** A downloadable CSV template / sample export the upload screen can use. */
export function sampleCsv(scenario: ScenarioKey = 'acme'): string {
  const rows = mockUsage(scenario)
  const header = 'provider,model,date,project,input_tokens,output_tokens,requests,total_cost,errors'
  const body = rows
    .map((r) =>
      [r.provider, r.model, r.date, r.project, r.inputTokens, r.outputTokens, r.requests, r.cost.toFixed(2), r.errors ?? 0].join(','),
    )
    .join('\n')
  return `${header}\n${body}\n`
}
