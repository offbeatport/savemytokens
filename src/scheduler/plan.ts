import type { ClaimantState, EnforcementLevel, Priority, Provider, Resource } from "../core/resource.js";
import { claudeCodeProvider } from "../adapters/claude-code/provider.js";
import { codexProvider } from "../adapters/codex/provider.js";
import {
  FIVE_HOUR_MS,
  WINDOW_MS,
  clearDeferred,
  deferredProjects,
  loadClaimants,
  loadConfig,
  loadQuota,
  policyNames,
  saveConfig,
  schedule,
  upsertClaimant,
  windowBounds,
  type ClaimantPlanView,
  type Config,
  type DeferredItem,
  type SchedulePlanView,
  type WindowKey,
} from "../runtime/kernel.mjs";

export const providers: Provider[] = [claudeCodeProvider, codexProvider];

export interface ControlPlan {
  provider: Provider;
  schedule: SchedulePlanView;
  resources: Resource[];
  config: Config;
  enforcement: EnforcementLevel[];
  unattributed: number | null;
  deferred: Array<{ project: string; items: DeferredItem[] }>;
  others: Array<{ id: string; label: string; resources: Resource[] }>;
}

export function providerFor(id: string): Provider {
  return providers.find((provider) => provider.id === id) ?? claudeCodeProvider;
}

export function detectedProviders(): Provider[] {
  return providers.filter((provider) => provider.detect());
}

function unattributedPercent(plan: SchedulePlanView): number | null {
  const history = plan.quota?.history;
  if (!Array.isArray(history) || history.length < 2) return null;
  let drift = 0;
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1];
    const current = history[i];
    if (!previous || !current) continue;
    if (current.at < plan.bounds.from) continue;
    if (typeof current.five_hour !== "number" || typeof previous.five_hour !== "number") continue;
    if (typeof current.turnAt !== "number" || typeof previous.turnAt !== "number") continue;
    const quotaDelta = current.five_hour - previous.five_hour;
    if (quotaDelta > 0 && current.turnAt === previous.turnAt) drift += quotaDelta;
  }
  return drift > 0 ? drift : null;
}

export function buildPlan(now = Date.now(), withSweep = true, window: WindowKey = "five_hour", adapter = "claude-code"): ControlPlan {
  const provider = providerFor(adapter);
  if (withSweep) {
    const bounds = windowBounds(loadQuota(provider.id), window, now);
    const span = WINDOW_MS[window] ?? FIVE_HOUR_MS;
    provider.sweep(Math.min(bounds.from, now - span), now);
  }
  const plan = schedule(provider.id, now, window);
  const others = detectedProviders()
    .filter((other) => other.id !== provider.id)
    .map((other) => ({ id: other.id, label: other.label, resources: other.resources(now) }));

  return {
    provider,
    schedule: plan,
    resources: provider.resources(now),
    config: loadConfig(),
    enforcement: provider.enforcer.supports,
    unattributed: unattributedPercent(plan),
    deferred: deferredProjects(provider.id, now),
    others,
  };
}

const RECENT_LIMIT = 6;
const PARKED_LIMIT = 4;

function live(view: ClaimantPlanView): boolean {
  return view.state === "active" || view.state === "needs-more";
}

export interface WorkingSet {
  active: ClaimantPlanView[];
  recent: ClaimantPlanView[];
  parked: ClaimantPlanView[];
  hidden: number;
}

function byInterest(a: ClaimantPlanView, b: ClaimantPlanView): number {
  return (
    Number(b.claimant.pinned) - Number(a.claimant.pinned) ||
    b.claimant.lastSeen - a.claimant.lastSeen ||
    b.observed - a.observed
  );
}

export function workingSet(plan: SchedulePlanView): WorkingSet {
  const active = plan.claimants.filter((view) => view.bucket === "active").sort((a, b) => byInterest(a, b) || b.observed - a.observed);
  const recentAll = plan.claimants.filter((view) => view.bucket === "recent").sort(byInterest);
  const parkedAll = plan.claimants.filter((view) => view.bucket === "parked").sort(byInterest);
  const recent = recentAll.slice(0, RECENT_LIMIT);
  const parked = parkedAll.slice(0, PARKED_LIMIT);
  return {
    active,
    recent,
    parked,
    hidden: recentAll.length - recent.length + (parkedAll.length - parked.length),
  };
}

export function visibleRows(plan: SchedulePlanView): ClaimantPlanView[] {
  const set = workingSet(plan);
  return [...set.active, ...set.recent, ...set.parked];
}

export function activeViews(plan: SchedulePlanView): ClaimantPlanView[] {
  return workingSet(plan).active;
}

export function setShare(id: string, share: number | null, adapter = "claude-code"): void {
  upsertClaimant(adapter, id, { share: share === null ? null : Math.max(0, Math.min(1, share)) });
}

export function setPriority(id: string, priority: Priority, adapter = "claude-code"): void {
  upsertClaimant(adapter, id, { priority });
}

export function setState(id: string, state: ClaimantState, adapter = "claude-code"): void {
  upsertClaimant(adapter, id, { state, endedAt: state === "done" ? Date.now() : null });
}

export function equalize(adapter = "claude-code"): void {
  for (const claimant of loadClaimants(adapter)) {
    if (claimant.share === null) continue;
    upsertClaimant(adapter, claimant.id, { share: null });
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
  config.preferencesSetAt = Date.now();
  saveConfig(config);
}

export function saveCustomAdvice(project: string, text: string): void {
  const config = loadConfig();
  const key = project || "default";
  const value = text.trim();
  if (value) config.customAdvice[key] = value;
  else delete config.customAdvice[key];
  saveConfig(config);
}

export function setPinned(id: string, pinned: boolean, adapter = "claude-code"): void {
  upsertClaimant(adapter, id, { pinned });
}

export function setParked(id: string, parked: boolean, adapter = "claude-code"): void {
  upsertClaimant(adapter, id, { parked, ...(parked ? { state: "done" as ClaimantState } : {}) });
}

export function setPolicy(name: string, project: string | null): boolean {
  if (!policyNames().includes(name)) return false;
  const config = loadConfig();
  if (project) config.policyFor[project] = name;
  else config.policy = name;
  saveConfig(config);
  return true;
}

export function forgetDeferred(project: string, adapter = "claude-code"): void {
  clearDeferred(adapter, project);
}

export interface ResolvedClaimant {
  view: ClaimantPlanView;
  matches: number;
}

export function resolveClaimant(plan: SchedulePlanView, term: string): ResolvedClaimant | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  const pool = plan.claimants;
  const exact = pool.filter((view) => view.claimant.id === term || view.claimant.label.toLowerCase() === needle);
  const partial = pool.filter(
    (view) => view.claimant.id.startsWith(term) || view.claimant.label.toLowerCase().includes(needle),
  );
  const candidates = exact.length > 0 ? exact : partial;
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(
    (a, b) => Number(live(b)) - Number(live(a)) || b.observed - a.observed,
  );
  const view = ranked[0];
  if (!view) return null;
  return { view, matches: candidates.length };
}
