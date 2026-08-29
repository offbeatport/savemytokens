import { WEIGHTS } from "./tokens.js";

export class LifetimeCost {
  tokens = 0;
  private segments = new Map<number, { tokens: number; tokenTurns: number }>();

  add(segment: number, turn: number, tokens: number): void {
    this.tokens += tokens;
    let s = this.segments.get(segment);
    if (!s) {
      s = { tokens: 0, tokenTurns: 0 };
      this.segments.set(segment, s);
    }
    s.tokens += tokens;
    s.tokenTurns += tokens * turn;
  }

  resolve(segmentEnds: number[]): number {
    let total = 0;
    for (const [segment, s] of this.segments) {
      const end = segmentEnds[segment] ?? 0;
      const residentTurns = Math.max(0, end * s.tokens - s.tokenTurns);
      total += WEIGHTS.cacheWrite * s.tokens + WEIGHTS.cacheRead * residentTurns;
    }
    return total;
  }
}
