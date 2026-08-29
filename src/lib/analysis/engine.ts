import type {
  UsageRow,
  Finding,
  FindingMetric,
  DiagnosticMetric,
  Snapshot,
  Report,
  ScanResult,
  Band,
  Confidence,
  SpendByModel,
  SpendByProject,
  TokenSplit,
  Spike,
  TrendPoint,
  HealthyReport,
  FindingCategory,
  CostReconciliation,
  RevenueMap,
  ReportExtras,
  MarginRow,
  MarketRow,
  ReportSlug,
  ConfidenceTier,
  TierSummary,
} from './types'
import { priceFor, blendedPrice } from './pricing'
import { marketFor, bestAlternative, blendOf, MARKET_AS_OF } from './market'
import { usd, usdRange, pct, num } from '@/lib/format'
import { ALL_REPORT_DEFS, REGISTRY, type ReportDef } from './registry'

const round = (n: number) => Math.round(n)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs))
const midpoint = (f: Finding) => (f.estMonthlyLow + f.estMonthlyHigh) / 2

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }
function minConfidence(...cs: Confidence[]): Confidence {
  let best: Confidence = 'high'
  for (const c of cs) if (CONF_RANK[c] < CONF_RANK[best]) best = c
  return best
}

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  'model-downgrade': 'Model right-sizing',
  'output-caps': 'Output length',
  'prompt-caching': 'Prompt caching',
  'retry-waste': 'Retries & errors',
  'project-leak': 'Project cost leak',
  'legacy-model': 'Legacy model',
  'prompt-bloat': 'Prompt size',
}

export interface Totals {
  cost: number
  requests: number
  inputTokens: number
  outputTokens: number
  inputCost: number
  outputCost: number
  errors: number
}

/** Split each row's known cost into input/output using list-price ratios. */
function rowSplit(r: UsageRow): { inputCost: number; outputCost: number } {
  const p = priceFor(r.model)
  const rawIn = (r.inputTokens / 1e6) * p.in
  const rawOut = (r.outputTokens / 1e6) * p.out
  const raw = rawIn + rawOut
  if (raw <= 0) return { inputCost: r.cost * 0.5, outputCost: r.cost * 0.5 }
  return { inputCost: r.cost * (rawIn / raw), outputCost: r.cost * (rawOut / raw) }
}

function totals(rows: UsageRow[]): Totals {
  let inputCost = 0
  let outputCost = 0
  for (const r of rows) {
    const s = rowSplit(r)
    inputCost += s.inputCost
    outputCost += s.outputCost
  }
  return {
    cost: sum(rows.map((r) => r.cost)),
    requests: sum(rows.map((r) => r.requests)),
    inputTokens: sum(rows.map((r) => r.inputTokens)),
    outputTokens: sum(rows.map((r) => r.outputTokens)),
    errors: sum(rows.map((r) => r.errors ?? 0)),
    inputCost,
    outputCost,
  }
}

function byModel(rows: UsageRow[], total: number): SpendByModel[] {
  const map = new Map<string, SpendByModel>()
  for (const r of rows) {
    const e =
      map.get(r.model) ??
      ({
        model: r.model,
        provider: r.provider,
        cost: 0,
        pct: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      } satisfies SpendByModel)
    e.cost += r.cost
    e.requests += r.requests
    e.inputTokens += r.inputTokens
    e.outputTokens += r.outputTokens
    map.set(r.model, e)
  }
  return [...map.values()]
    .map((e) => ({ ...e, cost: round(e.cost), pct: total ? (e.cost / total) * 100 : 0 }))
    .sort((a, b) => b.cost - a.cost)
}

function byProject(rows: UsageRow[], total: number): SpendByProject[] {
  const map = new Map<string, SpendByProject>()
  for (const r of rows) {
    const e = map.get(r.project) ?? { project: r.project, cost: 0, pct: 0, requests: 0 }
    e.cost += r.cost
    e.requests += r.requests
    map.set(r.project, e)
  }
  return [...map.values()]
    .map((e) => ({ ...e, cost: round(e.cost), pct: total ? (e.cost / total) * 100 : 0 }))
    .sort((a, b) => b.cost - a.cost)
}

function dailyTrend(rows: UsageRow[]): TrendPoint[] {
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.date, (map.get(r.date) ?? 0) + r.cost)
  return [...map.entries()]
    .map(([date, cost]) => ({ date, cost: round(cost) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function detectSpikes(trend: TrendPoint[]): Spike[] {
  if (trend.length < 4) return []
  const costs = trend.map((t) => t.cost).sort((a, b) => a - b)
  const median = costs[Math.floor(costs.length / 2)]
  if (median <= 0) return []
  return trend
    .filter((t) => t.cost > median * 1.8)
    .map((t) => ({
      date: t.date,
      cost: t.cost,
      baseline: round(median),
      deltaPct: round(((t.cost - median) / median) * 100),
      note: `Daily spend hit ${usd(t.cost)} vs a ${usd(median)} median.`,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 4)
}

/* ── Cost reconciliation ─────────────────────────────────────── */

export function reconcileCosts(rows: UsageRow[], invoiceTotal?: number): CostReconciliation {
  let rawActual = 0
  let rawEstimated = 0
  for (const r of rows) {
    if (r.costSource === 'actual') rawActual += r.cost
    else rawEstimated += r.cost
  }
  // Classify from RAW (pre-round) sums so a sub-$0.50 component isn't mislabeled.
  const costBasis: CostReconciliation['costBasis'] =
    rawEstimated === 0 ? 'actual' : rawActual === 0 ? 'estimated' : 'mixed'
  // Honor an invoice total only when plausible (>= provider-reported actual);
  // otherwise reconciledTotal == round(Σ cost) so it matches spendAnalyzed.
  const reconciledTotal =
    invoiceTotal && invoiceTotal >= rawActual ? round(invoiceTotal) : round(rawActual + rawEstimated)
  const actualPct = reconciledTotal ? Math.min(1, Math.max(0, rawActual / reconciledTotal)) : 0
  const actualPctInt = round(actualPct * 100)
  const note =
    costBasis === 'actual'
      ? 'All analyzed spend is provider-reported (actual).'
      : costBasis === 'estimated'
        ? 'Spend is estimated from public list prices - connect a cost export for exact figures.'
        : `${actualPctInt}% of analyzed spend is provider-reported; ${100 - actualPctInt}% estimated from list prices.`
  return {
    costBasis,
    spendActual: round(rawActual),
    spendEstimated: round(rawEstimated),
    actualPct,
    invoiceTotal,
    reconciledTotal,
    note,
  }
}

/* ── Shared scan context (computed once) ─────────────────────── */

export interface ScanContext {
  rows: UsageRow[]
  periodLabel: string
  totals: Totals
  models: SpendByModel[]
  projects: SpendByProject[]
  trend: TrendPoint[]
  spikes: Spike[]
  tokenSplit: TokenSplit
  reconciliation: CostReconciliation
  revenueMap?: RevenueMap
}

export interface AnalyzeOptions {
  periodLabel?: string
  revenueMap?: RevenueMap
  invoiceTotal?: number
}

export function buildContext(rows: UsageRow[], opts: AnalyzeOptions = {}): ScanContext {
  const periodLabel = opts.periodLabel ?? 'last 30 days'

  // Optional invoice anchoring: scale estimated rows so the total matches the invoice.
  let working = rows
  if (opts.invoiceTotal && opts.invoiceTotal > 0) {
    const actualSum = sum(rows.filter((r) => r.costSource === 'actual').map((r) => r.cost))
    const estSum = sum(rows.filter((r) => r.costSource !== 'actual').map((r) => r.cost))
    const delta = opts.invoiceTotal - actualSum
    if (estSum > 0 && delta > 0) {
      const factor = delta / estSum
      working = rows.map((r) =>
        r.costSource === 'actual' ? r : { ...r, cost: Math.round(r.cost * factor * 100) / 100 },
      )
    }
  }

  const t = totals(working)
  const total = t.cost
  const models = byModel(working, total)
  const projects = byProject(working, total)
  const trend = dailyTrend(working)
  const spikes = detectSpikes(trend)
  const outputCostPct = total ? round((t.outputCost / total) * 100) : 0
  const tokenSplit: TokenSplit = {
    inputCost: round(t.inputCost),
    outputCost: round(t.outputCost),
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    outputCostPct,
    outputTokenPct:
      t.inputTokens + t.outputTokens
        ? round((t.outputTokens / (t.inputTokens + t.outputTokens)) * 100)
        : 0,
  }
  const reconciliation = reconcileCosts(working, opts.invoiceTotal)
  return { rows: working, periodLabel, totals: t, models, projects, trend, spikes, tokenSplit, reconciliation, revenueMap: opts.revenueMap }
}

/* ── Finding detectors (one signature) ───────────────────────── */

export type Detector = (ctx: ScanContext) => Finding[]

export function detectModelDowngrade(ctx: ScanContext): Finding[] {
  const { rows, models } = ctx
  const out: Finding[] = []
  for (const m of models) {
    const price = priceFor(m.model)
    if (!price.cheaper || m.pct < 6) continue
    const savePerToken = 1 - blendedPrice(price.cheaper) / blendedPrice(m.model)
    if (savePerToken <= 0.1) continue
    const projects = uniq(rows.filter((r) => r.model === m.model).map((r) => r.project))
    const low = m.cost * savePerToken * 0.15
    const high = m.cost * savePerToken * 0.4
    out.push({
      id: `downgrade-${m.model}`,
      rank: 0,
      title: `Move suitable ${m.model} traffic to ${price.cheaper}`,
      category: price.legacy ? 'legacy-model' : 'model-downgrade',
      categoryLabel: CATEGORY_LABEL[price.legacy ? 'legacy-model' : 'model-downgrade'],
      severity: m.pct > 25 ? 'high' : m.pct > 12 ? 'medium' : 'low',
      confidence: m.pct > 20 ? 'high' : 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: projects,
      affectedModels: [m.model],
      evidence: `${m.model} is ${pct(m.pct)} of spend (${usd(m.cost)}) across ${num(m.requests)} requests. ${price.cheaper} costs ~${pct(savePerToken * 100)} less per token at comparable quality for routine calls.`,
      fix: `Route classification, extraction, and short-form calls from ${m.model} to ${price.cheaper}. Keep ${m.model} only for tasks that measurably need it. Start with the highest-volume project (${projects[0] ?? 'n/a'}).`,
      detail: `A/B a 20–35% traffic shift to ${price.cheaper} on ${projects[0] ?? 'the top project'} for one week. If quality holds (it usually does for non-reasoning tasks), expand. Expected range assumes 15–40% of ${m.model} volume is migratable.`,
    })
  }
  return out
}

export function detectOutputCaps(ctx: ScanContext): Finding[] {
  const { rows, totals: t } = ctx
  const outShare = t.cost ? t.outputCost / t.cost : 0
  if (outShare < 0.38) return []
  const proj = new Map<string, { out: number; req: number; cost: number }>()
  for (const r of rows) {
    const e = proj.get(r.project) ?? { out: 0, req: 0, cost: 0 }
    e.out += r.outputTokens
    e.req += r.requests
    e.cost += rowSplit(r).outputCost
    proj.set(r.project, e)
  }
  const verbose = [...proj.entries()]
    .map(([p, v]) => ({ p, perReq: v.req ? v.out / v.req : 0, cost: v.cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
  const low = t.outputCost * 0.08
  const high = t.outputCost * 0.18
  return [
    {
      id: 'output-caps',
      rank: 0,
      title: 'Cap and trim output tokens on high-volume endpoints',
      category: 'output-caps',
      categoryLabel: CATEGORY_LABEL['output-caps'],
      severity: outShare > 0.5 ? 'high' : 'medium',
      confidence: 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: verbose.map((v) => v.p),
      affectedModels: uniq(rows.map((r) => r.model)).slice(0, 4),
      evidence: `Output tokens drive ${pct(outShare * 100)} of total spend. Output is billed 3–5× input, so verbose completions compound fast. Heaviest: ${verbose.map((v) => `${v.p} (~${num(v.perReq)} out tok/req)`).join(', ')}.`,
      fix: `Set max_tokens ceilings per endpoint, ask for terse/structured output (JSON, bullet lists), and strip restated context from responses. Target the 3 projects above first.`,
      detail: `Output caps are the lowest-risk lever here - they rarely affect quality for structured tasks. Trimming verbose completions 8–18% on the listed projects yields the range shown.`,
    },
  ]
}

export function detectPromptCaching(ctx: ScanContext): Finding[] {
  const { rows } = ctx
  const proj = new Map<string, { in: number; req: number; cost: number; models: string[] }>()
  for (const r of rows) {
    const e = proj.get(r.project) ?? { in: 0, req: 0, cost: 0, models: [] }
    e.in += r.inputTokens
    e.req += r.requests
    e.cost += rowSplit(r).inputCost
    e.models.push(r.model)
    proj.set(r.project, e)
  }
  const candidates = [...proj.entries()]
    .map(([p, v]) => ({ p, perReq: v.req ? v.in / v.req : 0, req: v.req, cost: v.cost, models: uniq(v.models) }))
    .filter((c) => c.perReq > 2500 && c.req > 200)
    .sort((a, b) => b.cost - a.cost)
  if (!candidates.length) return []
  const cacheableCost = sum(candidates.map((c) => c.cost))
  const low = cacheableCost * 0.15
  const high = cacheableCost * 0.35
  if (high < 30) return []
  return [
    {
      id: 'prompt-caching',
      rank: 0,
      title: 'Enable provider prompt caching on large repeated prompts',
      category: 'prompt-caching',
      categoryLabel: CATEGORY_LABEL['prompt-caching'],
      severity: high > 400 ? 'high' : 'medium',
      confidence: 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: candidates.map((c) => c.p),
      affectedModels: uniq(candidates.flatMap((c) => c.models)).slice(0, 4),
      evidence: `${candidates.map((c) => `${c.p} sends ~${num(c.perReq)} input tok/request over ${num(c.req)} requests`).join('; ')}. Large, stable prefixes (system prompts, schemas, few-shot) re-sent every call are prime caching targets.`,
      fix: `Move the stable prefix into a cached block (Anthropic prompt caching / OpenAI automatic caching / Gemini context caching). Cached input tokens bill at 10–25% of standard rate.`,
      detail: `Reorder requests so the invariant context sits first, then enable caching. Savings range assumes 40–80% of input tokens in these projects become cache hits.`,
    },
  ]
}

export function detectRetryWaste(ctx: ScanContext): Finding[] {
  const { rows, totals: t } = ctx
  if (t.errors <= 0 || t.requests <= 0) return []
  const errRate = t.errors / t.requests
  if (errRate < 0.03) return []
  const worst = byProject(
    rows.filter((r) => (r.errors ?? 0) > 0),
    t.cost,
  ).slice(0, 3)
  const wasted = t.cost * errRate
  return [
    {
      id: 'retry-waste',
      rank: 0,
      title: 'Stop paying for retry storms and failed calls',
      category: 'retry-waste',
      categoryLabel: CATEGORY_LABEL['retry-waste'],
      severity: errRate > 0.08 ? 'high' : 'medium',
      confidence: errRate > 0.08 ? 'high' : 'medium',
      estMonthlyLow: round(wasted * 0.4),
      estMonthlyHigh: round(wasted * 0.9),
      affectedProjects: worst.map((w) => w.project),
      affectedModels: uniq(rows.map((r) => r.model)).slice(0, 3),
      evidence: `Error rate is ${pct(errRate * 100, 1)} (${num(t.errors)} of ${num(t.requests)} requests). Failed calls that still consume input tokens - plus naive retries - are paid twice.`,
      fix: `Add exponential backoff with a retry cap, idempotency keys, and a circuit breaker on ${worst[0]?.project ?? 'the worst project'}. Log and alert on error-rate regressions.`,
      detail: `Retry storms often hide in agent loops and webhook handlers. Capping retries and fixing the top error source typically recovers 50–100% of the wasted spend shown.`,
    },
  ]
}

export function detectProjectLeak(ctx: ScanContext): Finding[] {
  const { projects, rows } = ctx
  if (projects.length < 2) return []
  const top = projects[0]
  if (top.pct < 45) return []
  const models = uniq(rows.filter((r) => r.project === top.project).map((r) => r.model))
  const low = top.cost * 0.06
  const high = top.cost * 0.15
  return [
    {
      id: `leak-${top.project}`,
      rank: 0,
      title: `Audit concentration risk in "${top.project}"`,
      category: 'project-leak',
      categoryLabel: CATEGORY_LABEL['project-leak'],
      severity: top.pct > 60 ? 'high' : 'medium',
      confidence: 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: [top.project],
      affectedModels: models.slice(0, 4),
      evidence: `${top.project} alone is ${pct(top.pct)} of total spend (${usd(top.cost)}) across ${num(top.requests)} requests. Single-project concentration is where unbounded loops and over-provisioned models hide.`,
      fix: `Set a per-project budget alert on ${top.project}, break its traffic down by feature, and confirm no background job is calling the API in a loop.`,
      detail: `Concentration isn't inherently bad, but it magnifies any inefficiency. A 6–15% trim on the dominant project is usually achievable once its traffic is itemized.`,
    },
  ]
}

/* New metadata-only detectors */

export function detectPromptBloat(ctx: ScanContext): Finding[] {
  const { rows } = ctx
  const proj = new Map<string, { in: number; req: number; cost: number }>()
  for (const r of rows) {
    const e = proj.get(r.project) ?? { in: 0, req: 0, cost: 0 }
    e.in += r.inputTokens
    e.req += r.requests
    e.cost += rowSplit(r).inputCost
    proj.set(r.project, e)
  }
  const candidates = [...proj.entries()]
    .map(([p, v]) => ({ p, perReq: v.req ? v.in / v.req : 0, req: v.req, cost: v.cost }))
    .filter((c) => c.perReq > 4000 && c.req > 500)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
  if (!candidates.length) return []
  const bloatCost = sum(candidates.map((c) => c.cost))
  const low = bloatCost * 0.08
  const high = bloatCost * 0.2
  if (high < 25) return []
  return [
    {
      id: 'prompt-bloat',
      rank: 0,
      title: 'Trim oversized prompts on high-volume endpoints',
      category: 'prompt-bloat',
      categoryLabel: CATEGORY_LABEL['prompt-bloat'],
      severity: high > 400 ? 'high' : 'medium',
      confidence: 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: candidates.map((c) => c.p),
      affectedModels: uniq(rows.map((r) => r.model)).slice(0, 4),
      evidence: `${candidates.map((c) => `${c.p} averages ~${num(c.perReq)} input tok/request over ${num(c.req)} requests`).join('; ')}. Beyond caching, prompts this large usually carry dead context, redundant instructions, or oversized few-shot examples.`,
      fix: `Audit the prompts for these projects: cut stale few-shot examples, dedupe instructions, and retrieve only the context each call needs. Pair with caching for compounding savings.`,
      detail: `Prompt trimming is separate from caching - caching makes repeated tokens cheaper; trimming removes tokens entirely. Range assumes an 8–20% input-token reduction on the listed projects.`,
    },
  ]
}

export function detectRunawayVolume(ctx: ScanContext): Finding[] {
  const { rows, spikes } = ctx
  const proj = new Map<string, { req: number; tok: number; cost: number }>()
  for (const r of rows) {
    const e = proj.get(r.project) ?? { req: 0, tok: 0, cost: 0 }
    e.req += r.requests
    e.tok += r.inputTokens + r.outputTokens
    e.cost += r.cost
    proj.set(r.project, e)
  }
  const candidates = [...proj.entries()]
    .map(([p, v]) => ({ p, req: v.req, perReq: v.req ? v.tok / v.req : 0, cost: v.cost }))
    .filter((c) => c.req > 50_000 && c.perReq < 400)
    .sort((a, b) => b.req - a.req)
    .slice(0, 3)
  if (!candidates.length) return []
  const susCost = sum(candidates.map((c) => c.cost))
  const low = susCost * 0.05
  const high = susCost * 0.15
  if (high < 25) return []
  const spikeNote = spikes.length ? ` ${spikes.length} daily spike(s) overlap this pattern.` : ''
  return [
    {
      id: 'runaway-volume',
      rank: 0,
      title: 'Investigate high-volume, low-token request patterns',
      category: 'retry-waste',
      categoryLabel: 'Runaway volume',
      severity: high > 400 ? 'high' : 'medium',
      confidence: 'medium',
      estMonthlyLow: round(low),
      estMonthlyHigh: round(high),
      affectedProjects: candidates.map((c) => c.p),
      affectedModels: uniq(rows.map((r) => r.model)).slice(0, 4),
      evidence: `${candidates.map((c) => `${c.p}: ${num(c.req)} requests averaging only ~${num(c.perReq)} tokens each`).join('; ')}. Tiny-payload, high-frequency calls are the fingerprint of fan-out loops, polling, and duplicate retries.${spikeNote}`,
      fix: `Add request de-duplication/idempotency keys, cap agent iteration depth, and batch where possible on ${candidates[0]?.p ?? 'the top project'}. Confirm no client is polling the API in a tight loop.`,
      detail: `Metadata can't prove an agent loop - only request traces can. This flags the statistical signature so you know where to look first. Range assumes 5–15% of these calls are redundant.`,
    },
  ]
}

export function detectMarginLeak(ctx: ScanContext): Finding[] {
  const rm = ctx.revenueMap
  if (!rm || !rm.entries.length) return [] // degraded mode handled by detectProjectLeak + extras
  const rev = new Map(rm.entries.map((e) => [e.key, e]))
  const out: Finding[] = []
  const belowCost: { project: string; cost: number; revenue: number }[] = []
  const thin: { project: string; cost: number; revenue: number; margin: number }[] = []
  for (const p of ctx.projects) {
    const e = rev.get(p.project)
    if (!e) continue
    if (e.monthlyRevenue <= 0 && p.cost <= 0) continue // nothing to say
    if (p.cost > e.monthlyRevenue) {
      belowCost.push({ project: p.project, cost: p.cost, revenue: Math.max(0, e.monthlyRevenue) })
    } else {
      // reached only when revenue > 0 (cost ≤ revenue), so margin is well-defined
      const margin = (e.monthlyRevenue - p.cost) / e.monthlyRevenue
      if (margin < 0.5) thin.push({ project: p.project, cost: p.cost, revenue: e.monthlyRevenue, margin })
    }
  }
  if (belowCost.length) {
    const loss = sum(belowCost.map((b) => b.cost - b.revenue))
    out.push({
      id: 'margin-below-cost',
      rank: 0,
      title: `${belowCost.length} customer${belowCost.length > 1 ? 's' : ''} cost more in AI than they pay you`,
      category: 'project-leak',
      categoryLabel: 'Below-cost accounts',
      severity: 'high',
      confidence: 'high',
      estMonthlyLow: round(loss * 0.6),
      estMonthlyHigh: round(loss),
      affectedProjects: belowCost.map((b) => b.project),
      affectedModels: [],
      evidence: `${belowCost.map((b) => `${b.project} spends ${usd(b.cost)} in AI on ${usd(b.revenue)} of revenue`).join('; ')}. These accounts have negative AI margin today.`,
      fix: `Re-price or rate-limit these accounts, move them to cheaper models, or add an AI usage cap to the plan. Recover the negative-margin delta first.`,
      detail: `Below-cost accounts are the clearest margin leak - every additional call loses money. The range is the recoverable monthly loss if these accounts reach break-even.`,
    })
  }
  if (thin.length) {
    const thinCost = sum(thin.map((t) => t.cost))
    out.push({
      id: 'margin-thin',
      rank: 0,
      title: `${thin.length} thin-margin account${thin.length > 1 ? 's' : ''} (AI > 50% of revenue)`,
      category: 'project-leak',
      categoryLabel: 'Thin-margin accounts',
      severity: 'medium',
      confidence: 'medium',
      estMonthlyLow: round(thinCost * 0.1),
      estMonthlyHigh: round(thinCost * 0.25),
      affectedProjects: thin.map((t) => t.project),
      affectedModels: [],
      evidence: `${thin.map((t) => `${t.project}: AI cost is ${pct((1 - t.margin) * 100)} of its revenue`).join('; ')}. These accounts are profitable but fragile to any usage growth.`,
      fix: `Right-size models and enable caching for these accounts, and watch them for tier-creep. Consider a usage-based add-on above an included AI allowance.`,
      detail: `Thin margins flip to losses as usage grows. Trimming AI cost 10–25% on these accounts restores headroom.`,
    })
  }
  return out
}

/* ── Scoring & assembly ──────────────────────────────────────── */

function bandFor(score: number): { band: Band; label: string } {
  if (score >= 80) return { band: 'healthy', label: 'Healthy' }
  if (score >= 55) return { band: 'watch', label: 'Worth a look' }
  return { band: 'leaking', label: 'Leaking spend' }
}

function scoreFor(total: number, findings: Finding[]): number {
  if (!total) return 100
  let score = 100
  for (const f of findings) {
    const ratio = midpoint(f) / total
    const sev = f.severity === 'high' ? 1 : f.severity === 'medium' ? 0.65 : 0.35
    score -= ratio * 100 * 1.31 * sev
  }
  return Math.max(8, Math.min(100, round(score)))
}

function deterministicMemo(report: Omit<Report, 'founderMemo'>): string {
  const { spendAnalyzed, healthScore, estMonthlyImpactLow, estMonthlyImpactHigh, findings, healthy } = report
  if (healthy) {
    return [
      `## Founder memo`,
      ``,
      `We analyzed **${usd(spendAnalyzed)}** of recent LLM usage. Your AI spend looks **healthy** (score **${healthScore}/100**). No high-confidence savings opportunities cleared our threshold.`,
      ``,
      `**Recommendation:** keep current model and prompt configuration. Don't spend engineering time chasing optimizations that aren't there - instead, set the budget thresholds in this report and re-scan if monthly spend moves more than 25%.`,
      ``,
      `_This is a point-in-time diagnosis based on usage metadata only._`,
    ].join('\n')
  }
  const top = findings[0]
  const lines = [
    `## Founder memo`,
    ``,
    `We analyzed **${usd(spendAnalyzed)}** of recent LLM usage. Health score: **${healthScore}/100**. We found **${findings.length}** savings opportunities worth an estimated **${usdRange(estMonthlyImpactLow, estMonthlyImpactHigh)}/month**.`,
    ``,
    `**Biggest lever:** ${top.title} - est. **${usdRange(top.estMonthlyLow, top.estMonthlyHigh)}/mo** (${top.confidence} confidence). ${top.fix}`,
    ``,
    `**Next two:**`,
    ...findings.slice(1, 3).map((f) => `- ${f.title} - ${usdRange(f.estMonthlyLow, f.estMonthlyHigh)}/mo. ${f.fix}`),
    ``,
    `**The ask:** these are config-level changes, not rewrites. Assign the top opportunity to one engineer for a one-week spike; the estimated payback is immediate and recurring.`,
    ``,
    `_Diagnosis based on usage metadata only - no prompts or responses were used._`,
  ]
  return lines.join('\n')
}

function healthyDetail(report: Omit<Report, 'founderMemo' | 'healthyReport'>): HealthyReport {
  const top = report.spendByModel[0]
  return {
    whatLooksGood: [
      `Output tokens are ${pct(report.tokenSplit.outputCostPct)} of spend - within a healthy band.`,
      `No single model dominates wastefully; ${top?.model ?? 'your top model'} usage looks intentional.`,
      `No retry storms or error spikes detected in the analyzed window.`,
      `Spend is spread across projects without runaway concentration.`,
    ],
    whatToMonitor: [
      `Output-token share - alert if it crosses 45% of spend.`,
      `New model adoption: re-check pricing fit when you add a model.`,
      `Per-project growth month over month.`,
    ],
    warningSigns: [
      `A single day exceeding 1.8× your median daily spend.`,
      `Error rate climbing above 3%.`,
      `Input tokens/request rising (prompt bloat / missing caching).`,
    ],
    budgetThresholds: [
      { label: 'Monthly budget alert', value: usd(report.spendAnalyzed * 1.25) },
      { label: 'Daily spend alert', value: usd((report.spendAnalyzed / 30) * 1.8) },
      { label: 'Per-project ceiling', value: usd(report.spendAnalyzed * 0.45) },
    ],
  }
}

function marginExtras(ctx: ScanContext): ReportExtras {
  const rm = ctx.revenueMap
  const rev = rm ? new Map(rm.entries.map((e) => [e.key, e])) : null
  let matchedCost = 0
  const rows: MarginRow[] = ctx.projects.map((p) => {
    const e = rev?.get(p.project)
    const revenue = e?.monthlyRevenue
    if (e) matchedCost += p.cost
    const marginPct = revenue && revenue > 0 ? round(((revenue - p.cost) / revenue) * 100) : undefined
    return { key: p.project, plan: e?.plan, cost: p.cost, revenue, marginPct, belowCost: revenue !== undefined && p.cost > revenue }
  })
  const total = sum(ctx.projects.map((p) => p.cost))
  return { marginRows: rows, coveragePct: total ? round((matchedCost / total) * 100) : 0 }
}

function dedupeById(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const f of findings) {
    if (!seen.has(f.id)) {
      seen.add(f.id)
      out.push(f)
    }
  }
  return out
}

/* ── Receipts: the exact math behind each finding ─────────────── */

/** Cost-per-request, with sub-cent precision so $0.0127 doesn't round to $0.01. */
function perReq(cost: number, requests: number): string {
  const v = requests > 0 ? cost / requests : 0
  return v >= 1 ? usd(v) : `$${v.toFixed(4)}`
}

/**
 * Build the "receipts" for a finding: the checkable numbers (model $, % of
 * spend, requests, $/req, cheaper-sibling math, assumptions) that turn a
 * templated recommendation into a forensic one. Derived from the shared
 * context so detectors stay lean and the math is computed in one place.
 */
function buildMetrics(f: Finding, ctx: ScanContext): FindingMetric[] {
  const total = ctx.totals.cost
  const out: FindingMetric[] = []
  const impact: FindingMetric = { label: 'Est. monthly impact', value: usdRange(f.estMonthlyLow, f.estMonthlyHigh), emphasis: true }
  const annual: FindingMetric = { label: 'Annualized', value: usdRange(f.estMonthlyLow * 12, f.estMonthlyHigh * 12) }
  const pctOfSpend: FindingMetric = {
    label: 'Share of total spend',
    value: total ? pct((midpoint(f) / total) * 100, 1) : 'n/a',
  }

  // Margin findings are keyed by id (they reuse the project-leak category).
  if (f.id === 'margin-below-cost' || f.id === 'margin-thin') {
    const rev = ctx.revenueMap ? new Map(ctx.revenueMap.entries.map((e) => [e.key, e])) : null
    let cost = 0
    let revenue = 0
    for (const p of ctx.projects) {
      if (!f.affectedProjects.includes(p.project)) continue
      cost += p.cost
      revenue += rev?.get(p.project)?.monthlyRevenue ?? 0
    }
    out.push({ label: 'Accounts flagged', value: num(f.affectedProjects.length) })
    out.push({ label: 'AI cost on these accounts', value: usd(cost) })
    out.push({ label: 'Revenue on these accounts', value: usd(revenue) })
    out.push({ label: 'Blended AI margin', value: revenue > 0 ? pct(((revenue - cost) / revenue) * 100) : 'negative' })
    out.push(impact, annual)
    return out
  }

  // Runaway volume reuses the retry-waste category; split it out by id.
  if (f.id === 'runaway-volume') {
    let reqs = 0
    let cost = 0
    for (const p of ctx.projects) {
      if (!f.affectedProjects.includes(p.project)) continue
      reqs += p.requests
      cost += p.cost
    }
    out.push({ label: 'Flagged requests', value: num(reqs) })
    out.push({ label: 'Spend on flagged projects', value: `${usd(cost)} · ${pct(total ? (cost / total) * 100 : 0)} of total` })
    out.push({ label: 'Avg cost / request', value: perReq(cost, reqs) })
    out.push({ label: 'Assumed redundant', value: '5-15% of calls' })
    out.push(impact, annual)
    return out
  }

  switch (f.category) {
    case 'model-downgrade':
    case 'legacy-model': {
      const m = ctx.models.find((x) => f.affectedModels.includes(x.model))
      if (m) {
        const price = priceFor(m.model)
        const save = price.cheaper ? 1 - blendedPrice(price.cheaper) / blendedPrice(m.model) : 0
        out.push({ label: `${m.model} spend`, value: `${usd(m.cost)} · ${pct(m.pct)} of total` })
        out.push({ label: 'Requests', value: num(m.requests) })
        out.push({ label: 'Cost / request now', value: perReq(m.cost, m.requests) })
        if (price.cheaper) {
          out.push({ label: `Cost / request on ${price.cheaper}`, value: perReq(m.cost * (1 - save), m.requests) })
          out.push({ label: `${price.cheaper} vs ${m.model}`, value: `${pct(save * 100)} cheaper / token` })
        }
        out.push({ label: 'Assumed migratable', value: '15-40% of this volume' })
        // Third-party quality proof + cheapest open destination (market layer).
        const cur = marketFor(m.model)
        const sib = price.cheaper ? marketFor(price.cheaper) : undefined
        if (cur?.arenaElo && sib?.arenaElo) {
          out.push({ label: `Quality (LMArena, ${MARKET_AS_OF})`, value: `${price.cheaper} ${sib.arenaElo} vs ${m.model} ${cur.arenaElo} Elo` })
        }
        const ba = cur ? bestAlternative(cur) : undefined
        if (ba) {
          const d = ba.qualityDeltaElo
          const delta = d !== undefined ? ` (${d >= 0 ? '+' : ''}${d} Elo vs ${m.model})` : ''
          out.push({
            label: 'Cheaper open model (A/B option, not in this estimate)',
            value: `${ba.alt.model} @ ${ba.alt.host} · ${pct(ba.cheaperPct * 100)} cheaper/token${ba.alt.arenaElo ? ` · ${ba.alt.arenaElo} Elo${delta}` : ''}`,
          })
        }
      }
      break
    }
    case 'output-caps': {
      const ts = ctx.tokenSplit
      out.push({ label: 'Output-token spend', value: `${usd(ts.outputCost)} · ${pct(ts.outputCostPct)} of total` })
      out.push({ label: 'Output tokens billed', value: num(ts.outputTokens) })
      out.push({ label: 'Output vs input price', value: '3-5x per token' })
      out.push({ label: 'Assumed trim', value: '8-18% of output tokens' })
      break
    }
    case 'prompt-caching': {
      out.push({ label: 'Input-token spend (cache pool)', value: usd(ctx.tokenSplit.inputCost) })
      out.push({ label: 'Cached tokens bill at', value: '10-25% of standard rate' })
      out.push({ label: 'Assumed cache-hit', value: '40-80% of input tokens' })
      break
    }
    case 'prompt-bloat': {
      out.push({ label: 'Input-token spend', value: usd(ctx.tokenSplit.inputCost) })
      out.push({ label: 'Assumed token cut', value: '8-20% of input tokens' })
      break
    }
    case 'retry-waste': {
      const errRate = ctx.totals.requests ? ctx.totals.errors / ctx.totals.requests : 0
      out.push({ label: 'Error rate', value: `${pct(errRate * 100, 1)} (${num(ctx.totals.errors)} of ${num(ctx.totals.requests)} req)` })
      out.push({ label: 'Spend lost to errors', value: usd(total * errRate) })
      out.push({ label: 'Assumed recoverable', value: '40-90% of that' })
      break
    }
    case 'project-leak': {
      const p = ctx.projects.find((x) => f.affectedProjects.includes(x.project))
      if (p) {
        out.push({ label: `${p.project} spend`, value: `${usd(p.cost)} · ${pct(p.pct)} of total` })
        out.push({ label: 'Requests', value: num(p.requests) })
        out.push({ label: 'Cost / request', value: perReq(p.cost, p.requests) })
        out.push({ label: 'Assumed trim', value: '6-15%' })
      }
      break
    }
  }
  out.push(pctOfSpend, impact, annual)
  return out
}

/* ── Diagnostics: visibility metrics, NOT savings (never in the ledger) ── */

const UNATTRIBUTED_KEYS = new Set(['default', 'unknown', 'untagged', 'unattributed', 'none', 'n/a', '-', ''])

/**
 * The three things no vendor dashboard shows, computed from metadata: invisible
 * reasoning-token spend, the unattributed-spend score, and cache health. Each
 * degrades honestly - when the export lacks the columns, we say so (available:
 * false) instead of inventing a number.
 */
export function buildDiagnostics(ctx: ScanContext): DiagnosticMetric[] {
  const { rows, totals: t } = ctx
  const total = t.cost
  const out: DiagnosticMetric[] = []

  // 1) Invisible reasoning tokens (billed as output, hidden in dashboards).
  const reasoningTokens = sum(rows.map((r) => r.reasoningTokens ?? 0))
  const reasoningModels = uniq(rows.filter((r) => priceFor(r.model).reasoning).map((r) => r.model))
  const reasoningModelCost = sum(rows.filter((r) => priceFor(r.model).reasoning).map((r) => r.cost))
  if (reasoningTokens > 0) {
    // Treat reasoning as a subset of output (clamp per-row) and price it on the
    // ACTUAL output-cost split, so the dollar figure matches billed spend and the
    // share can never exceed 100%.
    const reasoningOut = sum(rows.map((r) => Math.min(r.reasoningTokens ?? 0, r.outputTokens)))
    const share = t.outputTokens ? reasoningOut / t.outputTokens : 0
    const rCost = ctx.tokenSplit.outputCost * share
    out.push({
      id: 'reasoning-tokens',
      label: 'Invisible reasoning spend',
      value: `${usd(rCost)}/mo · ${pct(share * 100)} of output spend`,
      status: share > 0.4 ? 'risk' : share > 0.15 ? 'watch' : 'good',
      benchmark: 'Reasoning models often hide 20-60% of output cost here',
      detail: `Reasoning/thinking tokens bill as output but never show in the standard usage view. ${usd(rCost)}/mo of your spend is reasoning you can't see in the dashboard. Lower the reasoning effort, or route routine calls to a non-reasoning model.`,
      available: true,
    })
  } else if (reasoningModelCost > 0) {
    out.push({
      id: 'reasoning-tokens',
      label: 'Invisible reasoning spend',
      value: 'Present but not itemized',
      status: 'info',
      benchmark: `${usd(reasoningModelCost)}/mo runs on reasoning models`,
      detail: `You run reasoning model(s) (${reasoningModels.join(', ')}). Their hidden reasoning tokens bill as output but aren't broken out in this export - add a reasoning_tokens column to quantify exactly how much.`,
      available: false,
    })
  }

  // 2) Unattributed-spend score (governance, not recoverable $).
  const unattrCost = sum(
    ctx.projects.filter((p) => UNATTRIBUTED_KEYS.has(p.project.toLowerCase().trim())).map((p) => p.cost),
  )
  const singleLabel = ctx.projects.length === 1
  const singleKey = singleLabel ? ctx.projects[0].project.toLowerCase().trim() : ''
  const singleUntagged = singleLabel && UNATTRIBUTED_KEYS.has(singleKey)
  if (singleLabel && !singleUntagged) {
    // One genuine project name: not "unattributed", just no within-bucket breakdown.
    out.push({
      id: 'unattributed-spend',
      label: 'Unattributed spend',
      value: 'Single bucket',
      status: 'watch',
      benchmark: 'Healthy < 5% · failure > 60%',
      detail: `All spend tags to one project ("${ctx.projects[0].project}"). Fine for a single-tenant app, but you can't break cost down by feature, team, or customer within it - add finer tags at the gateway if you need chargeback.`,
      available: true,
    })
  } else {
    const unattrPct = singleUntagged ? 1 : total ? unattrCost / total : 0
    out.push({
      id: 'unattributed-spend',
      label: 'Unattributed spend',
      value: `${pct(unattrPct * 100, 1)}${unattrPct > 0 ? ` (${usd(singleUntagged ? total : unattrCost)})` : ''}`,
      status: unattrPct >= 0.6 ? 'risk' : unattrPct >= 0.05 ? 'watch' : 'good',
      benchmark: 'Healthy < 5% · failure > 60%',
      detail: `${pct(unattrPct * 100, 1)} of spend carries no project/feature tag. You can't do chargeback or spot a margin-killing customer until this drops below ~5%. Tag at the gateway, propagate through every call.`,
      available: true,
    })
  }

  // 3) Deprecated models in use (from the market lifecycle data).
  const deprecated = ctx.models
    .map((m) => ({ m, e: marketFor(m.model) }))
    .filter((x) => x.e?.deprecated)
  if (deprecated.length) {
    const depCost = sum(deprecated.map((x) => x.m.cost))
    const share = total ? depCost / total : 0
    out.push({
      id: 'deprecated-models',
      label: 'Deprecated models in use',
      value: `${deprecated.length} model${deprecated.length > 1 ? 's' : ''} · ${usd(depCost)}/mo`,
      status: share > 0.25 ? 'risk' : 'watch',
      benchmark: `lifecycle as of ${MARKET_AS_OF}`,
      detail: `${deprecated
        .map((x) => `${x.m.model} → ${x.e!.successor ?? 'a current model'}`)
        .join('; ')}. Deprecated models stop getting price cuts and quality updates and eventually shut off - migrate to the listed successor before the retirement date.`,
      available: true,
    })
  }

  // 4) Cache health (needs cache-token columns; else flag the opportunity).
  const cacheRead = sum(rows.map((r) => r.cacheReadTokens ?? 0))
  const cacheWrite = sum(rows.map((r) => r.cacheWriteTokens ?? 0))
  if (cacheRead > 0 || cacheWrite > 0) {
    // Clamp: depending on export shape cacheRead may or may not already be folded
    // into inputTokens, so guard against an impossible >100% hit rate.
    const readShare = Math.min(1, t.inputTokens ? cacheRead / t.inputTokens : 0)
    out.push({
      id: 'cache-health',
      label: 'Cache health',
      value: `${pct(readShare * 100, 1)} of input tokens are cache hits`,
      status: readShare < 0.05 ? 'risk' : readShare < 0.2 ? 'watch' : 'good',
      benchmark: 'Break-even ~2-5% hit rate',
      detail:
        readShare < 0.05
          ? `Your cache barely hits (${pct(readShare * 100, 1)}). Below ~2-5% the embedding/storage overhead can exceed what the cache saves - it may be a net cost. Confirm the cached prefix is stable and reused.`
          : `Cached input bills at 10-25% of standard. At ${pct(readShare * 100, 1)} hit rate the cache is paying for itself; watch for a sudden drop (a changed prefix silently breaks it).`,
      available: true,
    })
  } else {
    const hasLargeRepeated = (() => {
      const m = new Map<string, { in: number; req: number }>()
      for (const r of rows) {
        const e = m.get(r.project) ?? { in: 0, req: 0 }
        e.in += r.inputTokens
        e.req += r.requests
        m.set(r.project, e)
      }
      return [...m.values()].some((v) => v.req > 200 && v.in / v.req > 2500)
    })()
    if (hasLargeRepeated) {
      out.push({
        id: 'cache-health',
        label: 'Cache health',
        value: 'No cache-read data in export',
        status: 'info',
        benchmark: 'Add cache_read_input_tokens to measure',
        detail: `We estimate the caching opportunity from prompt size in the findings, but your export has no cache-read column, so we can't measure your real hit rate. Add cache_read_input_tokens (Anthropic) or cached_tokens (OpenAI) to see whether caching is actually working.`,
        available: false,
      })
    }
  }

  // Tier the diagnostics: a measured fact present in the data is 'confirmed'
  // (deprecated-models, cache-read share, unattributed spend, reasoning $);
  // informational / "data missing" notes stay untiered.
  for (const d of out) {
    if (d.available && d.status !== 'info') d.confidenceTier = 'confirmed'
  }
  return out
}

/* ── Market layer: the user's models vs current prices + quality ─── */

/** Join each model the user runs against the market index: current price,
 * third-party quality, lifecycle, and the cheapest credible destination. */
export function buildMarketRows(ctx: ScanContext): MarketRow[] {
  const rows: MarketRow[] = []
  for (const m of ctx.models) {
    const e = marketFor(m.model)
    if (!e) continue // unknown model: leave it out rather than guess
    const ba = bestAlternative(e)
    rows.push({
      model: m.model,
      provider: m.provider,
      cost: m.cost,
      inPer1m: e.inPer1m,
      outPer1m: e.outPer1m,
      qualityIndex: e.aaIndex,
      arenaElo: e.arenaElo,
      deprecated: e.deprecated,
      successor: e.successor,
      batchEligible: e.batchEligible,
      promptCaching: e.promptCaching,
      bestAlt: ba
        ? {
            model: ba.alt.model,
            host: ba.alt.host,
            inPer1m: ba.alt.inPer1m,
            outPer1m: ba.alt.outPer1m,
            qualityIndex: ba.alt.aaIndex,
            arenaElo: ba.alt.arenaElo,
            sameModel: false,
            cheaperPct: ba.cheaperPct,
          }
        : undefined,
    })
  }
  return rows.sort((a, b) => b.cost - a.cost)
}

/* ── Confidence tiers: provable vs inferential ───────────────────
 * Tier is assigned per finding, centrally (same pattern as rank/metrics), so
 * detectors stay focused. The rule mirrors the detector → category mapping:
 *   confirmed  legacy-model           (deprecated model + known cheaper successor = price fact)
 *   confirmed  margin-below-cost/thin  (AI cost vs the supplied revenue = factual comparison)
 *   suspected  everything else         (downgrade, output-caps, caching, bloat, retry, runaway, project-leak)
 * Tier is ORTHOGONAL to `confidence`: a confirmed finding built on estimated cost
 * keeps its capped confidence, and its reason says the dollars are still approximate
 * (the tier never overrides the estimated-cost downgrade). */
function assignTier(f: Finding, mostlyEstimated: boolean): { tier: ConfidenceTier; reason: string } {
  const estNote = mostlyEstimated
    ? ' Costs here are list-price estimates, so the dollar figure is still approximate.'
    : ''
  if (f.category === 'legacy-model') {
    return {
      tier: 'confirmed',
      reason:
        'Confirmed: this model is deprecated with a known, cheaper successor - a price-difference fact, not a behavioral guess.' +
        estNote,
    }
  }
  if (f.id === 'margin-below-cost' || f.id === 'margin-thin') {
    return {
      tier: 'confirmed',
      reason:
        'Confirmed: your AI cost compared against the revenue you supplied - a factual comparison.' + estNote,
    }
  }
  if (f.id === 'runaway-volume') {
    return {
      tier: 'suspected',
      reason:
        'Suspected: the high-volume, low-token pattern is a statistical signature - metadata cannot prove an agent loop.',
    }
  }
  const reasons: Partial<Record<FindingCategory, string>> = {
    'model-downgrade':
      'Suspected: inferred from output size and volume - we cannot see the task, so model suitability is not verified.',
    'output-caps':
      'Suspected: the output share is visible, but whether responses can be safely shortened depends on the task.',
    'prompt-caching':
      'Suspected: prompt size is visible, but the caching fix is not provable without seeing the prompts.',
    'prompt-bloat':
      'Suspected: prompt size is visible, but how much is trimmable depends on prompt content we never see.',
    'retry-waste':
      'Suspected: you did pay for errored requests, but how much is recoverable is inferred, not proven.',
    'project-leak':
      'Suspected: spend concentration is a fact, but the recoverable trim is an inference.',
  }
  return {
    tier: 'suspected',
    reason: reasons[f.category] ?? 'Suspected: inferred from usage patterns, not verified against actual tasks.',
  }
}

/** Assemble one report from the shared context. */
export function assembleReport(def: ReportDef, ctx: ScanContext): ScanResult {
  const { totals: t, models, projects, trend, spikes, tokenSplit, periodLabel, reconciliation } = ctx
  const total = t.cost

  // degraded modes
  const noMap = !!def.usesRevenueMap && !(ctx.revenueMap && ctx.revenueMap.entries.length)
  const metadataLimited = !!def.metadataLimited || noMap
  const limitationNote = metadataLimited ? def.limitationNote : undefined
  const ceiling: Confidence = noMap ? 'low' : (def.confidenceCeiling ?? 'high')
  // Cap confidence when cost is mostly estimated (fully estimated, or a mixed
  // scan that's <50% provider-reported).
  const mostlyEstimated =
    reconciliation.costBasis === 'estimated' ||
    (reconciliation.costBasis === 'mixed' && reconciliation.actualPct < 0.5)
  const costCap: Confidence = mostlyEstimated ? 'medium' : 'high'
  const confidenceNote = mostlyEstimated
    ? 'Costs are list-price estimates - connect a provider cost export for exact figures.'
    : undefined

  // detectors → findings
  let findings = def.detectors.flatMap((d) => d(ctx))
  if (def.scope === 'meta') findings = dedupeById(findings)
  findings = findings.filter((f) => f.estMonthlyHigh >= 25)
  findings = findings.map((f) => ({ ...f, confidence: minConfidence(f.confidence, ceiling, costCap) }))
  findings.sort((a, b) => midpoint(b) - midpoint(a))
  findings = findings.map((f, i) => ({ ...f, rank: i + 1, metrics: buildMetrics({ ...f, rank: i + 1 }, ctx) }))
  // Tier is assigned AFTER the confidence cap so the reason can reflect an
  // estimated-cost downgrade. Orthogonal to confidence/costSource by design.
  findings = findings.map((f) => {
    const { tier, reason } = assignTier(f, mostlyEstimated)
    return { ...f, confidenceTier: tier, tierReason: reason }
  })

  const estLow = sum(findings.map((f) => f.estMonthlyLow))
  const estHigh = sum(findings.map((f) => f.estMonthlyHigh))
  const confirmedFindings = findings.filter((f) => f.confidenceTier === 'confirmed')
  const suspectedFindings = findings.filter((f) => f.confidenceTier === 'suspected')
  const healthScore = scoreFor(total, findings)
  const { band, label } = bandFor(healthScore)
  const healthy = findings.length === 0 || (def.scope === 'meta' && estHigh < total * 0.05)

  const extras = def.kind === 'margin' ? marginExtras(ctx) : undefined

  const execSummary = (() => {
    if (def.kind === 'margin') {
      return healthy
        ? `We attributed ${usd(total)} of AI spend across ${num(projects.length)} projects over the ${periodLabel}. No obvious margin leaks cleared our threshold.`
        : `We attributed ${usd(total)} of AI spend across ${num(projects.length)} projects over the ${periodLabel}. ${findings.length} margin issue${findings.length > 1 ? 's' : ''} found${extras?.coveragePct ? `, covering ${pct(extras.coveragePct)} of spend by revenue map` : ''}.`
    }
    return healthy
      ? `We analyzed ${usd(total)} of LLM spend over the ${periodLabel}. Spend looks healthy at ${healthScore}/100. No high-confidence savings cleared our threshold - this report confirms what's working and what to monitor.`
      : `We analyzed ${usd(total)} of LLM spend over the ${periodLabel}. Health score ${healthScore}/100. ${findings.length} opportunities total an estimated ${usdRange(round(estLow), round(estHigh))}/month, led by "${findings[0].title}".`
  })()

  const reportBase: Omit<Report, 'founderMemo' | 'healthyReport'> = {
    spendAnalyzed: round(total),
    periodLabel,
    healthScore,
    band,
    bandLabel: label,
    healthy,
    estMonthlyImpactLow: round(estLow),
    estMonthlyImpactHigh: round(estHigh),
    confirmedImpactLow: round(sum(confirmedFindings.map((f) => f.estMonthlyLow))),
    confirmedImpactHigh: round(sum(confirmedFindings.map((f) => f.estMonthlyHigh))),
    suspectedImpactLow: round(sum(suspectedFindings.map((f) => f.estMonthlyLow))),
    suspectedImpactHigh: round(sum(suspectedFindings.map((f) => f.estMonthlyHigh))),
    executiveSummary: execSummary,
    findings,
    topLeaks: findings.slice(0, 3),
    spendByModel: models,
    spendByProject: projects,
    tokenSplit,
    spikes,
    trend,
    generatedFromLlm: false,
    slug: def.slug,
    kind: def.kind,
    reconciliation,
    extras,
    metadataLimited: metadataLimited || undefined,
    limitationNote,
    confidenceNote,
    diagnostics: buildDiagnostics(ctx),
    marketRows: buildMarketRows(ctx),
    marketAsOf: MARKET_AS_OF,
  }

  const report: Report = {
    ...reportBase,
    founderMemo: deterministicMemo({ ...reportBase, founderMemo: '' } as Report),
    ...(healthy ? { healthyReport: healthyDetail(reportBase) } : {}),
  }

  const snapshot = buildSnapshot(report, def, ctx)
  return { snapshot, report }
}

/* ── Generalized paywall (the SOLE reveal chokepoint) ──────────── */

function renderInsight(f: Finding, ctx: ScanContext): { title: string; body: string } {
  if (f.category === 'output-caps') {
    return {
      title: `Output tokens represent ${ctx.tokenSplit.outputCostPct}% of total spend`,
      body: `Reviewing output caps may reduce cost on some high-volume usage. This is a middle-ground opportunity - not your highest-impact one.`,
    }
  }
  return {
    title: f.title,
    body: `${f.evidence.split('.')[0]}. This is a middle-ground opportunity - your highest-impact savings stay in the full report.`,
  }
}

/**
 * PAYWALL RULE (enforced once, identically for every report): the free snapshot
 * must NOT reveal the report's own #1 highest-value finding. We surface a
 * credible middle-ground insight chosen from non-#1 findings only.
 */
function buildSnapshot(report: Report, def: ReportDef, ctx: ScanContext): Snapshot {
  const findings = report.findings
  const top = ctx.models[0]
  // Per-tier rollups (never summed). The aggregate $ per tier is allowed in the
  // free snapshot; only finding-level fix/evidence stays paywalled. `excludeId`
  // drops the one free-revealed insight from the locked category list.
  const tierSummary = (tier: ConfidenceTier, excludeId?: string): TierSummary => {
    const fs = findings.filter((f) => f.confidenceTier === tier)
    return {
      savingsLow: round(sum(fs.map((f) => f.estMonthlyLow))),
      savingsHigh: round(sum(fs.map((f) => f.estMonthlyHigh))),
      count: fs.length,
      categories: uniq(fs.filter((f) => f.id !== excludeId).map((f) => f.categoryLabel)),
    }
  }
  const base = {
    spendAnalyzed: report.spendAnalyzed,
    periodLabel: report.periodLabel,
    healthScore: report.healthScore,
    band: report.band,
    bandLabel: report.bandLabel,
    topModel: { model: top?.model ?? '-', pct: round(top?.pct ?? 0) },
    outputCostPct: report.tokenSplit.outputCostPct,
    slug: def.slug,
    costBasis: ctx.reconciliation.costBasis,
    ...(report.metadataLimited ? { metadataLimited: true } : {}),
  }

  // Healthy / no findings → confirmation framing, nothing locked.
  if (report.healthy || findings.length === 0) {
    return {
      ...base,
      estSavingsLow: 0,
      estSavingsHigh: 0,
      opportunityCount: 0,
      visibleInsight: {
        title: def.healthyTitle ?? 'Your AI spend appears healthy',
        body: `Across ${usd(report.spendAnalyzed)} analyzed, no high-confidence savings opportunities cleared our threshold. The full report confirms what's working, what to monitor, and where not to waste engineering time.`,
      },
      lockedCount: 0,
      lockedCategories: ['What looks good', 'What to monitor', 'Warning signs', 'Budget thresholds'],
      confirmed: tierSummary('confirmed'),
      suspected: tierSummary('suspected'),
    }
  }

  // Single-finding guard: never reveal a finding-level insight when there is
  // only one (the median fallback would resolve to #1 = a paywall leak).
  if (findings.length <= 1) {
    return {
      ...base,
      estSavingsLow: report.estMonthlyImpactLow,
      estSavingsHigh: report.estMonthlyImpactHigh,
      opportunityCount: findings.length,
      visibleInsight: {
        title: `${findings.length} opportunity found`,
        body: `Unlock the full report to see it - the exact affected projects, models, estimated impact, and recommended fix.`,
      },
      lockedCount: findings.length,
      lockedCategories: uniq(findings.map((f) => f.categoryLabel)),
      confirmed: tierSummary('confirmed'),
      suspected: tierSummary('suspected'),
    }
  }

  const rank1 = findings.find((f) => f.rank === 1)!
  const nonTop = findings.filter((f) => f.rank !== 1)

  // Picker sees ONLY non-#1 findings and cannot return #1.
  let chosen = def.pickFreeInsight ? def.pickFreeInsight(nonTop, ctx) : null
  if (!chosen || chosen.id === rank1.id) chosen = nonTop[Math.floor(nonTop.length / 2)]

  let visible = renderInsight(chosen, ctx)
  // Hard guard: never serialize the #1 finding's fix/evidence into a snapshot.
  const blob = JSON.stringify(visible)
  if (chosen.id === rank1.id || blob.includes(rank1.fix) || blob.includes(rank1.evidence)) {
    const med = nonTop[Math.floor(nonTop.length / 2)]
    visible = renderInsight(med, ctx)
    chosen = med
  }

  const lockedCategories = uniq(findings.filter((f) => f.id !== chosen.id).map((f) => f.categoryLabel))

  return {
    ...base,
    estSavingsLow: report.estMonthlyImpactLow,
    estSavingsHigh: report.estMonthlyImpactHigh,
    opportunityCount: findings.length,
    visibleInsight: visible,
    lockedCount: findings.length - 1,
    lockedCategories,
    confirmed: tierSummary('confirmed', chosen.id),
    suspected: tierSummary('suspected', chosen.id),
  }
}

/* ── Top-level entry points ──────────────────────────────────── */

export function analyzeAll(
  rows: UsageRow[],
  opts: AnalyzeOptions = {},
): { reconciliation: CostReconciliation; reports: Record<ReportSlug, ScanResult> } {
  const ctx = buildContext(rows, opts)
  const reports = {} as Record<ReportSlug, ScanResult>
  for (const def of ALL_REPORT_DEFS) reports[def.slug] = assembleReport(def, ctx)
  return { reconciliation: ctx.reconciliation, reports }
}

/** Back-compat shim - unchanged external behavior; keeps engine.test.ts green. */
export function analyzeUsage(rows: UsageRow[], opts: AnalyzeOptions = {}): ScanResult {
  const ctx = buildContext(rows, opts)
  return assembleReport(REGISTRY['ai-cost-health'], ctx)
}
