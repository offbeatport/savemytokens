import type { Audit, Corpus } from "../core/types.js";
import { aggregate } from "./aggregate.js";
import { combinedWaste } from "./combine.js";
import { runDetectors } from "./detectors.js";
import { scoreAudit } from "./score.js";

export const AUDIT_VERSION = 1;

export function analyze(corpus: Corpus, ranAt = Date.now()): Audit {
  const agg = aggregate(corpus);
  const findings = runDetectors(agg);
  const wasteRatio = combinedWaste(findings);
  const { score, breakdown } = scoreAudit(agg, wasteRatio);
  const upliftRatio = wasteRatio > 0 ? 1 / (1 - wasteRatio) - 1 : 0;

  return {
    version: AUDIT_VERSION,
    ranAt,
    scope: corpus.scope,
    totals: agg.totals,
    findings,
    score,
    scoreBreakdown: breakdown,
    wasteRatio,
    upliftRatio,
    models: agg.models,
    outcomes: agg.outcomes,
    rateLimitHits: agg.rateLimitHits,
    topTasks: agg.topTasks,
    projects: agg.projects,
  };
}

export { aggregate } from "./aggregate.js";
