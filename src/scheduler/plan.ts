import fs from "node:fs";
import path from "node:path";
import type { ClaimantState, EnforcementLevel, Priority, Provider, Resource } from "../core/resource.js";
import { withMoved, withToggled } from "../report/settings.js";
import { claudeCodeProvider } from "../adapters/claude-code/provider.js";
import { codexProvider } from "../adapters/codex/provider.js";
import {
  HOOKS_DIR,
  FIVE_HOUR_MS,
  WINDOW_MS,
  clearDeferred,
  deferredProjects,
  loadClaimants,
  loadConfig,
  loadProjects,
  presetMatching,
  presetSegments,
  upsertProject,
  loadQuota,
  policyNames,
  saveConfig,
  schedule,
  upsertClaimant,
  windowBounds,
  type ClaimantPlanView,
  type Config,
  type ProjectView,
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
  installed: boolean;
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
    installed: fs.existsSync(path.join(HOOKS_DIR, "statusline.mjs")),
  };
}

const RECENT_LIMIT = 6;
const PARKED_LIMIT = 4;

export interface WorkingSet {
  active: ProjectView[];
  recent: ProjectView[];
  parked: ProjectView[];
  hidden: number;
}

function byInterest(a: ProjectView, b: ProjectView): number {
  return Number(b.settings.pinned) - Number(a.settings.pinned) || b.lastSeen - a.lastSeen || b.observed - a.observed;
}

export function workingSet(plan: SchedulePlanView, full = false): WorkingSet {
  const active = plan.projects
    .filter((view) => view.bucket === "active")
    .sort((a, b) => byInterest(a, b) || b.observed - a.observed);
  const idleAll = plan.projects
    .filter((view) => view.bucket !== "active" && !view.settings.parked)
    .sort(byInterest);
  const parkedAll = plan.projects.filter((view) => view.bucket !== "active" && view.settings.parked).sort(byInterest);
  const recent = full ? idleAll : idleAll.slice(0, RECENT_LIMIT);
  const parked = full ? parkedAll : [];
  return { active, recent, parked, hidden: idleAll.length - recent.length + (parkedAll.length - parked.length) };
}

export function visibleRows(plan: SchedulePlanView, full = false): ProjectView[] {
  const set = workingSet(plan, full);
  return [...set.active, ...set.recent, ...set.parked];
}

export function activeViews(plan: SchedulePlanView): ProjectView[] {
  return workingSet(plan).active;
}

export function selectionIndex(ids: string[], selectedId: string | null, previousIndex: number): number {
  if (ids.length === 0) return 0;
  if (selectedId) {
    const found = ids.indexOf(selectedId);
    if (found !== -1) return found;
  }
  return Math.max(0, Math.min(previousIndex, ids.length - 1));
}

export function cleanShare(share: number | null): number | null {
  if (share === null || !Number.isFinite(share)) return null;
  const clamped = Math.max(0, Math.min(1, share));
  const rounded = Math.round(clamped * 200) / 200;
  return rounded < 0.005 ? 0 : rounded;
}

export function nextShare(view: ProjectView, delta: number): number {
  const held = view.settings.share;
  const from = view.bucket === "active" || held == null ? view.allocation.target : held;
  return Math.max(0, Math.min(1, from + delta));
}

export function setShare(project: string, share: number | null, adapter = "claude-code"): void {
  upsertProject(adapter, project, { share: cleanShare(share) });
}

export function setPriority(project: string, priority: Priority, adapter = "claude-code"): void {
  upsertProject(adapter, project, { priority });
}

export function setState(project: string, state: ClaimantState, adapter = "claude-code"): void {
  for (const claimant of loadClaimants(adapter)) {
    if ((claimant.project || claimant.label) !== project) continue;
    upsertClaimant(adapter, claimant.id, { state, endedAt: state === "done" ? Date.now() : null });
  }
}

export function equalize(adapter = "claude-code"): void {
  for (const project of loadProjects(adapter)) {
    if (project.share === null) continue;
    upsertProject(adapter, project.project, { share: null });
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

export function toggleColumn(id: string): void {
  const config = loadConfig();
  const columns = withToggled(config.columns, id);
  config.columns = columns.length > 0 ? columns : [id];
  saveConfig(config);
}

export function cyclePreset(delta: number, names: string[]): void {
  if (names.length === 0) return;
  const config = loadConfig();
  const current = presetMatching(config.hud.segments);
  const at = current ? names.indexOf(current) : -1;
  const next = names[(at + delta + names.length * 2) % names.length] ?? names[0];
  const segments = next ? presetSegments(next) : null;
  if (segments) {
    config.hud.segments = [...segments];
    saveConfig(config);
  }
}

export function toggleSegment(id: string): void {
  const config = loadConfig();
  config.hud.segments = withToggled(config.hud.segments, id);
  saveConfig(config);
}

export function moveSegment(id: string, delta: number): void {
  const config = loadConfig();
  config.hud.segments = withMoved(config.hud.segments, id, delta);
  saveConfig(config);
}

export function cycleTheme(surface: "tui" | "hud", delta: number, names: string[]): void {
  if (names.length === 0) return;
  const config = loadConfig();
  const at = names.indexOf(config.theme[surface]);
  const next = names[(at + delta + names.length) % names.length] ?? names[0];
  if (next) config.theme[surface] = next;
  saveConfig(config);
}

export function cyclePolicy(delta: number): void {
  const names = policyNames();
  const config = loadConfig();
  const at = names.indexOf(config.policy);
  const next = names[(at + delta + names.length) % names.length] ?? names[0];
  if (next) config.policy = next;
  saveConfig(config);
}

export function togglePreserve(kind: string): void {
  const config = loadConfig();
  const current = config.preserveFor.default ?? [];
  const next = current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind];
  config.preserveFor.default = next;
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

export function setPinned(project: string, pinned: boolean, adapter = "claude-code"): void {
  upsertProject(adapter, project, { pinned });
}

export function setParked(project: string, parked: boolean, adapter = "claude-code"): void {
  upsertProject(adapter, project, { parked });
  if (parked) setState(project, "done", adapter);
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
  view: ProjectView;
  matches: number;
}

export function resolveClaimant(plan: SchedulePlanView, term: string): ResolvedClaimant | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  const pool = plan.projects;
  const exact = pool.filter((view) => view.project === term || view.label.toLowerCase() === needle);
  const partial = pool.filter((view) => view.label.toLowerCase().includes(needle) || view.project.toLowerCase().includes(needle));
  const candidates = exact.length > 0 ? exact : partial;
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => Number(b.bucket === "active") - Number(a.bucket === "active") || b.observed - a.observed);
  const view = ranked[0];
  if (!view) return null;
  return { view, matches: candidates.length };
}
