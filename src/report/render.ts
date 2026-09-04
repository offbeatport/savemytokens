import type { Audit, Finding, RunRecord, TaskSummary } from "../core/types.js";
import { bold, clip, dim, green, padEndVisible, padStartVisible, red, visibleWidth } from "../util/ansi.js";
import { ago, bar, compactNumber, money, percent, plural, shortDate, sparkline } from "../util/fmt.js";
import { displayHome } from "../storage/paths.js";
import { pricingNote } from "../core/pricing.js";
import type { NudgeStats } from "../commands/install.js";

const INDENT = "  ";
const BAR_WIDTH = 8;

export interface RenderInput {
  audit: Audit;
  previous: RunRecord | null;
  history?: RunRecord[];
  nudges?: NudgeStats | null;
  installed?: boolean;
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

function hanging(text: string, indent: string, marker: string, columns: number): string[] {
  const lines = wrap(text, "", columns - indent.length - visibleWidth(marker));
  return lines.map((line, index) =>
    index === 0 ? `${indent}${marker}${line}` : `${indent}${" ".repeat(visibleWidth(marker))}${line}`,
  );
}

function taskRows(tasks: TaskSummary[], columns: number, limit: number): string[] {
  const top = tasks.slice(0, limit);
  if (top.length === 0) return [];
  const max = Math.max(...top.map((t) => t.usd));
  const amounts = top.map((t) => money(t.usd));
  const projects = top.map((t) => (t.project || "").split("/").pop() || "unknown");
  const moneyWidth = Math.max(...amounts.map((a) => a.length));
  const projectWidth = Math.min(14, Math.max(...projects.map((p) => p.length)));

  return top.map((task, index) => {
    const amount = padStartVisible(amounts[index] ?? "", moneyWidth);
    const meter = padEndVisible(dim(bar(task.usd, max, BAR_WIDTH)), BAR_WIDTH);
    const project = padEndVisible((projects[index] ?? "").slice(0, projectWidth), projectWidth);
    const room = Math.max(20, columns - moneyWidth - BAR_WIDTH - projectWidth - INDENT.length - 6);
    return `${INDENT}${amount}  ${meter}  ${project}  ${clip(task.prompt, room)}`;
  });
}

function footer(audit: Audit, previous: RunRecord | null, history: RunRecord[], verbose: boolean): string[] {
  const scores = history
    .filter((run) => run.scope.days === audit.scope.days && (run.scope.project ?? null) === (audit.scope.project ?? null))
    .slice(-16)
    .map((run) => run.score);
  const spark = sparkline([...scores, audit.score]);
  const parts: string[] = [];
  if (previous) {
    const delta = audit.wasteRatio - previous.wasteRatio;
    const direction =
      delta < -0.005
        ? `${green("less waste")} than`
        : delta > 0.005
          ? `${red("more waste")} than`
          : "about the same as";
    parts.push(`${direction} ${ago(previous.ranAt)}`);
  }
  if (spark && verbose) parts.push(spark);
  return parts.length > 0 ? [dim(parts.join(" · "))] : [];
}

export function renderAudit(input: RenderInput): string {
  const { audit, previous, history = [], nudges = null, installed = false, verbose = false } = input;
  const columns = width();
  const out: string[] = [""];

  if (audit.totals.sessions === 0) {
    out.push(`No agent sessions in the last ${audit.scope.days} days.`);
    out.push(dim("Wider window: npx savemytokens --days 30"));
    out.push("");
    return out.join("\n");
  }

  const wasted = Math.min(
    audit.findings.reduce((sum, f) => sum + f.wastedUsd, 0),
    audit.totals.usd,
  );
  const scope = audit.scope.project ? (audit.scope.project.split("/").pop() ?? "") : "all projects";
  out.push(
    `${bold(money(audit.totals.usd))} in ${audit.scope.days} ${plural(audit.scope.days, "day")} · ${bold(money(wasted))} wasted  ${dim(`${scope} · ${audit.totals.tasks} tasks`)}`,
  );
  if (audit.rateLimitHits > 0) {
    out.push(dim(`hit your usage limit ${audit.rateLimitHits} ${plural(audit.rateLimitHits, "time")}`));
  }
  out.push("");

  const rows = taskRows(audit.topTasks, columns, verbose ? 5 : 3);
  if (rows.length > 0) {
    out.push(...rows);
    out.push("");
  }

  const yours = audit.findings.filter((f) => f.actor === "you");
  const claudes = audit.findings.filter((f) => f.actor === "claude");
  const shown = verbose ? yours.slice(0, 3) : yours.slice(0, 1);
  for (const finding of shown) {
    out.push(...wrap(`${bold(finding.title)}  ${bold(money(finding.wastedUsd))}`, ""));
    for (const line of finding.measured.slice(0, verbose ? 3 : 2)) {
      out.push(...hanging(line, INDENT, dim("· "), columns));
    }
    if (finding.receipts?.length) {
      out.push("");
      for (const line of finding.receipts.slice(0, verbose ? 3 : 2)) {
        out.push(`${INDENT}${dim(clip(line, columns - INDENT.length))}`);
      }
    }
    out.push("");
    out.push(...hanging(`${bold("Do this:")} ${finding.fix}`, INDENT, "", columns));
    if (verbose && finding.detail) {
      out.push("");
      for (const detail of finding.detail) out.push(`${INDENT}${dim(detail)}`);
    }
    out.push("");
  }

  const rest = yours.length - shown.length;
  if (rest > 0 && !verbose) {
    const restUsd = yours.slice(shown.length).reduce((sum, f) => sum + f.wastedUsd, 0);
    out.push(dim(`${rest} smaller ${plural(rest, "finding")} worth ${money(restUsd)} · npx savemytokens -v`));
    out.push("");
  }

  const claudeUsd = claudes.reduce((sum, f) => sum + f.wastedUsd, 0);
  if (claudes.length > 0 && !installed) {
    out.push(
      ...wrap(
        dim(
          `${money(claudeUsd)} more is how Claude works, not how you work: ${claudes.map((f) => f.title.toLowerCase()).join(", ")}. Nothing for you to do by hand; install writes the rules that fix them.`,
        ),
        "",
      ),
    );
    out.push("");
  }

  if (nudges && installed) {
    out.push(
      `${green("Since you installed:")} ${nudges.fired} ${plural(nudges.fired, "warning")}, ${money(nudges.usdAtStake)} at stake ${dim(`(${ago(nudges.installedAt)})`)}`,
    );
  } else if (!installed) {
    out.push(`${green("Do this:")}  ${bold("npx savemytokens install")}   ${dim("→ warns you before the next one, and gives each session a target share")}`);
  }

  out.push(...footer(audit, previous, history, verbose));

  if (verbose) {
    out.push("");
    out.push(dim(`Efficiency ${audit.score}/100`));
    for (const component of audit.scoreBreakdown) {
      const points = `${component.points > 0 ? "+" : ""}${component.points}`;
      out.push(dim(`${INDENT}${points.padStart(5)}  ${component.label}`));
    }
    out.push("");
    out.push(dim("Spend by project"));
    const maxProject = Math.max(...audit.projects.map((p) => p.usd), 0);
    for (const project of audit.projects.slice(0, 8)) {
      const amount = padStartVisible(money(project.usd), 7);
      const meter = padEndVisible(bar(project.usd, maxProject, BAR_WIDTH), BAR_WIDTH);
      out.push(dim(`${INDENT}${amount}  ${meter}  ${project.name} · ${project.tasks} ${plural(project.tasks, "task")}`));
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
    out.push("");
    out.push(dim(pricingNote()));
    out.push(dim(`Saved to ${displayHome()} · nothing left this machine`));
  }

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
