import type { Audit, RunRecord } from "../core/types.js";
import { CONFIG_FILE, LAST_AUDIT_FILE, RUNS_FILE, ensureHome, readJson, writeJson } from "./paths.js";

const MAX_RUNS = 250;

export interface Config {
  version: number;
  createdAt: number;
  contribute: boolean;
}

export function loadConfig(): Config {
  return readJson<Config>(CONFIG_FILE, { version: 1, createdAt: Date.now(), contribute: false });
}

export function saveConfig(config: Config): void {
  ensureHome();
  writeJson(CONFIG_FILE, config);
}

export function loadRuns(): RunRecord[] {
  const runs = readJson<RunRecord[]>(RUNS_FILE, []);
  return Array.isArray(runs) ? runs : [];
}

export function scopeKey(audit: Pick<Audit, "scope">): string {
  return `${audit.scope.days}d:${audit.scope.project ?? "all"}`;
}

export function previousRun(audit: Audit, runs: RunRecord[]): RunRecord | null {
  const key = scopeKey(audit);
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (!run) continue;
    if (`${run.scope.days}d:${run.scope.project ?? "all"}` !== key) continue;
    if (run.ranAt >= audit.ranAt) continue;
    return run;
  }
  return null;
}

export function toRunRecord(audit: Audit): RunRecord {
  return {
    ranAt: audit.ranAt,
    score: audit.score,
    wasteRatio: audit.wasteRatio,
    upliftRatio: audit.upliftRatio,
    scope: audit.scope,
    totals: audit.totals,
    findings: audit.findings.map((f) => ({
      id: f.id,
      title: f.title,
      wasteRatio: f.wasteRatio,
      confidence: f.confidence,
    })),
  };
}

export function saveRun(audit: Audit): RunRecord[] {
  ensureHome();
  const runs = loadRuns();
  runs.push(toRunRecord(audit));
  const trimmed = runs.slice(-MAX_RUNS);
  writeJson(RUNS_FILE, trimmed);
  writeJson(LAST_AUDIT_FILE, audit);
  return trimmed;
}
