import { activeAdapters, pendingDetected } from "../adapters/index.js";
import { analyze } from "../analyze/index.js";
import { collect } from "../collect.js";
import type { Audit } from "../core/types.js";
import { renderAudit } from "../report/render.js";
import { loadRuns, previousRun, saveRun } from "../storage/store.js";
import { dim } from "../util/ansi.js";
import type { Options } from "../cli-options.js";

function progress(done: number, total: number): void {
  if (!process.stderr.isTTY || total < 12) return;
  const pct = Math.round((done / total) * 100);
  process.stderr.write(`\r${dim(`reading sessions ${pct}%`)}`);
  if (done === total) process.stderr.write("\r" + " ".repeat(24) + "\r");
}

export async function runAudit(options: Options): Promise<Audit | null> {
  if (activeAdapters().length === 0) {
    process.stdout.write(
      `\nSaveMyTokens\n\nNo Claude Code data found at ~/.claude/projects.\nRun Claude Code at least once, then try again.\n\n`,
    );
    return null;
  }

  const corpus = await collect({
    days: options.days,
    project: options.project,
    onProgress: options.json ? undefined : progress,
  });
  const audit = analyze(corpus);
  const runs = loadRuns();
  const previous = previousRun(audit, runs);

  if (options.json) {
    process.stdout.write(JSON.stringify({ audit, previous }, null, 2) + "\n");
  } else {
    process.stdout.write(renderAudit({ audit, previous, history: runs, verbose: options.verbose }));
    for (const pending of pendingDetected()) {
      process.stdout.write(dim(`${pending.label} found, but skipped: ${pending.reason}.\n`));
    }
    if (pendingDetected().length > 0) process.stdout.write("\n");
  }

  if (options.save) saveRun(audit);
  return audit;
}
