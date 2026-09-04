import type { ControlPlan } from "../scheduler/plan.js";
import { visibleRows, workingSet } from "../scheduler/plan.js";
import {
  formatCountdown,
  formatReset,
  loadMeter,
  meterBar,
  paint,
  pressureRole,
  type ProjectView,
  type Theme,
} from "../runtime/kernel.mjs";
import { padEndVisible, padStartVisible, visibleWidth } from "../util/ansi.js";
import { ago, compactNumber } from "../util/fmt.js";
import { emptyBar, heatStrip, miniSpark, percentLabel, smallBar } from "./graphs.js";

export interface ViewContext {
  theme: Theme;
  color: boolean;
  columns: number;
  rows: number;
  selected: number;
  interactive: boolean;
  expanded: boolean;
  labels: Map<string, string>;
}

function stateMark(theme: Theme, bucket: string, state: string): string {
  const glyphs = theme.tui ?? {};
  if (state === "blocked") return glyphs.blocked ?? "!";
  if (bucket !== "active") return glyphs.idle ?? "·";
  if (state === "needs-more") return "+";
  if (state === "done") return glyphs.done ?? "✓";
  return glyphs.active ?? "•";
}
const TARGET_COL = 13;

function barCellsFor(columns: number): number {
  if (columns >= 130) return 18;
  if (columns >= 110) return 15;
  if (columns >= 95) return 12;
  if (columns >= 80) return 9;
  return 6;
}
const UNATTRIBUTED_FLOOR = 5;

function clip(text: string, max: number): string {
  if (max <= 1) return "";
  return visibleWidth(text) <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function labelsFor(views: ProjectView[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const view of views) labels.set(view.project, view.label);
  return labels;
}

function capacityRow(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const now = control.schedule.now;
  const published = control.resources.filter((resource) => resource.usedPercent !== null);
  if (published.length === 0) {
    return [
      `  ${paint(theme, "warn", "no published window", color)} ${paint(theme, "dim", "· install the status line and Anthropic's own numbers appear here", color)}`,
    ];
  }
  const parts = published.map((resource) => {
    const used = resource.usedPercent ?? 0;
    const key = resource.id.split(":")[1] ?? "";
    const name = key === "five_hour" ? "5h" : key === "seven_day" ? "7d" : "spend";
    const reset = resource.window.resetsAt
      ? paint(theme, "dim", `resets in ${formatCountdown(resource.window.resetsAt, now)} (${formatReset(resource.window.resetsAt, now)})`, color)
      : "";
    return `${paint(theme, "dim", name, color)} ${meterBar(theme, used / 100, 12, pressureRole(used / 100), color)} ${paint(theme, pressureRole(used / 100), percentLabel(used), color)} ${reset}`;
  });
  return [`  ${parts.join("    ")}`];
}

const COLUMN_WIDTH: Record<string, number> = {
  allocation: 10,
  used: 15,
  share: 6,
  tokens: 7,
  priority: 8,
};

function columnWidths(context: ViewContext, columns: string[]): { label: number; prompt: number; bar: number; used: number } {
  const bar = barCellsFor(context.columns);
  const usedWidth = bar + 8;
  let fixed = 3;
  for (const name of columns) {
    const width = name === "used" ? usedWidth : COLUMN_WIDTH[name];
    if (width) fixed += width + 1;
  }
  const wanted = Math.min(26, Math.max(14, ...[...context.labels.values()].map((value) => value.length + 2), 14));
  const room = Math.max(8, context.columns - fixed);
  const wantsPrompt = columns.includes("last prompt");
  const label = Math.max(8, Math.min(wanted, wantsPrompt ? Math.max(8, room - 15) : room));
  const spare = room - label - 1;
  const prompt = wantsPrompt && spare >= 14 ? spare : 0;
  return { label, prompt, bar, used: usedWidth };
}

function headerRow(context: ViewContext, widths: { label: number; prompt: number; bar: number; used: number }, columns: string[]): string {
  const { theme, color } = context;
  const cells = [`   ${padEndVisible(clip("project", widths.label), widths.label)}`];
  if (columns.includes("allocation")) cells.push(padStartVisible("allocation", 10));
  if (columns.includes("used")) cells.push(padEndVisible("used of it", widths.used));
  if (columns.includes("share")) cells.push(padStartVisible("share", 6));
  if (columns.includes("tokens")) cells.push(padStartVisible("tokens", 7));
  if (columns.includes("priority")) cells.push(padEndVisible("priority", 8));
  if (columns.includes("last prompt") && widths.prompt > 0) cells.push(clip("last prompt", widths.prompt));
  return paint(theme, "dim", cells.join(" "), color);
}

function row(
  view: ProjectView,
  index: number,
  context: ViewContext,
  widths: { label: number; prompt: number; bar: number; used: number },
  columns: string[],
): string {
  const { theme, color } = context;
  const role = pressureRole(view.pressure.value);
  const cursor =
    context.interactive && context.selected === index ? paint(theme, "accent", theme.tui?.cursor ?? "❯", color) : " ";
  const pin = view.settings.pinned ? paint(theme, "accent", theme.tui?.pin ?? "★", color) : " ";
  const sessions = view.liveSessions > 1 ? paint(theme, "dim", ` ${view.liveSessions}`, color) : "  ";
  const label = padEndVisible(clip(view.label, widths.label - 2), widths.label - 2);
  const allocation = padStartVisible(percentLabel(view.allocation.target * 100, 5), 10);
  const starved = view.allocation.target <= 0;
  const used = padEndVisible(
    starved
      ? `${emptyBar(widths.bar, theme, color)}    ${paint(theme, "dim", "—", color)}`
      : `${smallBar(view.pressure.value, widths.bar, theme, color, role)} ${padStartVisible(paint(theme, role, percentLabel(view.pressure.value * 100, 4), color), 4)}`,
    widths.used,
  );
  const share = padStartVisible(paint(theme, "dim", percentLabel(view.observed * 100, 5), color), 6);
  const tokens = padStartVisible(paint(theme, "dim", compactNumber(view.usage.tokens), color), 7);
  const priority = padEndVisible(
    paint(theme, view.settings.priority === "high" ? "accent" : "dim", view.settings.priority.toUpperCase(), color),
    8,
  );
  const cells = [`${cursor}${pin} ${label}${sessions}`];
  if (columns.includes("allocation")) cells.push(allocation);
  if (columns.includes("used")) cells.push(used);
  if (columns.includes("share")) cells.push(share);
  if (columns.includes("tokens")) cells.push(tokens);
  if (columns.includes("priority")) cells.push(priority);
  if (columns.includes("last prompt") && widths.prompt > 0) {
    cells.push(paint(theme, "dim", clip(view.prompt || "—", widths.prompt), color));
  }
  return cells.join(" ");
}

function idleHeaderRow(context: ViewContext, widths: { label: number; prompt: number; bar: number; used: number }): string {
  const { theme, color } = context;
  return paint(
    theme,
    "dim",
    `   ${padEndVisible("project", widths.label)} ${padStartVisible("last turn", 10)}  last prompt`,
    color,
  );
}

function idleRow(
  view: ProjectView,
  index: number,
  context: ViewContext,
  widths: { label: number; prompt: number; bar: number; used: number },
  now: number,
): string {
  const { theme, color } = context;
  const cursor =
    context.interactive && context.selected === index ? paint(theme, "accent", theme.tui?.cursor ?? "❯", color) : " ";
  const pin = view.settings.pinned ? paint(theme, "accent", theme.tui?.pin ?? "★", color) : " ";
  const label = padEndVisible(clip(view.label, widths.label), widths.label);
  const when = padStartVisible(ago(view.lastSeen, now), 10);
  const tag = view.settings.parked ? " parked" : "";
  const room = Math.max(10, context.columns - widths.label - 18 - tag.length);
  const prompt = clip(view.prompt || "—", room);
  return `${cursor}${pin} ${paint(theme, "dim", `${label} ${when}  ${prompt}${tag}`, color)}`;
}

function sectionTitle(name: string, count: number, context: ViewContext): string {
  const { theme, color } = context;
  return `  ${paint(theme, "accent", name, color)} ${paint(theme, "dim", String(count), color)}`;
}

function footerNote(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const set = workingSet(control.schedule, context.expanded);
  const sessions = set.active.reduce((sum, view) => sum + view.liveSessions, 0);
  const spare = Math.round(control.schedule.unusedPool * 100);
  const out = [
    `  ${paint(theme, "dim", `${set.active.length} ${set.active.length === 1 ? "project" : "projects"} sharing this window across ${sessions} ${sessions === 1 ? "session" : "sessions"}${spare > 0 ? `, ${spare}% unclaimed` : ""}.`, color)}`,
  ];
  const drift = control.unattributed ?? 0;
  if (drift >= UNATTRIBUTED_FLOOR) {
    out.push(
      `  ${paint(theme, "warn", `${Math.round(drift)}% of the window was spent outside these projects`, color)} ${paint(theme, "dim", "— claude.ai, another machine, or usage SaveMyTokens was not running for", color)}`,
    );
  }
  return out;
}

export function planRows(control: ControlPlan, context: ViewContext): string[] {
  const set = workingSet(control.schedule, context.expanded);
  const columns = control.config.columns ?? [];
  const widths = columnWidths(context, columns);
  const now = control.schedule.now;
  const out = [...capacityRow(control, context)];
  let index = 0;
  let printed = 0;
  const budget = context.expanded ? Number.MAX_SAFE_INTEGER : Math.max(6, context.rows - 13);

  const section = (name: string, views: ProjectView[], idle: boolean): void => {
    if (views.length === 0) return;
    out.push("");
    out.push(sectionTitle(name, views.length, context));
    out.push(idle ? idleHeaderRow(context, widths) : headerRow(context, widths, columns));
    for (const view of views) {
      if (printed >= budget) {
        index += 1;
        continue;
      }
      out.push(idle ? idleRow(view, index, context, widths, now) : row(view, index, context, widths, columns));
      index += 1;
      printed += 1;
    }
  };

  section("ACTIVE", set.active, false);
  section("RECENT", [...set.recent, ...set.parked], true);

  const total = set.active.length + set.recent.length + set.parked.length + set.hidden;
  if (total > printed) {
    out.push("");
    out.push(`  ${paint(context.theme, "dim", `+${total - printed} more`, context.color)}`);
  }

  out.push("");
  out.push(...footerNote(control, context));
  return out;
}

export function detailRows(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const rows = visibleRows(control.schedule, context.expanded);
  const view = rows[Math.max(0, Math.min(context.selected, rows.length - 1))];
  if (!view) return [`  ${paint(theme, "dim", "nothing to show", color)}`];

  const width = Math.min(46, Math.max(20, context.columns - 26));
  const strip = Math.min(66, Math.max(20, context.columns - 10));
  const from = control.schedule.bounds.from;
  const to = control.schedule.bounds.to;
  const live = view.bucket === "active";
  const buckets = view.sessions.flatMap((session) => loadMeter(control.provider.id, session.claimant.id).buckets);

  const out = [
    `  ${paint(theme, "accent", view.label, color)} ${paint(theme, "dim", `· ${view.bucket}${view.settings.pinned ? " · pinned" : ""}${view.settings.parked ? " · parked" : ""} · ${view.settings.priority}`, color)}`,
    `  ${paint(theme, "dim", clip(view.project, context.columns - 4), color)}`,
    "",
  ];

  if (live) {
    out.push(`  ${paint(theme, "dim", "allocation", color)} ${meterBar(theme, view.allocation.target, width, "accent", color)} ${percentLabel(view.allocation.target * 100)}`);
    out.push(
      `  ${paint(theme, "dim", "used of it", color)} ${smallBar(view.pressure.value, width, theme, color, pressureRole(view.pressure.value))} ${percentLabel(view.pressure.value * 100)}`,
    );
  } else {
    out.push(`  ${paint(theme, "dim", `nothing running — last turn ${ago(view.lastSeen, control.schedule.now)}, holding no allocation`, color)}`);
  }

  out.push("");
  out.push(
    `  ${paint(theme, "dim", "of the window", color)} ${percentLabel(view.attributedPercent ?? 0)} ${paint(theme, "dim", `· ${percentLabel(view.observed * 100)} of measured tokens · ${compactNumber(view.usage.tokens)} tokens · ${view.usage.requests} requests`, color)}`,
  );
  out.push("");
  out.push(`  ${paint(theme, "dim", "when it burned", color)}`);
  out.push(`  ${heatStrip(buckets, from, to, strip, theme, color)}`);
  out.push(`  ${paint(theme, "accent", miniSpark(buckets, from, to, strip), color)}`);
  out.push(
    `  ${paint(theme, "dim", `${new Date(from).toTimeString().slice(0, 5)}${" ".repeat(Math.max(1, strip - 11))}${new Date(to).toTimeString().slice(0, 5)}`, color)}`,
  );

  out.push("");
  out.push(`  ${paint(theme, "accent", `SESSIONS ${view.sessions.length}`, color)}`);
  for (const session of view.sessions.slice(0, 8)) {
    const alive = session.bucket === "active";
    const mark = paint(theme, alive ? "ok" : "dim", alive ? "•" : "·", color);
    const when = alive
      ? paint(theme, "dim", `${percentLabel(session.allocation.target * 100)} of the window`, color)
      : paint(theme, "dim", ago(session.claimant.lastSeen, control.schedule.now), color);
    out.push(
      `    ${mark} ${padEndVisible(session.claimant.id.slice(0, 8), 9)} ${padEndVisible(when, 18)} ${paint(theme, "dim", clip(session.claimant.prompt || "—", context.columns - 36), color)}`,
    );
    if (!alive) {
      out.push(`      ${paint(theme, "dim", clip(`claude --resume ${session.claimant.id}`, context.columns - 8), color)}`);
    }
  }

  const deferred = control.deferred.find((group) => group.project === view.project);
  if (deferred && deferred.items.length > 0) {
    out.push("");
    out.push(`  ${paint(theme, "warn", "deferred here", color)}`);
    for (const item of deferred.items.slice(-4)) out.push(`    ${paint(theme, "dim", clip(item.text, context.columns - 8), color)}`);
  }

  return out;
}

export function helpOverlay(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const policy = control.config.policy;
  const stages = policy === "strict" ? "35/60/80" : policy === "relaxed" ? "80/95" : "50/80/90";
  return [
    `  ${paint(theme, "accent", "keys", color)}`,
    "",
    "    ↑↓        select a project",
    "    ⏎         open it, and see its sessions · esc goes back",
    "    ←→        move its allocation by 5 points",
    "    u         unpin the target, back to an even split",
    "    p         priority: high → normal → low",
    "    e         equalize — clear every pinned target",
    "    d b a n   mark done · blocked · active · needs-more",
    "    f x       pin a row · park it",
    "    m         show every session, not just the first screenful",
    "    P         settings: columns, palette, status line, what to preserve",
    "    r ? q     refresh · this help · quit",
    "",
    `  ${paint(theme, "accent", "the working set", color)}`,
    "",
    `    ${paint(theme, "dim", "ACTIVE   a Claude session is open right now — only these get a share", color)}`,
    `    ${paint(theme, "dim", "RECENT   worked on in the last day, nothing running", color)}`,
    `    ${paint(theme, "dim", "PARKED   older, or parked by hand", color)}`,
    "",
    `  ${paint(theme, "accent", "the columns", color)}`,
    "",
    `    ${paint(theme, "dim", "allocation  how much of the window you want this project to get", color)}`,
    `    ${paint(theme, "dim", "used of it  how much of that allocation it has spent · » means over", color)}`,
    `    ${paint(theme, "dim", "a project's allocation is split across its live sessions by what they burn", color)}`,
    "",
    `    ${paint(theme, "dim", "5h and 7d are Anthropic's numbers. share is measured from your transcripts.", color)}`,
    `    ${paint(theme, "dim", "\"spent outside these sessions\" is window that moved while none of them had a turn:", color)}`,
    `    ${paint(theme, "dim", "claude.ai or another machine, or work done before SaveMyTokens was watching.", color)}`,
    `    ${paint(theme, "dim", "used is their number split by that share, so the split between rows is ours.", color)}`,
    "",
    `    ${paint(theme, "dim", `Claude is told to wind down at ${stages}% of its target · npx savemytokens policy`, color)}`,
  ];
}
