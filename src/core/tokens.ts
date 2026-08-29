import type { Usage } from "./types.js";

export const WEIGHTS = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  output: 5,
} as const;

export const CHARS_PER_TOKEN = 4;

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

export function addUsage(target: Usage, add: Usage): Usage {
  target.input += add.input;
  target.output += add.output;
  target.cacheWrite += add.cacheWrite;
  target.cacheRead += add.cacheRead;
  return target;
}

export function rawTokens(u: Usage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

export function weigh(u: Usage): number {
  return (
    u.input * WEIGHTS.input +
    u.cacheWrite * WEIGHTS.cacheWrite +
    u.cacheRead * WEIGHTS.cacheRead +
    u.output * WEIGHTS.output
  );
}

export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function contextLifetimeCost(tokens: number, turnsAfter: number): number {
  return tokens * (WEIGHTS.cacheWrite + WEIGHTS.cacheRead * Math.max(0, turnsAfter));
}
