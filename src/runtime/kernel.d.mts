import type {
  Allocation,
  AllocationResult,
  Claimant,
  ClaimantState,
  Pressure,
  Priority,
} from "../core/resource.js";

export const HOME: string;
export const CLAIMANT_DIR: string;
export const METER_DIR: string;
export const QUOTA_DIR: string;
export const THEME_DIR: string;
export const HOOKS_DIR: string;
export const CONFIG_FILE: string;

export const FIVE_HOUR_MS: number;
export const SEVEN_DAY_MS: number;
export const WINDOW_MS: Record<string, number>;
export const WINDOW_LABEL: Record<string, string>;
export const STAGES: number[];
export const DEFAULT_POLICY: string;
export const DEFER_DIR: string;

export type WindowKey = "five_hour" | "seven_day" | "spend_limit";

export interface QuotaWindow {
  usedPercent: number;
  resetsAt: number;
}

export interface QuotaHistoryPoint {
  at: number;
  metered: number;
  turnAt?: number;
  five_hour: number | null;
  seven_day: number | null;
}

export interface QuotaReading {
  at: number;
  source: string;
  sessionId?: string;
  meteredTokens?: number;
  windows: Partial<Record<WindowKey, QuotaWindow>>;
  history?: QuotaHistoryPoint[];
}

export interface AdviceState {
  stage: number;
  at: number;
  window: number;
}

export type ClaimantBucket = "active" | "recent" | "parked";

export interface ClaimantRecord extends Claimant {
  schema: number;
  advice: AdviceState;
  heartbeat: number;
  pinned: boolean;
  parked: boolean;
  kept: boolean | null;
}

export interface MeterRecord {
  schema: number;
  adapter: string;
  id: string;
  files: Record<string, number>;
  buckets: number[][];
  seen: string[];
  lockouts: number[];
  lastAt: number;
  meteredAt: number;
  project: string;
  prompt: string;
  prompts: string[];
  signal: string | null;
  defers: string[];
}

export interface DeferredItem {
  at: number;
  text: string;
  session: string;
  project: string;
}

export interface PolicyStage {
  at: number;
  actions: string[];
}

export interface Policy {
  name?: string;
  label: string;
  summary: string;
  stages: PolicyStage[];
}

export interface WindowUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  requests: number;
  tokens: number;
  weighted: number;
}

export interface Config {
  version: number;
  createdAt: number;
  preferencesSetAt: number;
  offeredInstallAt: number;
  primerSeenAt: number;
  policy: string;
  policyFor: Record<string, string>;
  theme: { tui: string; hud: string };
  layout: { hud: string };
  columns: string[];
  hud: { segments: string[] };
  preserveFor: Record<string, string[]>;
  customAdvice: Record<string, string>;
  wrappedStatusLine: string | null;
}

export interface Theme {
  name: string;
  colors: Record<string, string>;
  glyphs: Record<string, string>;
  border: Record<string, string>;
  tui: Record<string, string>;
}

export interface AllocationEntry {
  id: string;
  share: number | null;
  priority: Priority;
  state: ClaimantState;
  consumed: number;
  cap?: number | null;
}

export interface HudView {
  label: string;
  target: number;
  observed: number;
  used?: number | null;
  pressure: number;
  priority: string;
  quota: Partial<Record<WindowKey, QuotaWindow>>;
  history?: number[];
  rate?: number | null;
  from?: number;
  to?: number;
  stale?: boolean;
  now?: number;
}

export interface AdviceView {
  target: number;
  observed?: number;
  pressure?: number;
  basis?: string;
  preserve: string[];
  policy?: Policy;
  custom?: string;
}

export function readJson<T>(file: string, fallback: T): T;
export function writeJson(file: string, value: unknown): boolean;

export const DEFAULT_CONFIG: Config;
export function loadConfig(): Config;
export function saveConfig(config: Config): boolean;

export function claimantFile(adapter: string, id: string): string;
export function meterFile(adapter: string, id: string): string;
export function quotaFile(adapter: string): string;

export function loadClaimant(adapter: string, id: string): ClaimantRecord | null;
export function upsertClaimant(adapter: string, id: string, patch?: Partial<ClaimantRecord>): ClaimantRecord;
export function loadClaimants(adapter: string): ClaimantRecord[];
export const PROJECT_DIR: string;
export function projectKey(project: string): string;
export function loadProject(adapter: string, project: string): ProjectSettings;
export function upsertProject(adapter: string, project: string, patch?: Partial<ProjectSettings>): ProjectSettings;
export function loadProjects(adapter: string): ProjectSettings[];
export function effectiveState(claimant: ClaimantRecord, now?: number, strict?: boolean): ClaimantState;
export function isStale(claimant: ClaimantRecord, now?: number, strict?: boolean): boolean;
export function heartbeatsLive(claimants: ClaimantRecord[], now?: number): boolean;
export function bucketFor(claimant: ClaimantRecord, now?: number, strict?: boolean): ClaimantBucket;

export function saveQuota(adapter: string, reading: QuotaReading): boolean;
export function loadQuota(adapter: string): QuotaReading | null;
export function liveWindow(reading: QuotaReading | null, key: WindowKey, now?: number): QuotaWindow | null;
export function windowBounds(
  reading: QuotaReading | null,
  key: WindowKey,
  now?: number,
): { from: number; to: number; anchored: boolean };

export function loadMeter(adapter: string, id: string): MeterRecord;
export function sampleFiles(adapter: string, id: string, files: string[], now?: number): MeterRecord;
export function usageInWindow(record: MeterRecord, from: number, to: number): WindowUsage;
export function trailingSignals(content: unknown): { signal: string | null; defers: string[] };
export function signalIn(content: unknown): string | null;
export function defersIn(content: unknown): string[];
export function consumeSignal(adapter: string, id: string): { signal: string | null; defers: string[] };
export function openBuckets(record: MeterRecord): Map<number, number[]>;
export function addSample(
  buckets: Map<number, number[]>,
  at: number,
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number },
): void;
export function scanNew(record: MeterRecord, files: string[], onLine: (line: string) => void): MeterRecord;
export function commitMeter(
  adapter: string,
  id: string,
  record: MeterRecord,
  buckets: Map<number, number[]>,
  fresh: string[],
  now?: number,
): MeterRecord;

export function deferFile(adapter: string, project: string): string;
export function loadDeferred(adapter: string, project: string, now?: number): DeferredItem[];
export function addDeferred(
  adapter: string,
  project: string,
  texts: string[],
  sessionId: string,
  now?: number,
): DeferredItem[];
export function clearDeferred(adapter: string, project: string): void;
export function deferredProjects(adapter: string, now?: number): Array<{ project: string; items: DeferredItem[] }>;

export interface ClaimantPlanView {
  claimant: ClaimantRecord;
  allocation: Allocation;
  usage: WindowUsage;
  observed: number;
  state: ClaimantState;
  bucket: ClaimantBucket;
  stale: boolean;
  pressure: Pressure;
  attributedPercent: number | null;
}

export interface SessionView extends ClaimantPlanView {
  project: string;
}

export interface ProjectSettings {
  schema: number;
  project: string;
  label: string;
  share: number | null;
  priority: Priority;
  cap: number | null;
  pinned: boolean;
  parked: boolean;
  kept: boolean | null;
}

export interface ProjectView {
  project: string;
  label: string;
  settings: ProjectSettings;
  sessions: SessionView[];
  allocation: Allocation;
  observed: number;
  usage: { tokens: number; weighted: number; requests: number };
  lastSeen: number;
  bucket: ClaimantBucket;
  attributedPercent: number | null;
  pressure: Pressure;
  prompt: string;
  liveSessions: number;
}

export interface SchedulePlanView {
  adapter: string;
  key: WindowKey;
  now: number;
  quota: QuotaReading | null;
  live: QuotaWindow | null;
  bounds: { from: number; to: number; anchored: boolean };
  windowId: number;
  projects: ProjectView[];
  claimants: ClaimantPlanView[];
  unusedPool: number;
  totalWeighted: number;
  lockouts: number[];
}

export function schedule(
  adapter: string,
  now?: number,
  key?: WindowKey,
  quotaOverride?: QuotaReading | null,
  transcriptRoot?: string | null,
): SchedulePlanView;
export function seenProjects(root: string, now?: number, limit?: number): Array<{ project: string; lastSeen: number; prompt: string }>;
export function viewFor(plan: SchedulePlanView, id: string): ClaimantPlanView | null;
export function allocate(entries: AllocationEntry[]): AllocationResult;
export function pressureFor(consumedShare: number, target: number, quotaUsedPercent?: number | null): Pressure;
export const POLICIES: Record<string, Policy>;
export function policyNames(): string[];
export function policyFor(config: Config | null, project: string): Policy & { name: string };
export function stageFor(pressure: number, policy?: Policy): number;
export function actionsFor(stage: number, policy?: Policy): string[];
export function deferredAdvice(items: DeferredItem[]): string;
export function preserveText(preserve: string[]): string;
export function openingAdvice(view: AdviceView): string;
export function adviceFor(stage: number, view: AdviceView): string;
export function stageText(stage: number, view: AdviceView): string;

export function builtinThemes(): string[];
export function userThemes(): string[];
export function loadTheme(name: string): Theme;
export function truecolor(): boolean;
export function paintHead(theme: Theme, text: string, enabled?: boolean): string;
export function paint(theme: Theme, role: string, text: string, enabled?: boolean): string;
export function meterBar(theme: Theme, ratio: number, width: number, role?: string, enabled?: boolean): string;
export function pressureRole(pressure: number): string;
export function formatReset(resetsAt: number | undefined, now?: number): string;
export function formatCountdown(resetsAt: number | undefined, now?: number): string;
export const HUD_LAYOUTS: string[];
export const HUD_SEGMENTS: string[];
export const HUD_PRESETS: Record<string, string[]>;
export const HUD_PRESET_ABOUT: Record<string, string>;
export function presetSegments(name: string): string[] | null;
export function presetMatching(segments: string[]): string | null;
export const DEFAULT_HUD_SEGMENTS: string[];
export const COLUMNS: string[];
export const DEFAULT_COLUMNS: string[];
export function renderSegments(segments: string[], view: HudView, theme: Theme, enabled?: boolean): string;
export function renderHud(layout: string | string[], view: HudView, theme: Theme, enabled?: boolean): string;

export type { Allocation, AllocationResult };
