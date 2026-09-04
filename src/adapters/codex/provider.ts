import path from "node:path";
import type { Claimant, EnforcementLevel, EnforcementResult, Provider, Resource, Sample } from "../../core/resource.js";
import {
  FIVE_HOUR_MS,
  WINDOW_MS,
  addSample,
  commitMeter,
  liveWindow,
  loadClaimants,
  loadMeter,
  loadQuota,
  openBuckets,
  saveQuota,
  scanNew,
  upsertClaimant,
  type QuotaReading,
  type WindowKey,
} from "../../runtime/kernel.mjs";
import { codexAdapter } from "./index.js";

export const ADAPTER_ID = "codex";

const WINDOW_LABELS: Record<WindowKey, string> = {
  five_hour: "5-hour window",
  seven_day: "7-day window",
  spend_limit: "spend limit",
};

function windowKeyFor(minutes: number): WindowKey | null {
  if (minutes <= 0) return null;
  return minutes <= 24 * 60 ? "five_hour" : "seven_day";
}

function readLimits(payload: Record<string, any>, into: Record<string, { usedPercent: number; resetsAt: number }>): void {
  for (const slot of ["primary", "secondary"]) {
    const limit = payload?.rate_limits?.[slot];
    if (!limit || typeof limit.used_percent !== "number") continue;
    const key = windowKeyFor(Number(limit.window_minutes ?? 0));
    if (!key) continue;
    into[key] = { usedPercent: limit.used_percent, resetsAt: Number(limit.resets_at ?? 0) };
  }
}

export function resourcesFor(now = Date.now()): Resource[] {
  const quota = loadQuota(ADAPTER_ID);
  const keys: WindowKey[] = ["five_hour", "seven_day"];
  return keys.map((key) => {
    const window = liveWindow(quota, key, now);
    return {
      id: `${ADAPTER_ID}:${key}`,
      adapter: ADAPTER_ID,
      label: WINDOW_LABELS[key],
      unit: "observed_usage",
      window: { kind: "rolling", ms: WINDOW_MS[key] ?? FIVE_HOUR_MS, ...(window ? { resetsAt: window.resetsAt } : {}) },
      capacity: window
        ? { amount: 100, confidence: "published", asOf: quota?.at ?? now }
        : { amount: 0, confidence: "unknown" },
      usedPercent: window ? window.usedPercent : null,
    };
  });
}

export function sweep(since: number, now = Date.now()): void {
  if (!codexAdapter.detect()) return;
  const known = new Map(loadClaimants(ADAPTER_ID).map((claimant) => [claimant.id, claimant]));
  const windows: Record<string, { usedPercent: number; resetsAt: number }> = {};
  let latestLimitAt = 0;

  for (const ref of codexAdapter.discover({ since, project: null })) {
    const id = path.basename(ref.file, ".jsonl");
    const record = loadMeter(ADAPTER_ID, id);
    const buckets = openBuckets(record);
    const seen = new Set(record.seen);
    const fresh: string[] = [];

    scanNew(record, [ref.file], (line) => {
      if (line.length < 2 || line.charCodeAt(0) !== 123) return;
      const wantsUsage = line.includes('"token_count"');
      const wantsMeta = line.includes('"session_meta"');
      const wantsPrompt = line.includes('"user_message"');
      if (!wantsUsage && !wantsMeta && !wantsPrompt) return;
      let entry: Record<string, any>;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      const stamp = Number.isFinite(at) ? at : now;
      const payload = entry.payload ?? {};

      if (entry.type === "session_meta" || payload.type === "session_meta") {
        const cwd = payload.cwd ?? entry.payload?.payload?.cwd;
        if (typeof cwd === "string" && !record.project) record.project = cwd;
        return;
      }
      if (payload.type === "user_message") {
        const text = typeof payload.message === "string" ? payload.message : "";
        if (text && !text.startsWith("<")) record.prompt = text.replace(/\s+/g, " ").trim().slice(0, 120);
        return;
      }
      if (payload.type !== "token_count") return;

      if (payload.rate_limits && stamp >= latestLimitAt) {
        latestLimitAt = stamp;
        readLimits(payload, windows);
      }

      const last = payload.info?.last_token_usage;
      if (!last) return;
      const signature = `${stamp}:${last.input_tokens ?? 0}:${last.output_tokens ?? 0}:${last.cached_input_tokens ?? 0}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      fresh.push(signature);
      const cached = last.cached_input_tokens ?? 0;
      addSample(buckets, stamp, {
        input: Math.max(0, (last.input_tokens ?? 0) - cached),
        output: last.output_tokens ?? 0,
        cacheWrite: 0,
        cacheRead: cached,
      });
      if (stamp > record.lastAt) record.lastAt = stamp;
    });

    commitMeter(ADAPTER_ID, id, record, buckets, fresh, now);

    const existing = known.get(id);
    const project = record.project || "";
    upsertClaimant(ADAPTER_ID, id, {
      project: existing?.project || project,
      label: existing?.label || (project ? path.basename(project) : id.slice(-8)),
      prompt: record.prompt || existing?.prompt || "",
      ...(record.lastAt > 0 ? { lastSeen: record.lastAt } : {}),
      ...(existing ? {} : { startedAt: record.buckets[0]?.[0] ?? now, state: "active" }),
    });
  }

  if (Object.keys(windows).length > 0) {
    const previous = loadQuota(ADAPTER_ID);
    const reading: QuotaReading = {
      at: latestLimitAt || now,
      source: "rollout",
      windows,
      ...(previous?.history ? { history: previous.history } : {}),
    };
    saveQuota(ADAPTER_ID, reading);
  }
}

export const codexMeter = {
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

export const codexEnforcer = {
  supports: [] as EnforcementLevel[],
  async apply(_claimant: Claimant, level: EnforcementLevel): Promise<EnforcementResult> {
    return { applied: false, message: `Codex has no hook to inject through, so ${level} is not available.` };
  },
};

export const codexProvider: Provider = {
  id: ADAPTER_ID,
  label: "Codex",
  detect: () => codexAdapter.detect(),
  resources: (now?: number) => resourcesFor(now),
  sweep,
  meter: codexMeter,
  enforcer: codexEnforcer,
};
