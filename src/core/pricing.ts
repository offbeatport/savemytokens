import type { Usage } from "./types.js";

interface Rate {
  input: number;
  output: number;
}

const RATES: Array<[RegExp, Rate]> = [
  [/fable|mythos/i, { input: 10, output: 50 }],
  [/opus/i, { input: 5, output: 25 }],
  [/sonnet-4-6/i, { input: 3, output: 15 }],
  [/sonnet/i, { input: 2, output: 10 }],
  [/haiku/i, { input: 1, output: 5 }],
];

const FALLBACK: Rate = { input: 5, output: 25 };

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export function rateFor(model: string): Rate {
  for (const [pattern, rate] of RATES) if (pattern.test(model)) return rate;
  return FALLBACK;
}

export function usd(model: string, usage: Usage): number {
  const rate = rateFor(model);
  const inputCost =
    usage.input * rate.input +
    usage.cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheRead * rate.input * CACHE_READ_MULTIPLIER;
  return (inputCost + usage.output * rate.output) / 1_000_000;
}

export function usdPerWeightedToken(model: string): number {
  return rateFor(model).input / 1_000_000;
}
