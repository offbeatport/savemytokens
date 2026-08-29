import type { Finding } from "../core/types.js";

export const MAX_COMBINED_WASTE = 0.45;
export const OVERLAP_DISCOUNT = 0.5;

export function combinedWaste(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  const sorted = [...findings].sort((a, b) => b.wasteRatio - a.wasteRatio);
  const [first, ...rest] = sorted;
  const head = first?.wasteRatio ?? 0;
  const tail = rest.reduce((sum, f) => sum + f.wasteRatio, 0) * OVERLAP_DISCOUNT;
  return Math.min(MAX_COMBINED_WASTE, head + tail);
}
