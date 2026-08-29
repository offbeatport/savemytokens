import type { Audit, Finding, RunRecord } from "../core/types.js";
import { bold, dim, green, red, yellow } from "../util/ansi.js";
import { compactNumber, percent, plural, shortDate } from "../util/fmt.js";
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

function wasteLine(finding: Finding): string {
  const value = percent(finding.wasteRatio, finding.wasteRatio < 0.1 ? 1 : 0);
  return finding.confidence === "measured"
    ? `Measured waste: ${value} of token spend`
    : `Estimated waste: ~${value} of token spend`;
}

function scopeLine(audit: Audit): string {
  const parts = [
    `${audit.scope.days} ${plural(audit.scope.days, "day")}`,
    `${audit.totals.sessions} ${plural(audit.totals.sessions, "session")}`,
    `${audit.totals.tasks} ${plural(audit.totals.tasks, "task")}`,
    `${compactNumber(audit.totals.freshTokens)} new tokens`,
    `${compactNumber(audit.totals.cacheReadTokens)} re-read`,
  ];
  if (audit.scope.project) parts.push(audit.scope.project.split("/").pop() ?? "");
  return parts.join(" · ");
}

function trend(audit: Audit, previous: RunRecord | null): string[] {
  if (!previous) return [dim("First run — future runs compare against this baseline.")];
  const delta = audit.score - previous.score;
  const arrow = delta > 0 ? green("↑") : delta < 0 ? red("↓") : dim("→");
  return [`${dim("Previous:")} ${previous.score}/100 ${arrow} ${dim(`(${shortDate(previous.ranAt)})`)}`];
}

export function renderAudit(audit: Audit, previous: RunRecord | null, verbose: boolean): string {
  const out: string[] = ["", bold("SaveMyTokens"), ""];

  if (audit.totals.sessions === 0) {
    out.push("No agent sessions found in the last " + audit.scope.days + " days.");
    out.push(dim("Try a wider window: npx savemytokens --days 30"));
    out.push("");
    return out.join("\n");
  }

  if (audit.findings.length === 0) {
    out.push("Nothing measurably wasteful in this window.");
    out.push("");
    out.push(`${bold("Efficiency:")} ${audit.score}/100`);
    out.push(...trend(audit, previous));
    out.push("");
    out.push(dim(scopeLine(audit)));
    out.push(dim(`Saved to ${displayHome()} · nothing left this machine`));
    out.push("");
    return out.join("\n");
  }

  const uplift = Math.round(audit.upliftRatio * 100);
  out.push(`You could get ${bold(`~${uplift}% more work`)} from the same tokens.`);
  out.push(dim(scopeLine(audit)));
  out.push("");

  audit.findings.slice(0, 3).forEach((finding, index) => {
    out.push(`${index + 1}. ${bold(finding.title)}`);
    for (const line of finding.measured) {
      out.push(...wrap(`${dim("Measured:")} ${line}`, INDENT));
    }
    out.push(`${INDENT}${yellow(wasteLine(finding))}`);
    out.push(...wrap(`Fix: ${finding.fix}`, INDENT));
    if (verbose && finding.detail) {
      out.push(`${INDENT}${dim("—")}`);
      for (const detail of finding.detail) out.push(`${INDENT}${dim(detail)}`);
    }
    out.push("");
  });

  if (audit.findings.length > 3) {
    const rest = audit.findings.slice(3);
    out.push(dim(`+ ${rest.length} smaller ${plural(rest.length, "finding")}: ${rest.map((f) => f.title.toLowerCase()).join(", ")}`));
    out.push("");
  }

  out.push(`${bold("Efficiency:")} ${audit.score}/100`);
  out.push(...trend(audit, previous));

  if (verbose) {
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
  out.push(dim(`Verified numbers come from your own session logs. Savings marked ~ are estimates.`));
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
