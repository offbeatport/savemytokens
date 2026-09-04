import type { ControlPlan } from "../scheduler/plan.js";
import { visibleRows, workingSet } from "../scheduler/plan.js";
import {
  formatReset,
  loadMeter,
  meterBar,
  paint,
  pressureRole,
  type ClaimantPlanView,
  type Theme,
} from "../runtime/kernel.mjs";
import { padEndVisible, padStartVisible, visibleWidth } from "../util/ansi.js";
import { ago, compactNumber } from "../util/fmt.js";
import { heatStrip, miniSpark, percentLabel, smallBar } from "./graphs.js";

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

const STATE_MARK: Record<string, string> = { active: "•", "needs-more": "+", done: "✓", blocked: "!" };
const BAR_CELLS = 10;

function clip(text: string, max: number): string {
  if (max <= 1) return "";
  return visibleWidth(text) <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function labelsFor(views: ClaimantPlanView[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const view of views) counts.set(view.claimant.label, (counts.get(view.claimant.label) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const view of views) {
    const base = view.claimant.label || view.claimant.id.slice(0, 8);
    const started = new Date(view.claimant.startedAt);
    const stamp = `${String(started.getHours()).padStart(2, "0")}:${String(started.getMinutes()).padStart(2, "0")}`;
    labels.set(view.claimant.id, (counts.get(view.claimant.label) ?? 0) > 1 ? `${base} ${stamp}` : base);
  }
  const stamped = new Map<string, number>();
  for (const label of labels.values()) stamped.set(label, (stamped.get(label) ?? 0) + 1);
  for (const [id, label] of labels) {
    if ((stamped.get(label) ?? 0) > 1) labels.set(id, `${label}·${id.slice(0, 4)}`);
  }
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
    const reset = resource.window.resetsAt ? paint(theme, "dim", `resets ${formatReset(resource.window.resetsAt, now)}`, color) : "";
    return `${paint(theme, "dim", name, color)} ${meterBar(theme, used / 100, 12, pressureRole(used / 100), color)} ${paint(theme, pressureRole(used / 100), percentLabel(used), color)} ${reset}`;
  });
  return [`  ${parts.join("    ")}`];
}

function columnWidths(context: ViewContext): { label: number; prompt: number } {
  const label = Math.min(24, Math.max(10, ...[...context.labels.values()].map((value) => value.length), 10));
  const prompt = Math.max(12, context.columns - label - 50);
  return { label, prompt };
}

function headerRow(context: ViewContext, widths: { label: number; prompt: number }): string {
  const { theme, color } = context;
  return paint(
    theme,
    "dim",
    `     ${padEndVisible("session", widths.label)} ${padStartVisible("target", 6)} ${padStartVisible("used", 5)} ${padStartVisible("share", 5)} ${padEndVisible("priority", 8)} ${padEndVisible("progress", BAR_CELLS + 2)} last prompt`,
    color,
  );
}

function row(
  view: ClaimantPlanView,
  index: number,
  context: ViewContext,
  widths: { label: number; prompt: number },
  now: number,
): string {
  const { theme, color } = context;
  const live = view.bucket === "active";
  const role = live ? pressureRole(view.pressure.value) : "dim";
  const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯", color) : " ";
  const pin = view.claimant.pinned ? paint(theme, "accent", "★", color) : " ";
  const mark = paint(
    theme,
    view.state === "blocked" ? "danger" : live ? "ok" : "dim",
    live ? STATE_MARK[view.state] ?? "•" : "·",
    color,
  );
  const label = padEndVisible(clip(context.labels.get(view.claimant.id) ?? view.claimant.label, widths.label), widths.label);
  const target = padStartVisible(live ? percentLabel(view.allocation.target * 100, 5) : paint(theme, "dim", "0%", color), 6);
  const used = padStartVisible(
    live ? paint(theme, role, percentLabel(view.attributedPercent ?? 0, 4), color) : paint(theme, "dim", "0%", color),
    5,
  );
  const share = padStartVisible(paint(theme, "dim", percentLabel(view.observed * 100, 4), color), 5);
  const priority = padEndVisible(
    live
      ? paint(theme, view.claimant.priority === "high" ? "accent" : "dim", view.claimant.priority.toUpperCase(), color)
      : paint(theme, "dim", ago(view.claimant.lastSeen, now), color),
    8,
  );
  const bar = live
    ? smallBar(view.pressure.value, BAR_CELLS, theme, color, role)
    : paint(theme, "dim", `[${".".repeat(BAR_CELLS)}]`, color);
  return `${cursor}${pin}${mark} ${label} ${target} ${used} ${share} ${priority} ${bar} ${paint(theme, "dim", clip(view.claimant.prompt || "—", widths.prompt), color)}`;
}

function sectionTitle(name: string, count: number, note: string, context: ViewContext): string {
  const { theme, color } = context;
  return `  ${paint(theme, "accent", name, color)} ${paint(theme, "dim", `${count}${note ? ` · ${note}` : ""}`, color)}`;
}

function footerNote(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const set = workingSet(control.schedule);
  const spare = Math.round(control.schedule.unusedPool * 100);
  const out = [
    `  ${paint(theme, "dim", `${set.active.length} ${set.active.length === 1 ? "session is" : "sessions are"} sharing this window${spare > 0 ? `, ${spare}% of it unclaimed` : ""}.`, color)}`,
  ];
  if (control.unattributed !== null) {
    out.push(
      `  ${paint(theme, "warn", `${Math.round(control.unattributed)}% of the window went while none of these were running`, color)} ${paint(theme, "dim", "— another machine, or claude.ai", color)}`,
    );
  }
  return out;
}

export function planRows(control: ControlPlan, context: ViewContext): string[] {
  const set = workingSet(control.schedule);
  const widths = columnWidths(context);
  const now = control.schedule.now;
  const out = [...capacityRow(control, context), "", headerRow(context, widths)];
  let index = 0;
  let printed = 0;
  const budget = context.expanded ? Number.MAX_SAFE_INTEGER : Math.max(6, context.rows - 13);

  const section = (name: string, views: ClaimantPlanView[], note: string): void => {
    if (views.length === 0) return;
    out.push("");
    out.push(sectionTitle(name, views.length, note, context));
    for (const view of views) {
      if (printed >= budget) {
        index += 1;
        continue;
      }
      out.push(row(view, index, context, widths, now));
      index += 1;
      printed += 1;
    }
  };

  section("ACTIVE", set.active, set.active.length > 0 ? "a Claude session is open — these hold a share" : "");
  section("RECENT", set.recent, "worked on today, nothing running");
  section("PARKED", set.parked, "");

  const shown = printed;
  const total = set.active.length + set.recent.length + set.parked.length + set.hidden;
  if (total > shown) {
    out.push("");
    out.push(`  ${paint(context.theme, "dim", `+${total - shown} more · m shows everything`, context.color)}`);
  }

  out.push("");
  out.push(...footerNote(control, context));
  return out;
}

export function detailRows(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const rows = visibleRows(control.schedule);
  const view = rows[Math.max(0, Math.min(context.selected, rows.length - 1))];
  if (!view) return [`  ${paint(theme, "dim", "nothing to show", color)}`];

  const record = loadMeter(control.provider.id, view.claimant.id);
  const label = context.labels.get(view.claimant.id) ?? view.claimant.label;
  const width = Math.min(46, Math.max(20, context.columns - 26));
  const strip = Math.min(66, Math.max(20, context.columns - 10));
  const from = control.schedule.bounds.from;
  const to = control.schedule.bounds.to;
  const live = view.bucket === "active";

  const out = [
    `  ${paint(theme, "accent", label, color)} ${paint(theme, "dim", `· ${view.bucket}${view.claimant.pinned ? " · pinned" : ""}${view.claimant.parked ? " · parked" : ""}${live ? ` · ${view.claimant.priority}` : ""}`, color)}`,
    `  ${paint(theme, "dim", clip(view.claimant.project || "unknown project", context.columns - 4), color)}`,
    "",
  ];

  if (live) {
    out.push(`  ${paint(theme, "dim", "target", color)} ${meterBar(theme, view.allocation.target, width, "accent", color)} ${percentLabel(view.allocation.target * 100)}`);
    out.push(
      `  ${paint(theme, "dim", "used  ", color)} ${meterBar(theme, (view.attributedPercent ?? 0) / 100, width, pressureRole(view.pressure.value), color)} ${percentLabel(view.attributedPercent ?? 0)}`,
    );
    out.push(
      `  ${paint(theme, "dim", "spent ", color)} ${smallBar(view.pressure.value, width, theme, color, pressureRole(view.pressure.value))} ${percentLabel(view.pressure.value * 100)} ${paint(theme, "dim", "of its target", color)}`,
    );
  } else {
    out.push(`  ${paint(theme, "dim", `no live session — last turn ${ago(view.claimant.lastSeen, control.schedule.now)}, holding no share`, color)}`);
  }

  out.push("");
  out.push(
    `  ${paint(theme, "dim", "measured", color)} ${percentLabel(view.observed * 100)} ${paint(theme, "dim", `of the tokens on disk · ${compactNumber(view.usage.tokens)} tokens · ${view.usage.requests} requests this window`, color)}`,
  );
  out.push(
    `  ${paint(theme, "dim", "started ", color)} ${new Date(view.claimant.startedAt).toTimeString().slice(0, 5)} ${paint(theme, "dim", `· last turn ${ago(view.claimant.lastSeen, control.schedule.now)}`, color)}`,
  );
  out.push("");
  out.push(`  ${paint(theme, "dim", "when it burned", color)}`);
  out.push(`  ${heatStrip(record.buckets, from, to, strip, theme, color)}`);
  out.push(`  ${paint(theme, "accent", miniSpark(record.buckets, from, to, strip), color)}`);
  out.push(
    `  ${paint(theme, "dim", `${new Date(from).toTimeString().slice(0, 5)}${" ".repeat(Math.max(1, strip - 11))}${new Date(to).toTimeString().slice(0, 5)}`, color)}`,
  );

  const prompts = Array.isArray(record.prompts) ? record.prompts.slice(-5).reverse() : [];
  out.push("");
  out.push(`  ${paint(theme, "dim", "recent prompts", color)}`);
  if (prompts.length === 0) out.push(`    ${paint(theme, "dim", "none captured yet", color)}`);
  for (const prompt of prompts) out.push(`    ${paint(theme, "dim", clip(prompt, context.columns - 8), color)}`);

  const deferred = control.deferred.find((group) => group.project === view.claimant.project);
  if (deferred && deferred.items.length > 0) {
    out.push("");
    out.push(`  ${paint(theme, "warn", "deferred here", color)}`);
    for (const item of deferred.items.slice(-4)) out.push(`    ${paint(theme, "dim", clip(item.text, context.columns - 8), color)}`);
  }

  if (!live) {
    out.push("");
    out.push(`  ${paint(theme, "dim", "resume it with", color)}`);
    out.push(`    ${paint(theme, "accent", clip(`cd ${view.claimant.project} && claude --resume ${view.claimant.id}`, context.columns - 8), color)}`);
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
    "    ↑↓        select a session",
    "    ⏎         open it · esc goes back",
    "    ←→        move its target share by 5 points",
    "    u         unpin the target, back to an even split",
    "    p         priority: high → normal → low",
    "    e         equalize — clear every pinned target",
    "    d b a n   mark done · blocked · active · needs-more",
    "    f x       pin a row · park it",
    "    m         show every session, not just the first screenful",
    "    P         what to preserve when the window gets tight",
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
    `    ${paint(theme, "dim", "target    the share you want it to aim for — your decision, not a measurement", color)}`,
    `    ${paint(theme, "dim", "used      how much of the whole window it has spent", color)}`,
    `    ${paint(theme, "dim", "share     its part of the tokens measured on disk", color)}`,
    `    ${paint(theme, "dim", "progress  how far through its own target it is · » means over", color)}`,
    "",
    `    ${paint(theme, "dim", "5h and 7d are Anthropic's numbers. share is measured from your transcripts.", color)}`,
    `    ${paint(theme, "dim", "used is their number split by that share, so the split between rows is ours.", color)}`,
    "",
    `    ${paint(theme, "dim", `Claude is told to wind down at ${stages}% of its target · npx savemytokens policy`, color)}`,
  ];
}
