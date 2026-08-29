import type { Audit, Finding, RunRecord, TaskSummary } from "../core/types.js";
import { bold, dim, green, red, yellow } from "../util/ansi.js";
import { compactNumber, money, percent, plural, shortDate } from "../util/fmt.js";
import { displayHome } from "../storage/paths.js";

const INDENT = "   ";

function width(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(48, Math.min(columns - 2, 96));
}

export function wrap(text: string, indent: string, max = width()): string[] {
  const limit = Math.max(24, max - indent.length);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= limit) line += ` ${word}`;
    else {
      lines.push(indent + line);
      line = word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

function taskLine(task: TaskSummary, columns: number): string {
  const project = (task.project || "").split("/").pop() || "unknown";
  const head = `${money(task.usd).padStart(6)}  ${project.padEnd(14).slice(0, 14)}`;
  const room = Math.max(24, columns - head.length - 8);
  const prompt = task.prompt.length > room ? `${task.prompt.slice(0, room - 1)}…` : task.prompt;
  return `${head} ${prompt}  ${dim(`${task.turns}t`)}`;
}

function confidenceTag(finding: Finding): string {
  return finding.confidence === "measured" ? dim("measured") : dim("estimated");
}

function effortTag(finding: Finding): string {
  return finding.effort === "one-time" ? green("one-time fix") : yellow("habit");
}

function trend(audit: Audit, previous: RunRecord | null): string[] {
  if (!previous) return [dim("First run — future runs compare against this baseline.")];
  const delta = audit.score - previous.score;
  const arrow = delta > 0 ? green(`↑ ${delta}`) : delta < 0 ? red(`↓ ${delta}`) : dim("→ no change");
  return [`${dim("Previous:")} ${previous.score}/100  ${arrow} ${dim(`(${shortDate(previous.ranAt)})`)}`];
}

export function renderAudit(audit: Audit, previous: RunRecord | null, verbose: boolean): string {
  const columns = width();
  const out: string[] = ["", bold("SaveMyTokens"), ""];

  if (audit.totals.sessions === 0) {
    out.push(`No agent sessions found in the last ${audit.scope.days} days.`);
    out.push(dim("Try a wider window: npx savemytokens --days 30"));
    out.push("");
    return out.join("\n");
  }

  const wasted = audit.findings.reduce((sum, f) => sum + f.wastedUsd, 0);
  const headline = `You ran ${audit.totals.tasks} ${plural(audit.totals.tasks, "task")} worth ${bold(money(audit.totals.usd))}`;
  const lockouts =
    audit.rateLimitHits > 0
      ? ` and hit your usage limit ${bold(String(audit.rateLimitHits))} ${plural(audit.rateLimitHits, "time")}`
      : "";
  out.push(`${headline}${lockouts}.`);
  if (audit.findings.length > 0) {
    out.push(`About ${bold(money(Math.min(wasted, audit.totals.usd)))} of that bought you nothing.`);
  } else {
    out.push("Nothing measurably wasteful in this window.");
  }
  const scope = [
    `${audit.scope.days} ${plural(audit.scope.days, "day")}`,
    `${audit.totals.sessions} ${plural(audit.totals.sessions, "session")}`,
    `${compactNumber(audit.totals.freshTokens)} new tokens`,
    `${compactNumber(audit.totals.cacheReadTokens)} re-read`,
  ];
  out.push(dim(scope.join(" · ")));
  out.push("");

  if (audit.topTasks.length > 0) {
    out.push(bold("Your most expensive tasks"));
    for (const task of audit.topTasks.slice(0, 5)) out.push(`${INDENT}${taskLine(task, columns - 3)}`);
    out.push("");
  }

  const shown = audit.findings.slice(0, 3);
  shown.forEach((finding, index) => {
    out.push(
      `${index + 1}. ${bold(finding.title)}  ${bold(money(finding.wastedUsd))} ${dim("·")} ${effortTag(finding)} ${dim("·")} ${confidenceTag(finding)}`,
    );
    for (const line of finding.measured) out.push(...wrap(`${dim("·")} ${line}`, INDENT));
    if (finding.receipts && finding.receipts.length > 0) {
      out.push("");
      for (const line of finding.receipts) out.push(`${INDENT}${dim(line)}`);
    }
    out.push("");
    out.push(...wrap(`${bold("Do this:")} ${finding.fix}`, INDENT));
    if (verbose && finding.detail) {
      out.push(`${INDENT}${dim("—")}`);
      for (const detail of finding.detail) out.push(`${INDENT}${dim(detail)}`);
    }
    out.push("");
  });

  const rest = audit.findings.slice(3);
  if (rest.length > 0) {
    out.push(
      dim(`+ ${rest.length} smaller: ${rest.map((f) => `${f.title.toLowerCase()} (${money(f.wastedUsd)})`).join(", ")}`),
    );
    out.push("");
  }

  const quickest = [...audit.findings].filter((f) => f.effort === "one-time").sort((a, b) => b.wastedUsd - a.wastedUsd)[0];
  if (quickest) {
    out.push(...wrap(`${green("Start here:")} ${quickest.title.toLowerCase()} — ${money(quickest.wastedUsd)}, one config change, never think about it again.`, ""));
    out.push("");
  }

  out.push(`${bold("Efficiency:")} ${audit.score}/100`);
  out.push(...trend(audit, previous));

  if (verbose) {
    out.push("");
    out.push(dim("Spend by project"));
    for (const project of audit.projects.slice(0, 8)) {
      out.push(dim(`${INDENT}${money(project.usd).padStart(7)}  ${project.name} · ${project.tasks} ${plural(project.tasks, "task")}`));
    }
    out.push("");
    out.push(dim("Score"));
    for (const component of audit.scoreBreakdown) {
      const points = `${component.points > 0 ? "+" : ""}${component.points}`;
      out.push(dim(`${INDENT}${points.padStart(5)}  ${component.label}`));
    }
    out.push("");
    out.push(dim("Models"));
    for (const model of audit.models.slice(0, 6)) {
      out.push(
        dim(
          `${INDENT}${model.model} · ${model.turns} ${plural(model.turns, "turn")} · in ${compactNumber(model.usage.input + model.usage.cacheWrite + model.usage.cacheRead)} · out ${compactNumber(model.usage.output)}`,
        ),
      );
    }
  }

  out.push("");
  out.push(dim("Dollar figures are list-price equivalents for the tokens you actually used."));
  out.push(dim(`Saved to ${displayHome()} · nothing left this machine`));
  out.push("");
  return out.join("\n");
}

export function renderHistory(runs: RunRecord[]): string {
  if (runs.length === 0) return `\n${bold("SaveMyTokens")}\n\nNo runs recorded yet. Run: npx savemytokens\n`;
  const out: string[] = ["", bold("SaveMyTokens"), "", dim("date              score   waste   scope"), ""];
  for (const run of runs.slice(-20)) {
    const scope = `${run.scope.days}d${run.scope.project ? " · " + (run.scope.project.split("/").pop() ?? "") : ""}`;
    out.push(
      `${shortDate(run.ranAt).padEnd(17)} ${String(run.score).padStart(3)}/100  ${percent(run.wasteRatio).padStart(5)}   ${dim(scope)}`,
    );
  }
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (first && last && runs.length > 1) {
    const delta = last.score - first.score;
    out.push("");
    out.push(
      `${dim("Change since first run:")} ${delta > 0 ? green(`+${delta}`) : delta < 0 ? red(String(delta)) : dim("0")} points`,
    );
  }
  out.push("");
  return out.join("\n");
}
