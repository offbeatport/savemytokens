import type { Audit, Finding, RunRecord, TaskSummary } from "../core/types.js";
import { bold, dim, green, padEndVisible, padStartVisible, red, visibleWidth } from "../util/ansi.js";
import { bar, compactNumber, money, percent, plural, shortDate, sparkline } from "../util/fmt.js";
import { displayHome } from "../storage/paths.js";
import { pricingNote } from "../core/pricing.js";

const INDENT = "   ";
const BAR_WIDTH = 8;

export interface RenderInput {
  audit: Audit;
  previous: RunRecord | null;
  history?: RunRecord[];
  verbose?: boolean;
}

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

function clip(text: string, max: number): string {
  const visible = visibleWidth(text);
  if (visible <= max) return text;
  return `${text.slice(0, Math.max(0, text.length - (visible - max) - 1))}…`;
}

function hanging(text: string, indent: string, marker: string, columns: number): string[] {
  const lines = wrap(text, "", columns - indent.length - visibleWidth(marker));
  return lines.map((line, index) =>
    index === 0 ? `${indent}${marker}${line}` : `${indent}${" ".repeat(visibleWidth(marker))}${line}`,
  );
}

function rail(left: string, right: string, columns: number): string[] {
  const gap = columns - visibleWidth(left) - visibleWidth(right);
  if (gap >= 2) return [`${left}${" ".repeat(gap)}${right}`];
  return [left, `${INDENT}${right}`];
}

function taskRows(tasks: TaskSummary[], columns: number): string[] {
  const top = tasks.slice(0, 5);
  if (top.length === 0) return [];
  const max = Math.max(...top.map((t) => t.usd));
  const amounts = top.map((t) => money(t.usd));
  const projects = top.map((t) => (t.project || "").split("/").pop() || "unknown");
  const moneyWidth = Math.max(...amounts.map((a) => a.length));
  const projectWidth = Math.min(14, Math.max(...projects.map((p) => p.length)));
  const turnsWidth = Math.max(...top.map((t) => `${t.turns}t`.length));

  return top.map((task, index) => {
    const amount = padStartVisible(amounts[index] ?? "", moneyWidth);
    const meter = padEndVisible(dim(bar(task.usd, max, BAR_WIDTH)), BAR_WIDTH);
    const project = padEndVisible((projects[index] ?? "").slice(0, projectWidth), projectWidth);
    const turns = padStartVisible(dim(`${task.turns}t`), turnsWidth);
    const fixed = moneyWidth + BAR_WIDTH + projectWidth + turnsWidth + INDENT.length + 8;
    const room = Math.max(20, columns - fixed);
    const prompt = task.prompt.length > room ? `${task.prompt.slice(0, room - 1)}…` : task.prompt;
    return `${INDENT}${amount}  ${meter}  ${project}  ${padEndVisible(prompt, room)}  ${turns}`;
  });
}

function trendLine(audit: Audit, previous: RunRecord | null, history: RunRecord[]): string {
  const scores = history
    .filter((run) => run.scope.days === audit.scope.days && (run.scope.project ?? null) === (audit.scope.project ?? null))
    .slice(-16)
    .map((run) => run.score);
  const spark = sparkline([...scores, audit.score]);
  const head = `${bold("Efficiency:")} ${bold(`${audit.score}/100`)}`;
  if (!previous) return `${head}  ${dim("first run — this is your baseline")}`;
  const delta = audit.score - previous.score;
  const marker = delta > 0 ? green(`+${delta}`) : delta < 0 ? red(String(delta)) : dim("no change");
  const trail = spark ? `${dim(spark)}  ` : "";
  return `${head}  ${trail}${marker} ${dim(`since ${shortDate(previous.ranAt)}`)}`;
}

export function renderAudit(input: RenderInput): string {
  const { audit, previous, history = [], verbose = false } = input;
  const columns = width();
  const out: string[] = ["", bold("SaveMyTokens"), ""];

  if (audit.totals.sessions === 0) {
    out.push(`No agent sessions found in the last ${audit.scope.days} days.`);
    out.push(dim("Try a wider window: npx savemytokens --days 30"));
    out.push("");
    return out.join("\n");
  }

  const wasted = audit.findings.reduce((sum, f) => sum + f.wastedUsd, 0);
  const lockouts =
    audit.rateLimitHits > 0
      ? ` and hit your usage limit ${bold(String(audit.rateLimitHits))} ${plural(audit.rateLimitHits, "time")}`
      : "";
  out.push(
    `You ran ${audit.totals.tasks} ${plural(audit.totals.tasks, "task")} worth ${bold(money(audit.totals.usd))}${lockouts}.`,
  );
  out.push(
    audit.findings.length > 0
      ? `About ${bold(money(Math.min(wasted, audit.totals.usd)))} of that bought you nothing.`
      : "Nothing measurably wasteful in this window.",
  );
  out.push(
    dim(
      [
        `${audit.scope.days} ${plural(audit.scope.days, "day")}`,
        `${audit.totals.sessions} ${plural(audit.totals.sessions, "session")}`,
        `${compactNumber(audit.totals.freshTokens)} new tokens`,
        `${compactNumber(audit.totals.cacheReadTokens)} re-read`,
      ].join(" · "),
    ),
  );
  out.push("");

  const rows = taskRows(audit.topTasks, columns);
  if (rows.length > 0) {
    out.push(bold("Most expensive tasks"));
    out.push(...rows);
    out.push("");
  }

  audit.findings.slice(0, 3).forEach((finding, index) => {
    const meta = [
      bold(money(finding.wastedUsd)),
      finding.effort === "one-time" ? green("one-time fix") : dim("habit"),
      dim(finding.confidence),
    ].join(dim(" · "));
    out.push(...rail(`${index + 1}. ${bold(finding.title)}`, meta, columns));
    for (const line of finding.measured) out.push(...hanging(line, INDENT, dim("· "), columns));
    if (finding.receipts?.length) {
      out.push("");
      for (const line of finding.receipts) out.push(`${INDENT}${dim(clip(line, columns - INDENT.length))}`);
    }
    out.push("");
    out.push(...hanging(`${bold("Do this:")} ${finding.fix}`, INDENT, "", columns));
    if (verbose && finding.detail) {
      out.push("");
      for (const detail of finding.detail) out.push(`${INDENT}${dim(detail)}`);
    }
    out.push("");
  });

  const rest = audit.findings.slice(3);
  if (rest.length > 0) {
    out.push(
      ...wrap(dim(`+ ${rest.length} smaller: ${rest.map((f) => `${f.title.toLowerCase()} ${money(f.wastedUsd)}`).join(", ")}`), ""),
    );
    out.push("");
  }

  const quickest = audit.findings.filter((f) => f.effort === "one-time").sort((a, b) => b.wastedUsd - a.wastedUsd)[0];
  if (quickest) {
    out.push(
      ...wrap(
        `${green("Start here:")} ${quickest.title.toLowerCase()} — ${money(quickest.wastedUsd)}, one config change, then never think about it again.`,
        "",
      ),
    );
    out.push("");
  }

  out.push(trendLine(audit, previous, history));

  if (verbose) {
    out.push("");
    out.push(dim("Spend by project"));
    const maxProject = Math.max(...audit.projects.map((p) => p.usd), 0);
    for (const project of audit.projects.slice(0, 8)) {
      const amount = padStartVisible(money(project.usd), 7);
      const meter = padEndVisible(bar(project.usd, maxProject, BAR_WIDTH), BAR_WIDTH);
      out.push(dim(`${INDENT}${amount}  ${meter}  ${project.name} · ${project.tasks} ${plural(project.tasks, "task")}`));
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
      const context = model.usage.input + model.usage.cacheWrite + model.usage.cacheRead;
      out.push(
        dim(
          `${INDENT}${model.model} · ${model.turns} ${plural(model.turns, "turn")} · in ${compactNumber(context)} · out ${compactNumber(model.usage.output)}`,
        ),
      );
    }
  }

  out.push("");
  out.push(dim(pricingNote()));
  out.push(dim(`Saved to ${displayHome()} · nothing left this machine`));
  out.push("");
  return out.join("\n");
}

export function renderHistory(runs: RunRecord[]): string {
  if (runs.length === 0) return `\n${bold("SaveMyTokens")}\n\nNo runs recorded yet. Run: npx savemytokens\n`;
  const recent = runs.slice(-20);
  const out: string[] = ["", bold("SaveMyTokens"), "", dim("date               score   waste   scope"), ""];
  for (const run of recent) {
    const scope = `${run.scope.days}d${run.scope.project ? " · " + (run.scope.project.split("/").pop() ?? "") : ""}`;
    out.push(
      `${shortDate(run.ranAt).padEnd(18)} ${String(run.score).padStart(3)}/100  ${percent(run.wasteRatio).padStart(5)}   ${dim(scope)}`,
    );
  }
  const spark = sparkline(recent.map((run) => run.score));
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (spark && first && last) {
    const delta = last.score - first.score;
    const marker = delta > 0 ? green(`+${delta}`) : delta < 0 ? red(String(delta)) : dim("0");
    out.push("");
    out.push(`${dim(spark)}  ${marker} ${dim("points since the first run shown")}`);
  }
  out.push("");
  return out.join("\n");
}
