import type { ClaimantState, Priority, Resource } from "../core/resource.js";
import { ADAPTER_ID, resourcesFor, sweep } from "../adapters/claude-code/provider.js";
import {
  FIVE_HOUR_MS,
  loadClaimants,
  loadConfig,
  loadQuota,
  saveConfig,
  schedule,
  upsertClaimant,
  windowBounds,
  type ClaimantPlanView,
  type Config,
  type SchedulePlanView,
} from "../runtime/kernel.mjs";

export interface ControlPlan {
  schedule: SchedulePlanView;
  resources: Resource[];
  config: Config;
  unattributed: number | null;
}

function unattributedPercent(plan: SchedulePlanView): number | null {
  const history = (plan.quota as { history?: Array<{ at: number; metered: number; five_hour: number | null }> } | null)
    ?.history;
  if (!Array.isArray(history) || history.length < 2) return null;
  let drift = 0;
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1];
    const current = history[i];
    if (!previous || !current) continue;
    if (current.at < plan.bounds.from) continue;
    if (typeof current.five_hour !== "number" || typeof previous.five_hour !== "number") continue;
    const quotaDelta = current.five_hour - previous.five_hour;
    const meteredDelta = (current.metered ?? 0) - (previous.metered ?? 0);
    if (quotaDelta > 0 && meteredDelta <= 0) drift += quotaDelta;
  }
  return drift > 0 ? drift : null;
}

export function buildPlan(now = Date.now(), withSweep = true): ControlPlan {
  if (withSweep) {
    const bounds = windowBounds(loadQuota(ADAPTER_ID), "five_hour", now);
    sweep(Math.min(bounds.from, now - FIVE_HOUR_MS), now);
  }
  const plan = schedule(ADAPTER_ID, now);
  return { schedule: plan, resources: resourcesFor(now), config: loadConfig(), unattributed: unattributedPercent(plan) };
}

const VISIBLE_LIMIT = 12;
const VISIBLE_SHARE = 0.005;

function live(view: ClaimantPlanView): boolean {
  return view.state === "active" || view.state === "needs-more";
}

export function activeViews(plan: SchedulePlanView): ClaimantPlanView[] {
  return plan.claimants
    .filter((view) => live(view) || view.observed >= VISIBLE_SHARE)
    .sort(
      (a, b) =>
        Number(live(b)) - Number(live(a)) ||
        b.observed - a.observed ||
        a.claimant.label.localeCompare(b.claimant.label),
    )
    .slice(0, VISIBLE_LIMIT);
}

export function setShare(id: string, share: number | null): void {
  upsertClaimant(ADAPTER_ID, id, { share: share === null ? null : Math.max(0, Math.min(1, share)) });
}

export function setPriority(id: string, priority: Priority): void {
  upsertClaimant(ADAPTER_ID, id, { priority });
}

export function setState(id: string, state: ClaimantState): void {
  upsertClaimant(ADAPTER_ID, id, { state, endedAt: state === "done" ? Date.now() : null });
}

export function equalize(): void {
  for (const claimant of loadClaimants(ADAPTER_ID)) {
    if (claimant.share === null) continue;
    upsertClaimant(ADAPTER_ID, claimant.id, { share: null });
  }
}

export function cyclePriority(current: Priority): Priority {
  if (current === "high") return "normal";
  if (current === "normal") return "low";
  return "high";
}

export function savePreference(project: string, kinds: string[]): void {
  const config = loadConfig();
  config.preserveFor[project || "default"] = kinds;
  saveConfig(config);
}
