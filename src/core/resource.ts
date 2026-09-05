export type Unit = "observed_usage" | "token" | "usd" | "call" | "second" | "request";

export type WindowKind = "rolling" | "calendar" | "per-task" | "unbounded";

export interface Window {
  kind: WindowKind;
  ms?: number;
  resetsAt?: number;
}

export type CapacityConfidence = "published" | "measured" | "estimated" | "unknown";

export interface Capacity {
  amount: number;
  confidence: CapacityConfidence;
  asOf?: number;
  learnedFrom?: number;
}

export interface Resource {
  id: string;
  adapter: string;
  label: string;
  unit: Unit;
  window: Window;
  capacity: Capacity;
  usedPercent: number | null;
  rolledOver?: boolean;
}

export type Priority = "high" | "normal" | "low";

export type ClaimantState = "active" | "needs-more" | "done" | "blocked";

export interface Claimant {
  id: string;
  adapter: string;
  resourceId: string;
  label: string;
  project: string;
  share: number | null;
  priority: Priority;
  cap: number | null;
  state: ClaimantState;
  startedAt: number;
  lastSeen: number;
  endedAt: number | null;
  prompt: string;
  signal: string | null;
}

export interface SampleMetrics {
  tokens: number;
  weighted: number;
  requests: number;
}

export interface Sample {
  claimantId: string;
  amount: number;
  at: number;
  metrics: SampleMetrics;
}

export interface Meter {
  sample(since: number, until?: number): Promise<Sample[]>;
}

export type EnforcementLevel = "advise" | "warn" | "throttle" | "deny" | "halt";

export interface EnforcementResult {
  applied: boolean;
  message: string;
}

export interface Enforcer {
  supports: EnforcementLevel[];
  apply(claimant: Claimant, level: EnforcementLevel, reason: string): Promise<EnforcementResult>;
}

export interface Provider {
  id: string;
  label: string;
  detect(): boolean;
  resources(now?: number): Resource[];
  sweep(since: number, now?: number): void;
  meter: Meter;
  enforcer: Enforcer;
  dataDir?: string;
}

export interface Allocation {
  claimantId: string;
  target: number;
  pinned: boolean;
  pool: number;
  released: boolean;
}

export interface AllocationResult {
  targets: Map<string, Allocation>;
  unusedPool: number;
}

export type PressureBasis = "budget" | "share";

export interface Pressure {
  value: number;
  basis: PressureBasis;
}

export interface ClaimantView {
  claimant: Claimant;
  allocation: Allocation;
  observed: number;
  observedTokens: number;
  attributedPercent: number | null;
  pressure: Pressure;
  stale: boolean;
}

export interface SchedulePlan {
  generatedAt: number;
  resources: Resource[];
  primary: Resource | null;
  claimants: ClaimantView[];
  unusedPool: number;
  observedTokens: number;
  quotaAt: number | null;
  lockouts: number[];
}
