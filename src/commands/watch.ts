import { activeAdapters } from "../adapters/index.js";
import { analyze } from "../analyze/index.js";
import { collect } from "../collect.js";
import type { Audit } from "../core/types.js";
import { saveRun } from "../storage/store.js";
import { bold, dim, green, red, yellow } from "../util/ansi.js";
import { percent, plural } from "../util/fmt.js";
import type { Options } from "../cli-options.js";
import { defaultProject } from "./audit.js";

const SCORE_STEP = 2;

function clock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function line(text: string): void {
  process.stdout.write(`${dim(clock())} ${text}\n`);
}

export async function runWatch(options: Options): Promise<void> {
  if (activeAdapters().length === 0) {
    process.stdout.write(`\nSaveMyTokens\n\nNo Claude Code data found at ~/.claude/projects.\n\n`);
    return;
  }

  process.stdout.write(`\n${bold("SaveMyTokens")} ${dim("watch")}\n\n`);
  process.stdout.write(dim("Observing only. Nothing is modified, redirected, or uploaded.\n"));
  process.stdout.write(dim(`Window: last ${options.days} days${options.project ? " · this project" : ""} · checking every ${options.interval}s · Ctrl-C to stop\n\n`));

  let baseline: Audit | null = null;
  let stopping = false;

  const tick = async (): Promise<void> => {
    const corpus = await collect({ days: options.days, project: defaultProject(options) });
    const audit = analyze(corpus);

    if (!baseline) {
      baseline = audit;
      const top = audit.findings[0];
      line(
        `baseline ${bold(`${audit.score}/100`)} ${dim(`· ${audit.totals.sessions} ${plural(audit.totals.sessions, "session")} · ${audit.totals.turns} turns`)}${top ? dim(` · top: ${top.title.toLowerCase()}`) : ""}`,
      );
      if (options.save) saveRun(audit);
      return;
    }

    const previous = baseline;
    const delta = audit.score - previous.score;
    const newTurns = audit.totals.turns - previous.totals.turns;
    const knownIds = new Set(previous.findings.map((f) => f.id));
    const fresh = audit.findings.filter((f) => !knownIds.has(f.id) && f.wasteRatio >= 0.02);

    for (const finding of fresh) {
      line(`${yellow("new waste")} ${finding.title.toLowerCase()} ${dim(`· ${percent(finding.wasteRatio, 1)} of spend`)}`);
      line(dim(`          fix: ${finding.fix}`));
    }

    if (Math.abs(delta) >= SCORE_STEP) {
      const marker = delta > 0 ? green(`+${delta}`) : red(String(delta));
      line(`efficiency ${bold(`${audit.score}/100`)} ${marker} ${dim(`· ${newTurns} new turns`)}`);
    }

    if (fresh.length > 0 || Math.abs(delta) >= SCORE_STEP) {
      baseline = audit;
      if (options.save) saveRun(audit);
    }
  };

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    const audit = baseline;
    process.stdout.write(`\n${dim("stopped")} ${audit ? `· efficiency ${audit.score}/100 · run ${bold("npx savemytokens")} for the full audit` : ""}\n\n`);
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await tick();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, options.interval * 1000));
    if (stopping) return;
    try {
      await tick();
    } catch (error) {
      line(red(`scan failed: ${(error as Error).message}`));
    }
  }
}
