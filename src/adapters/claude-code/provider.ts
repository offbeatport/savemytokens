import path from "node:path";
import type { Claimant, EnforcementLevel, EnforcementResult, Provider, Resource, Sample } from "../../core/resource.js";
import {
  FIVE_HOUR_MS,
  WINDOW_MS,
  loadClaimants,
  loadMeter,
  loadQuota,
  liveWindow,
  sampleFiles,
  upsertClaimant,
  type WindowKey,
} from "../../runtime/kernel.mjs";
import { claudeCodeAdapter } from "./index.js";

export const ADAPTER_ID = "claude-code";

const WINDOW_LABELS: Record<WindowKey, string> = {
  five_hour: "5-hour window",
  seven_day: "7-day window",
  spend_limit: "gateway spend limit",
};

export function resourcesFor(now = Date.now()): Resource[] {
  const quota = loadQuota(ADAPTER_ID);
  const keys: WindowKey[] = ["five_hour", "seven_day"];
  if (quota?.windows?.spend_limit) keys.push("spend_limit");

  return keys.map((key) => {
    const window = liveWindow(quota, key, now);
    return {
      id: `${ADAPTER_ID}:${key}`,
      adapter: ADAPTER_ID,
      label: WINDOW_LABELS[key],
      unit: key === "spend_limit" ? "usd" : "observed_usage",
      window: { kind: "rolling", ms: WINDOW_MS[key] ?? FIVE_HOUR_MS, ...(window ? { resetsAt: window.resetsAt } : {}) },
      capacity: window
        ? { amount: 100, confidence: "published", asOf: quota?.at ?? now }
        : { amount: 0, confidence: "unknown" },
      usedPercent: window ? window.usedPercent : null,
    };
  });
}

export function sweep(since: number, now = Date.now()): void {
  const known = new Map(loadClaimants(ADAPTER_ID).map((claimant) => [claimant.id, claimant]));
  const refs = claudeCodeAdapter.discover({ since, project: null });
  const seen = new Set<string>();

  for (const ref of refs) {
    const id = path.basename(ref.file, ".jsonl");
    seen.add(id);
    const record = sampleFiles(ADAPTER_ID, id, [ref.file, ...(ref.extraFiles ?? [])], now);
    const project = record.project || "";
    const existing = known.get(id);
    const lastSeen = Math.max(record.lastAt || 0, existing?.lastSeen ?? 0, record.lastAt ? 0 : ref.mtimeMs);
    upsertClaimant(ADAPTER_ID, id, {
      project: existing?.project || project,
      label: existing?.label || (project ? path.basename(project) : id.slice(0, 8)),
      prompt: record.prompt || existing?.prompt || "",
      ...(lastSeen > 0 ? { lastSeen } : {}),
      ...(existing ? {} : { startedAt: record.buckets[0]?.[0] ?? now, state: "active" }),
    });
  }

  for (const claimant of known.values()) {
    if (seen.has(claimant.id)) continue;
    const files = Object.keys(loadMeter(ADAPTER_ID, claimant.id).files);
    if (files.length === 0) continue;
    const record = sampleFiles(ADAPTER_ID, claimant.id, files, now);
    if (record.lastAt > claimant.lastSeen) {
      upsertClaimant(ADAPTER_ID, claimant.id, { lastSeen: record.lastAt, prompt: record.prompt || claimant.prompt });
    }
  }
}

export const claudeCodeMeter = {
  async sample(since: number, until = Date.now()): Promise<Sample[]> {
    const out: Sample[] = [];
    for (const claimant of loadClaimants(ADAPTER_ID)) {
      const record = loadMeter(ADAPTER_ID, claimant.id);
      for (const row of record.buckets) {
        const at = row[0] ?? 0;
        if (at < since || at > until) continue;
        const input = row[1] ?? 0;
        const output = row[2] ?? 0;
        const cacheWrite = row[3] ?? 0;
        const cacheRead = row[4] ?? 0;
        const weighted = input + output * 5 + cacheWrite * 1.25 + cacheRead * 0.1;
        out.push({
          claimantId: claimant.id,
          amount: weighted,
          at,
          metrics: { tokens: input + output + cacheWrite + cacheRead, weighted, requests: row[5] ?? 0 },
        });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  },
};

export const claudeCodeEnforcer = {
  supports: ["advise"] as EnforcementLevel[],
  async apply(claimant: Claimant, level: EnforcementLevel, reason: string): Promise<EnforcementResult> {
    if (level !== "advise") {
      return { applied: false, message: `Claude Code supports advice only; ${level} is not available in V0.` };
    }
    return { applied: true, message: reason };
  },
};

export const claudeCodeProvider: Provider = {
  id: ADAPTER_ID,
  label: "Claude Code",
  detect: () => claudeCodeAdapter.detect(),
  resources: (now?: number) => resourcesFor(now),
  sweep,
  meter: claudeCodeMeter,
  enforcer: claudeCodeEnforcer,
};
