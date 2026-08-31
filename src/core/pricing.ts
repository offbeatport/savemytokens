import fs from "node:fs";
import path from "node:path";
import type { Usage } from "./types.js";

export interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PriceSource {
  label: string;
  asOf: string;
  url: string;
}

export const PRICE_SOURCES: PriceSource[] = [
  { label: "Anthropic", asOf: "2026-06-24", url: "https://docs.claude.com/en/docs/about-claude/pricing" },
  { label: "OpenAI", asOf: "2026-08-31", url: "https://developers.openai.com/api/docs/pricing" },
];

const TABLE: Array<[RegExp, Rate]> = [
  [/fable|mythos/i, { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }],
  [/opus/i, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/sonnet-4-6/i, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/sonnet/i, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/haiku/i, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  [/gpt-5\.5-pro/i, { input: 30, output: 180, cacheRead: 3, cacheWrite: 30 }],
  [/gpt-5\.6-luna/i, { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.2 }],
  [/gpt-5\.6-terra/i, { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 }],
  [/gpt-5\.6/i, { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 }],
  [/gpt-5\.5/i, { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 }],
  [/gpt-5\.4/i, { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 }],
  [/gpt-5/i, { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 }],
];

const FALLBACK: Rate = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

let overrides: Record<string, Rate> | null = null;

function loadOverrides(): Record<string, Rate> {
  if (overrides) return overrides;
  overrides = {};
  const home = process.env.SAVEMYTOKENS_HOME || path.join(process.env.HOME ?? "", ".savemytokens");
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, "pricing.json"), "utf8"));
    if (parsed && typeof parsed === "object") overrides = parsed as Record<string, Rate>;
  } catch {
    overrides = {};
  }
  return overrides;
}

export function rateFor(model: string): Rate {
  const override = loadOverrides()[model];
  if (override) return override;
  for (const [pattern, rate] of TABLE) if (pattern.test(model)) return rate;
  return FALLBACK;
}

export function isKnownModel(model: string): boolean {
  if (loadOverrides()[model]) return true;
  return TABLE.some(([pattern]) => pattern.test(model));
}

export function usd(model: string, usage: Usage): number {
  const rate = rateFor(model);
  return (
    (usage.input * rate.input +
      usage.cacheWrite * rate.cacheWrite +
      usage.cacheRead * rate.cacheRead +
      usage.output * rate.output) /
    1_000_000
  );
}

export function pricingNote(): string {
  return `Prices: ${PRICE_SOURCES.map((s) => `${s.label} list ${s.asOf}`).join(", ")}. Override in ~/.savemytokens/pricing.json`;
}
