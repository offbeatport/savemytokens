import fs from "node:fs";
import path from "node:path";
import { activeAdapters, pendingDetected } from "../adapters/index.js";
import { encodeProject } from "../adapters/claude-code/index.js";
import { analyze } from "../analyze/index.js";
import { collect } from "../collect.js";
import type { Audit } from "../core/types.js";
import { renderAudit } from "../report/render.js";
import { loadRuns, previousRun, saveRun } from "../storage/store.js";
import { dim } from "../util/ansi.js";
import type { Options } from "../cli-options.js";
import { hookInstalled, nudgeStats } from "./install.js";

function progress(done: number, total: number): void {
  if (!process.stderr.isTTY || total < 12) return;
  const pct = Math.round((done / total) * 100);
  process.stderr.write(`\r${dim(`reading sessions ${pct}%`)}`);
  if (done === total) process.stderr.write("\r" + " ".repeat(24) + "\r");
}

function hasLocalData(cwd: string): boolean {
  for (const adapter of activeAdapters()) {
    if (adapter.id !== "claude-code") continue;
    try {
      if (fs.existsSync(path.join(adapter.dataDir, encodeProject(cwd)))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function defaultProject(options: Options): string | null {
  if (options.projectExplicit) return options.project;
  const cwd = process.cwd();
  return hasLocalData(cwd) ? cwd : null;
}

export async function runAudit(options: Options): Promise<Audit | null> {
  if (activeAdapters().length === 0) {
    process.stdout.write("\nNo Claude Code or Codex data found.\nRun one of them once, then try again.\n\n");
    return null;
  }

  const project = defaultProject(options);
  const corpus = await collect({
    days: options.days,
    project,
    onProgress: options.json ? undefined : progress,
  });
  const audit = analyze(corpus);
  const runs = loadRuns();
  const previous = previousRun(audit, runs);

  if (options.json) {
    process.stdout.write(JSON.stringify({ audit, previous }, null, 2) + "\n");
  } else {
    process.stdout.write(
      renderAudit({
        audit,
        previous,
        history: runs,
        nudges: nudgeStats(),
        installed: hookInstalled(),
        verbose: options.verbose,
      }),
    );
    if (options.verbose) {
      for (const pending of pendingDetected()) {
        process.stdout.write(dim(`${pending.label} found, but skipped: ${pending.reason}.\n`));
      }
    }
  }

  if (options.save) saveRun(audit);
  return audit;
}
