import type { ScoreComponent } from "../core/types.js";
import type { Aggregate } from "./aggregate.js";

const MAX_WASTE_PENALTY = 55;
const MAX_ERROR_PENALTY = 8;
const MAX_INTERRUPT_PENALTY = 5;

export function scoreAudit(agg: Aggregate, wasteRatio: number): { score: number; breakdown: ScoreComponent[] } {
  const breakdown: ScoreComponent[] = [{ id: "base", label: "Base", points: 100 }];

  const wastePenalty = Math.min(MAX_WASTE_PENALTY, Math.round(wasteRatio * 120));
  if (wastePenalty > 0) breakdown.push({ id: "waste", label: "Avoidable token spend", points: -wastePenalty });

  const turns = Math.max(1, agg.totals.turns);
  const errorRate = (agg.apiErrors + agg.toolErrors) / turns;
  const errorPenalty = Math.min(MAX_ERROR_PENALTY, Math.round(errorRate * 40));
  if (errorPenalty > 0) breakdown.push({ id: "errors", label: "Failed calls and retries", points: -errorPenalty });

  const tasks = Math.max(1, agg.totals.tasks);
  const interruptPenalty = Math.min(MAX_INTERRUPT_PENALTY, Math.round((agg.outcomes.interrupted / tasks) * 20));
  if (interruptPenalty > 0) breakdown.push({ id: "interrupted", label: "Interrupted tasks", points: -interruptPenalty });

  const total = breakdown.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.max(0, Math.min(100, Math.round(total))), breakdown };
}
