import type { Provider } from './types'

/**
 * MARKET LAYER - the user's private spend joined against public market data.
 *
 * This is the data no single user maintains: current cross-provider list prices,
 * third-party quality benchmarks, and feature/deprecation flags. It turns a
 * downgrade recommendation from "trust our heuristic" into "cheaper AND proven
 * within X% quality by neutral third parties, here is the destination."
 *
 * Figures gathered 2026-06 from primary sources (provider pricing/deprecation
 * docs, artificialanalysis.ai Intelligence Index v4.0, LMArena/Chatbot Arena
 * Elo, published MMLU). Refresh via a periodic re-run - never authoritative,
 * always stamped with MARKET_AS_OF so the report can disclose its freshness.
 */
export const MARKET_AS_OF = '2026-06'

export type MarketTier = 'frontier' | 'reasoning' | 'mid' | 'small'

export interface MarketEntry {
  model: string
  provider: Provider
  inPer1m: number
  outPer1m: number
  cachedInputPer1m?: number
  batchInputPer1m?: number
  aaIndex?: number // Artificial Analysis Intelligence Index v4.0 (~8-40)
  arenaElo?: number // LMArena / Chatbot Arena Elo
  mmlu?: number
  tier: MarketTier
  contextWindow?: number
  batchEligible?: boolean
  promptCaching?: boolean
  reasoning?: boolean
  deprecated?: boolean
  successor?: string
}

export interface MarketAlt {
  model: string
  host: string
  inPer1m: number
  outPer1m: number
  arenaElo?: number
  aaIndex?: number
  replacesTier: MarketTier
  reasoning?: boolean // true only for reasoning-capable open models
  confidence: 'high' | 'medium' | 'low'
}

/** Per-model: current direct price, quality, and lifecycle. */
export const MARKET_INDEX: Record<string, MarketEntry> = {
  'gpt-4o': { model: 'gpt-4o', provider: 'openai', inPer1m: 2.5, outPer1m: 10, cachedInputPer1m: 1.25, batchInputPer1m: 1.25, aaIndex: 17.3, arenaElo: 1302, mmlu: 88.7, tier: 'frontier', contextWindow: 128000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: false, successor: 'gpt-5.5 (gpt-4o-2024-05-13 snapshot retires 2026-07-23)' },
  'gpt-4o-mini': { model: 'gpt-4o-mini', provider: 'openai', inPer1m: 0.15, outPer1m: 0.6, cachedInputPer1m: 0.075, batchInputPer1m: 0.075, aaIndex: 12.7, arenaElo: 1289, mmlu: 82, tier: 'small', contextWindow: 128000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: false },
  'gpt-4-turbo': { model: 'gpt-4-turbo', provider: 'openai', inPer1m: 10, outPer1m: 30, batchInputPer1m: 5, aaIndex: 13.7, arenaElo: 1275, mmlu: 86.5, tier: 'frontier', contextWindow: 128000, batchEligible: true, promptCaching: false, reasoning: false, deprecated: true, successor: 'gpt-4o' },
  'gpt-4': { model: 'gpt-4', provider: 'openai', inPer1m: 30, outPer1m: 60, aaIndex: 12, arenaElo: 1258, mmlu: 86.4, tier: 'frontier', contextWindow: 8192, batchEligible: true, promptCaching: false, reasoning: false, deprecated: true, successor: 'gpt-4o' },
  'o1': { model: 'o1', provider: 'openai', inPer1m: 15, outPer1m: 60, cachedInputPer1m: 7.5, batchInputPer1m: 7.5, aaIndex: 30, arenaElo: 1350, tier: 'reasoning', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: true, successor: 'gpt-5 / o3' },
  'o3': { model: 'o3', provider: 'openai', inPer1m: 2, outPer1m: 8, cachedInputPer1m: 0.5, batchInputPer1m: 1, aaIndex: 38.4, arenaElo: 1424, mmlu: 88.8, tier: 'reasoning', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: false, successor: 'GPT-5' },
  'o3-mini': { model: 'o3-mini', provider: 'openai', inPer1m: 1.1, outPer1m: 4.4, cachedInputPer1m: 0.275, batchInputPer1m: 0.55, aaIndex: 25.9, arenaElo: 1338, tier: 'reasoning', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: true, successor: 'gpt-5.5 (shutdown 2026-10-23)' },
  'claude-opus-4': { model: 'claude-opus-4', provider: 'anthropic', inPer1m: 15, outPer1m: 75, cachedInputPer1m: 1.5, batchInputPer1m: 7.5, arenaElo: 1360, tier: 'frontier', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: false, successor: 'claude-opus-4-8' },
  'claude-3-opus': { model: 'claude-3-opus', provider: 'anthropic', inPer1m: 15, outPer1m: 75, cachedInputPer1m: 1.5, batchInputPer1m: 7.5, aaIndex: 18, arenaElo: 1265, mmlu: 86.8, tier: 'frontier', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'claude-opus-4-8 (retired 2026-01-05)' },
  'claude-sonnet-4': { model: 'claude-sonnet-4', provider: 'anthropic', inPer1m: 3, outPer1m: 15, cachedInputPer1m: 0.3, batchInputPer1m: 1.5, arenaElo: 1335, mmlu: 86.5, tier: 'frontier', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: true, successor: 'claude-sonnet-4-6 (retirement 2026-06-15)' },
  'claude-3-5-sonnet': { model: 'claude-3-5-sonnet', provider: 'anthropic', inPer1m: 3, outPer1m: 15, cachedInputPer1m: 0.3, batchInputPer1m: 1.5, aaIndex: 16, arenaElo: 1299, mmlu: 88.3, tier: 'frontier', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'claude-sonnet-4-6 (retired 2025-10-28)' },
  'claude-3-5-haiku': { model: 'claude-3-5-haiku', provider: 'anthropic', inPer1m: 0.8, outPer1m: 4, cachedInputPer1m: 0.08, batchInputPer1m: 0.4, aaIndex: 19, arenaElo: 1256, tier: 'small', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'claude-haiku-4-5 (retired 2026-02-19)' },
  'claude-3-haiku': { model: 'claude-3-haiku', provider: 'anthropic', inPer1m: 0.25, outPer1m: 1.25, cachedInputPer1m: 0.03, batchInputPer1m: 0.125, aaIndex: 10, arenaElo: 1180, mmlu: 75.2, tier: 'small', contextWindow: 200000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'claude-haiku-4-5' },
  'gemini-1.5-pro': { model: 'gemini-1.5-pro', provider: 'gemini', inPer1m: 1.25, outPer1m: 5, batchInputPer1m: 0.625, aaIndex: 16, arenaElo: 1320, mmlu: 85.9, tier: 'frontier', contextWindow: 2000000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'gemini-2.5-pro (retired 2025-09-24)' },
  'gemini-1.5-flash': { model: 'gemini-1.5-flash', provider: 'gemini', inPer1m: 0.075, outPer1m: 0.3, batchInputPer1m: 0.0375, arenaElo: 1290, mmlu: 78.9, tier: 'small', contextWindow: 1000000, batchEligible: true, promptCaching: true, reasoning: false, deprecated: true, successor: 'gemini-2.5-flash (retired 2025-09-24)' },
  'gemini-2.5-pro': { model: 'gemini-2.5-pro', provider: 'gemini', inPer1m: 1.25, outPer1m: 10, cachedInputPer1m: 0.125, batchInputPer1m: 0.625, aaIndex: 34.6, arenaElo: 1460, tier: 'frontier', contextWindow: 1000000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: true, successor: 'gemini-3.1-pro-preview (shutdown 2026-10-16)' },
  'gemini-2.5-flash': { model: 'gemini-2.5-flash', provider: 'gemini', inPer1m: 0.3, outPer1m: 2.5, cachedInputPer1m: 0.03, batchInputPer1m: 0.15, aaIndex: 20.6, arenaElo: 1412, tier: 'mid', contextWindow: 1000000, batchEligible: true, promptCaching: true, reasoning: true, deprecated: true, successor: 'gemini-3.5-flash (shutdown 2026-10-16)' },
}

/** Cheaper open-weight destinations (the arbitrage targets), quality joined. */
export const OPEN_ALTERNATIVES: MarketAlt[] = [
  { model: 'deepseek-v3', host: 'DeepInfra', inPer1m: 0.32, outPer1m: 0.89, arenaElo: 1334, aaIndex: 16.5, replacesTier: 'frontier', confidence: 'high' },
  { model: 'deepseek-v3', host: 'Fireworks', inPer1m: 0.9, outPer1m: 0.9, arenaElo: 1334, aaIndex: 16.5, replacesTier: 'frontier', confidence: 'low' },
  { model: 'llama-3.3-70b', host: 'DeepInfra', inPer1m: 0.1, outPer1m: 0.32, arenaElo: 1276, aaIndex: 14, replacesTier: 'mid', confidence: 'high' },
  { model: 'llama-3.3-70b', host: 'Groq', inPer1m: 0.59, outPer1m: 0.79, arenaElo: 1276, aaIndex: 14, replacesTier: 'mid', confidence: 'high' },
  { model: 'llama-3.3-70b', host: 'AWS Bedrock', inPer1m: 0.72, outPer1m: 0.72, arenaElo: 1276, aaIndex: 14, replacesTier: 'mid', confidence: 'high' },
  { model: 'llama-3.3-70b', host: 'Together', inPer1m: 0.88, outPer1m: 0.88, arenaElo: 1276, aaIndex: 14, replacesTier: 'mid', confidence: 'medium' },
  { model: 'qwen-2.5-72b', host: 'DeepInfra', inPer1m: 0.36, outPer1m: 0.4, arenaElo: 1272, aaIndex: 16, replacesTier: 'mid', confidence: 'high' },
  { model: 'qwen-2.5-72b', host: 'Fireworks', inPer1m: 0.9, outPer1m: 0.9, arenaElo: 1272, aaIndex: 16, replacesTier: 'mid', confidence: 'medium' },
  { model: 'llama-3.1-8b', host: 'DeepInfra', inPer1m: 0.02, outPer1m: 0.05, arenaElo: 1193, aaIndex: 12, replacesTier: 'small', confidence: 'high' },
  { model: 'llama-3.1-8b', host: 'Groq', inPer1m: 0.05, outPer1m: 0.08, arenaElo: 1193, aaIndex: 12, replacesTier: 'small', confidence: 'high' },
  { model: 'mixtral-8x7b', host: 'AWS Bedrock', inPer1m: 0.45, outPer1m: 0.7, arenaElo: 1138, aaIndex: 8, replacesTier: 'small', confidence: 'high' },
]

const norm = (m: string) => m.toLowerCase().trim()

export function marketFor(model: string): MarketEntry | undefined {
  return MARKET_INDEX[norm(model)]
}

/** Blended $/1M at a 30/70 input/output mix - matches pricing.blendedPrice. */
export function blendOf(inPer1m: number, outPer1m: number): number {
  return inPer1m * 0.3 + outPer1m * 0.7
}

const REPLACEABLE_BY: Record<MarketTier, MarketTier[]> = {
  frontier: ['frontier', 'mid'],
  reasoning: ['frontier'],
  mid: ['mid', 'small'],
  small: ['small'],
}

export interface BestAlt {
  alt: MarketAlt
  cheaperPct: number // 0..1 blended savings vs the model
  qualityDeltaElo?: number // alt Elo - model Elo (negative = lower quality)
}

const CONF_RANK: Record<MarketAlt['confidence'], number> = { high: 3, medium: 2, low: 1 }

/**
 * The closest-quality cheaper open-model destination for a model's routine work:
 * among alternatives at least 25% cheaper (blended), pick the highest-quality
 * one (deterministic tiebreak: confidence, then price). Returns the honest Elo
 * delta so the report shows the tradeoff. Reasoning-tier models require a
 * reasoning-capable alternative - we have none, so they get no suggestion rather
 * than a misleading "equivalent" non-reasoning model.
 */
export function bestAlternative(entry: MarketEntry): BestAlt | undefined {
  const modelBlend = blendOf(entry.inPer1m, entry.outPer1m)
  if (modelBlend <= 0) return undefined
  const tiers = REPLACEABLE_BY[entry.tier]
  let cands = OPEN_ALTERNATIVES.filter(
    (a) => tiers.includes(a.replacesTier) && blendOf(a.inPer1m, a.outPer1m) <= modelBlend * 0.75,
  )
  if (entry.reasoning) cands = cands.filter((a) => a.reasoning)
  if (!cands.length) return undefined
  cands.sort(
    (a, b) =>
      (b.arenaElo ?? 0) - (a.arenaElo ?? 0) ||
      CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
      blendOf(a.inPer1m, a.outPer1m) - blendOf(b.inPer1m, b.outPer1m),
  )
  const alt = cands[0]
  return {
    alt,
    cheaperPct: 1 - blendOf(alt.inPer1m, alt.outPer1m) / modelBlend,
    qualityDeltaElo: entry.arenaElo && alt.arenaElo ? alt.arenaElo - entry.arenaElo : undefined,
  }
}
