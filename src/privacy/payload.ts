import type { Audit } from "../core/types.js";

export interface ContributionPayload {
  schema: 1;
  tool: string;
  agent: string;
  window_days: number;
  sessions: number;
  tasks: number;
  turns: number;
  tokens: { input: number; output: number; cache_write: number; cache_read: number };
  efficiency_score: number;
  waste_ratio: number;
  findings: Array<{ id: string; waste_ratio: number; confidence: string }>;
  outcomes: { completed: number; interrupted: number; failed: number };
}

export function buildPayload(audit: Audit, version: string, outcomes: ContributionPayload["outcomes"]): ContributionPayload {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    schema: 1,
    tool: `savemytokens@${version}`,
    agent: audit.scope.adapters.join(","),
    window_days: audit.scope.days,
    sessions: audit.totals.sessions,
    tasks: audit.totals.tasks,
    turns: audit.totals.turns,
    tokens: {
      input: audit.totals.usage.input,
      output: audit.totals.usage.output,
      cache_write: audit.totals.usage.cacheWrite,
      cache_read: audit.totals.usage.cacheRead,
    },
    efficiency_score: audit.score,
    waste_ratio: round(audit.wasteRatio),
    findings: audit.findings.map((f) => ({ id: f.id, waste_ratio: round(f.wasteRatio), confidence: f.confidence })),
    outcomes,
  };
}
