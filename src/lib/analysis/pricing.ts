import type { Provider } from './types'

/** Illustrative public list prices, USD per 1M tokens. Used to split
 * a row's known total cost into input vs output components and to
 * estimate model-downgrade savings. Tune freely - never authoritative. */
export interface ModelPrice {
  in: number
  out: number
  provider: Provider
  /** A cheaper, broadly-capable sibling to migrate suitable traffic to. */
  cheaper?: string
  /** Marks an older model that has a strictly better/cheaper successor. */
  legacy?: boolean
  /** Reasoning/thinking model: emits hidden reasoning tokens billed as output. */
  reasoning?: boolean
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { in: 2.5, out: 10, provider: 'openai', cheaper: 'gpt-4o-mini' },
  'gpt-4o-mini': { in: 0.15, out: 0.6, provider: 'openai' },
  'gpt-4-turbo': { in: 10, out: 30, provider: 'openai', cheaper: 'gpt-4o', legacy: true },
  'gpt-4': { in: 30, out: 60, provider: 'openai', cheaper: 'gpt-4o', legacy: true },
  'o1': { in: 15, out: 60, provider: 'openai', cheaper: 'o3', reasoning: true },
  // o3 was cut to $2/$8 (2026); at that price it is cheaper AND higher-quality
  // than gpt-4o, so it has no cheaper sibling to downgrade to. Kept in sync with
  // MARKET_INDEX (see market.test.ts price-parity guard).
  'o3': { in: 2, out: 8, provider: 'openai', reasoning: true },
  'o3-mini': { in: 1.1, out: 4.4, provider: 'openai', reasoning: true },
  // Anthropic
  'claude-opus-4': { in: 15, out: 75, provider: 'anthropic', cheaper: 'claude-sonnet-4' },
  'claude-3-opus': { in: 15, out: 75, provider: 'anthropic', cheaper: 'claude-3-5-sonnet', legacy: true },
  'claude-sonnet-4': { in: 3, out: 15, provider: 'anthropic' },
  'claude-3-5-sonnet': { in: 3, out: 15, provider: 'anthropic' },
  'claude-3-5-haiku': { in: 0.8, out: 4, provider: 'anthropic' },
  'claude-3-haiku': { in: 0.25, out: 1.25, provider: 'anthropic' },
  // Google
  'gemini-1.5-pro': { in: 1.25, out: 5, provider: 'gemini', cheaper: 'gemini-1.5-flash' },
  'gemini-2.5-pro': { in: 1.25, out: 10, provider: 'gemini', cheaper: 'gemini-2.5-flash' },
  'gemini-1.5-flash': { in: 0.075, out: 0.3, provider: 'gemini' },
  'gemini-2.5-flash': { in: 0.3, out: 2.5, provider: 'gemini' },
}

const DEFAULT_PRICE: ModelPrice = { in: 2, out: 8, provider: 'other' }

export function priceFor(model: string): ModelPrice {
  // Normalize the key like marketFor() does, so 'GPT-4o' / ' gpt-4o ' resolve the
  // same model in both the pricing and market layers (no silent divergence).
  return MODEL_PRICING[model] ?? MODEL_PRICING[model.toLowerCase().trim()] ?? DEFAULT_PRICE
}

/** Blended $/1M for a 30/70 input/output mix - quick model cost proxy. */
export function blendedPrice(model: string): number {
  const p = priceFor(model)
  return p.in * 0.3 + p.out * 0.7
}
