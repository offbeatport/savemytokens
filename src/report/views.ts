import type { ControlPlan } from "../scheduler/plan.js";
import { activeViews } from "../scheduler/plan.js";
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
import { burnChart, dualBar, heatStrip, miniSpark, percentLabel, projection, verdict, type Series } from "./graph.js";

export interface ViewContext {
  theme: Theme;
  color: boolean;
  columns: number;
  rows: number;
  selected: number;
  interactive: boolean;
  labels: Map<string, string>;
}

export interface View {
  name: string;
  title: string;
  render(control: ControlPlan, context: ViewContext): string[];
}

const STATE_MARK: Record<string, string> = { active: "•", "needs-more": "+", done: "✓", blocked: "!" };

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

function seriesFor(control: ControlPlan): Series {
  const history = control.schedule.quota?.history ?? [];
  const key = control.schedule.key === "seven_day" ? "seven_day" : "five_hour";
  const points = history
    .filter((point) => typeof point[key] === "number")
    .map((point) => ({ at: point.at, value: point[key] as number }));
  const live = control.schedule.live;
  if (live && points.length > 0) {
    const last = points[points.length - 1];
    if (!last || last.value !== live.usedPercent) points.push({ at: control.schedule.now, value: live.usedPercent });
  }
  return { points, from: control.schedule.bounds.from, to: control.schedule.bounds.to };
}

function capacityRows(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const now = control.schedule.now;
  const published = control.resources.filter((resource) => resource.usedPercent !== null);
  if (published.length === 0) {
    return [
      `  ${paint(theme, "warn", "no published window", color)} ${paint(theme, "dim", control.provider.id === "claude-code" ? "· install the status line to read it" : "· no rate limit written to disk yet", color)}`,
    ];
  }
  return published.map((resource) => {
    const used = resource.usedPercent ?? 0;
    const key = resource.id.split(":")[1] ?? "";
    const name = key === "five_hour" ? "5h" : key === "seven_day" ? "7d" : "spend";
    const reset = resource.window.resetsAt ? `resets ${formatReset(resource.window.resetsAt, now)}` : "";
    return `  ${padEndVisible(name, 5)} ${meterBar(theme, used / 100, 12, pressureRole(used / 100), color)} ${percentLabel(used)} ${paint(theme, "dim", reset, color)}`;
  });
}

function tableRows(control: ControlPlan, context: ViewContext, limit: number): string[] {
  const { theme, color, labels, selected } = context;
  const views = activeViews(control.schedule).slice(0, limit);
  const attributed = control.schedule.live !== null;
  const labelWidth = Math.min(24, Math.max(9, ...[...labels.values()].map((label) => label.length)));
  const promptWidth = Math.max(12, context.columns - labelWidth - (attributed ? 40 : 32));
  const out: string[] = [
    paint(
      theme,
      "dim",
      `    ${padEndVisible("session", labelWidth)} ${padStartVisible("target", 6)}${attributed ? ` ${padStartVisible("used", 6)}` : ""}  ${padStartVisible("share", 6)}  ${padEndVisible("priority", 8)} last prompt`,
      color,
    ),
  ];

  for (const [index, view] of views.entries()) {
    const running = view.state === "active" || view.state === "needs-more";
    const role = running ? pressureRole(view.pressure.value) : "dim";
    const cursor = context.interactive && selected === index ? paint(theme, "accent", "❯ ", color) : "  ";
    const mark = paint(theme, view.state === "blocked" ? "danger" : running ? "ok" : "dim", STATE_MARK[view.state] ?? "•", color);
    const label = padEndVisible(clip(labels.get(view.claimant.id) ?? view.claimant.label, labelWidth), labelWidth);
    const pinned = view.allocation.pinned ? paint(theme, "dim", "*", color) : " ";
    const target = padStartVisible(percentLabel(view.allocation.target * 100, 5), 6);
    const used = attributed ? padStartVisible(paint(theme, role, percentLabel(view.attributedPercent ?? 0, 5), color), 6) : "";
    const share = padStartVisible(paint(theme, attributed ? "dim" : role, percentLabel(view.observed * 100, 5), color), 6);
    const priority = padEndVisible(
      paint(theme, view.claimant.priority === "high" ? "accent" : "dim", view.claimant.priority.toUpperCase(), color),
      8,
    );
    out.push(`${cursor}${mark} ${label} ${target}${pinned}${used}  ${share}  ${priority} ${paint(theme, "dim", clip(view.claimant.prompt || "—", promptWidth), color)}`);
  }
  return out;
}

function statusLine(control: ControlPlan, context: ViewContext): string {
  const { theme, color } = context;
  const spare = control.schedule.unusedPool;
  const parts = [
    `${paint(theme, "dim", "spare", color)} ${paint(theme, spare > 0.01 ? "warn" : "dim", percentLabel(spare * 100), color)}`,
    paint(theme, "dim", `policy ${control.config.policyFor?.[process.cwd()] ?? control.config.policy}`, color),
    paint(theme, "dim", control.enforcement.length > 0 ? `${control.enforcement.join("/")} only` : "visibility only", color),
  ];
  if (control.unattributed !== null) {
    parts.push(paint(theme, "warn", `${percentLabel(control.unattributed)} unattributed`, color));
  }
  if (control.deferred.length > 0) {
    const count = control.deferred.reduce((sum, group) => sum + group.items.length, 0);
    parts.push(paint(theme, "dim", `${count} deferred`, color));
  }
  return `  ${parts.join(paint(theme, "dim", "  ·  ", color))}`;
}

const planView: View = {
  name: "plan",
  title: "plan",
  render(control, context) {
    return [...capacityRows(control, context), "", ...tableRows(control, context, 12), "", statusLine(control, context)];
  },
};

const burnView: View = {
  name: "burn",
  title: "burn",
  render(control, context) {
    const series = seriesFor(control);
    const height = Math.max(5, Math.min(12, context.rows - 14));
    const out: string[] = [];
    if (series.points.length === 0) {
      out.push(`  ${paint(context.theme, "dim", "no published readings yet — open a Claude session with the status line installed", context.color)}`);
    } else {
      out.push(...burnChart(series, control.schedule.now, context.columns - 4, height, context.theme, context.color));
      out.push("");
      out.push(`  ${verdict(series, control.schedule.now, context.theme, context.color)}`);
    }
    out.push("");
    out.push(...tableRows(control, context, Math.max(3, context.rows - height - 14)));
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const focusView: View = {
  name: "focus",
  title: "focus",
  render(control, context) {
    const { theme, color } = context;
    const views = activeViews(control.schedule);
    const view = views[Math.max(0, Math.min(context.selected, views.length - 1))];
    if (!view) return [`  ${paint(theme, "dim", "nothing running", color)}`];
    const label = context.labels.get(view.claimant.id) ?? view.claimant.label;
    const width = Math.min(48, context.columns - 12);
    const out = [
      `  ${paint(theme, "accent", label, color)} ${paint(theme, "dim", `· ${view.state}${view.allocation.pinned ? " · pinned" : ""} · ${view.claimant.priority}`, color)}`,
      "",
      `  ${paint(theme, "dim", "target ", color)} ${meterBar(theme, view.allocation.target, width, "accent", color)} ${percentLabel(view.allocation.target * 100)}`,
      `  ${paint(theme, "dim", "used   ", color)} ${meterBar(theme, (view.attributedPercent ?? 0) / 100, width, pressureRole(view.pressure.value), color)} ${percentLabel(view.attributedPercent ?? 0)}`,
      `  ${paint(theme, "dim", "share  ", color)} ${meterBar(theme, view.observed, width, "dim", color)} ${percentLabel(view.observed * 100)}`,
      "",
      `  ${paint(theme, "dim", "of its target share spent:", color)} ${paint(theme, pressureRole(view.pressure.value), percentLabel(view.pressure.value * 100), color)} ${paint(theme, "dim", `(${view.pressure.basis} basis)`, color)}`,
      `  ${paint(theme, "dim", "tokens this window:", color)} ${compactNumber(view.usage.tokens)} ${paint(theme, "dim", `· ${view.usage.requests} requests · last seen ${ago(view.claimant.lastSeen, control.schedule.now)}`, color)}`,
      "",
      `  ${paint(theme, "dim", "activity", color)} ${heatStrip(loadMeter(control.provider.id, view.claimant.id).buckets, control.schedule.bounds.from, control.schedule.bounds.to, Math.min(60, context.columns - 14), theme, color)}`,
      "",
      `  ${paint(theme, "dim", clip(view.claimant.prompt || "—", context.columns - 6), color)}`,
    ];
    const deferred = control.deferred.find((group) => group.project === view.claimant.project);
    if (deferred) {
      out.push("");
      out.push(`  ${paint(theme, "warn", "deferred here", color)}`);
      for (const item of deferred.items.slice(-4)) out.push(`    ${paint(theme, "dim", clip(item.text, context.columns - 8), color)}`);
    }
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const barsView: View = {
  name: "bars",
  title: "bars",
  render(control, context) {
    const { theme, color, labels } = context;
    const views = activeViews(control.schedule);
    const labelWidth = Math.min(24, Math.max(9, ...[...labels.values()].map((label) => label.length)));
    const barWidth = Math.max(16, context.columns - labelWidth - 26);
    const out = [...capacityRows(control, context), ""];
    out.push(paint(theme, "dim", `  ${" ".repeat(labelWidth)}  used against target ${paint(theme, "accent", "┃", color)}`, color));
    for (const [index, view] of views.entries()) {
      const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯", color) : " ";
      const label = padEndVisible(clip(labels.get(view.claimant.id) ?? view.claimant.label, labelWidth), labelWidth);
      const used = control.schedule.live ? (view.attributedPercent ?? 0) / 100 : view.observed;
      out.push(
        `${cursor} ${label} ${dualBar(view.allocation.target, used, barWidth, theme, color)} ${percentLabel(used * 100)} ${paint(theme, "dim", `/ ${percentLabel(view.allocation.target * 100)}`, color)}`,
      );
    }
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const cardsView: View = {
  name: "cards",
  title: "cards",
  render(control, context) {
    const { theme, color } = context;
    const views = activeViews(control.schedule).slice(0, Math.max(2, Math.floor((context.rows - 10) / 4)));
    const width = Math.min(74, context.columns - 4);
    const out: string[] = [];
    for (const [index, view] of views.entries()) {
      const chosen = context.interactive && context.selected === index;
      const edge = chosen ? "accent" : "dim";
      const label = context.labels.get(view.claimant.id) ?? view.claimant.label;
      const used = control.schedule.live ? (view.attributedPercent ?? 0) : view.observed * 100;
      const edgeH = theme.border.h ?? "─";
      const edgeV = theme.border.v ?? "│";
      const head = ` ${label} · ${view.claimant.priority.toUpperCase()} · ${view.state} `;
      out.push(paint(theme, edge, `${theme.border.tl ?? "┌"}${head}${edgeH.repeat(Math.max(0, width - head.length - 2))}${theme.border.tr ?? "┐"}`, color));
      out.push(
        `${paint(theme, edge, edgeV, color)} ${meterBar(theme, used / 100, 24, pressureRole(view.pressure.value), color)} ${percentLabel(used)} ${paint(theme, "dim", `of window · target ${percentLabel(view.allocation.target * 100)} · ${compactNumber(view.usage.tokens)} tok`, color)}`.padEnd(width + 40) + paint(theme, edge, edgeV, color),
      );
      out.push(
        `${paint(theme, edge, edgeV, color)} ${paint(theme, "dim", clip(view.claimant.prompt || "—", width - 4), color)}`.padEnd(width + 20) + paint(theme, edge, edgeV, color),
      );
      out.push(paint(theme, edge, `${theme.border.bl ?? "└"}${edgeH.repeat(Math.max(0, width - 2))}${theme.border.br ?? "┘"}`, color));
    }
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const sparkView: View = {
  name: "spark",
  title: "spark",
  render(control, context) {
    const { theme, color, labels } = context;
    const views = activeViews(control.schedule);
    const labelWidth = Math.min(24, Math.max(9, ...[...labels.values()].map((label) => label.length)));
    const width = Math.max(20, context.columns - labelWidth - 24);
    const out = [...capacityRows(control, context), ""];
    out.push(paint(theme, "dim", `  ${" ".repeat(labelWidth)}  tokens per slice of this window`, color));
    for (const [index, view] of views.entries()) {
      const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯", color) : " ";
      const label = padEndVisible(clip(labels.get(view.claimant.id) ?? view.claimant.label, labelWidth), labelWidth);
      const record = loadMeter(control.provider.id, view.claimant.id);
      const spark = miniSpark(record.buckets, control.schedule.bounds.from, control.schedule.bounds.to, width);
      out.push(
        `${cursor} ${label} ${paint(theme, pressureRole(view.pressure.value), spark, color)} ${paint(theme, "dim", compactNumber(view.usage.tokens), color)}`,
      );
    }
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const timelineView: View = {
  name: "timeline",
  title: "timeline",
  render(control, context) {
    const { theme, color, labels } = context;
    const views = activeViews(control.schedule);
    const labelWidth = Math.min(24, Math.max(9, ...[...labels.values()].map((label) => label.length)));
    const width = Math.max(24, context.columns - labelWidth - 16);
    const from = control.schedule.bounds.from;
    const to = control.schedule.bounds.to;
    const out = [...capacityRows(control, context), ""];
    for (const [index, view] of views.entries()) {
      const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯", color) : " ";
      const label = padEndVisible(clip(labels.get(view.claimant.id) ?? view.claimant.label, labelWidth), labelWidth);
      const record = loadMeter(control.provider.id, view.claimant.id);
      out.push(`${cursor} ${label} ${heatStrip(record.buckets, from, to, width, theme, color)}`);
    }
    const start = new Date(from);
    const end = new Date(to);
    const stamp = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    out.push(
      `  ${" ".repeat(labelWidth)} ${paint(theme, "dim", `${stamp(start)}${" ".repeat(Math.max(1, width - 11))}${stamp(end)}`, color)}`,
    );
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

const minimalView: View = {
  name: "minimal",
  title: "minimal",
  render(control, context) {
    const { theme, color } = context;
    const live = control.schedule.live;
    const views = activeViews(control.schedule).slice(0, 4);
    const out = [
      live
        ? `  ${paint(theme, pressureRole(live.usedPercent / 100), percentLabel(live.usedPercent), color)} ${paint(theme, "dim", `of the window · resets ${formatReset(live.resetsAt, control.schedule.now)}`, color)}`
        : `  ${paint(theme, "dim", "no published window", color)}`,
      "",
    ];
    for (const view of views) {
      out.push(
        `  ${padEndVisible(clip(context.labels.get(view.claimant.id) ?? view.claimant.label, 20), 20)} ${paint(theme, pressureRole(view.pressure.value), percentLabel((view.attributedPercent ?? view.observed * 100)), color)} ${paint(theme, "dim", `/ ${percentLabel(view.allocation.target * 100)}`, color)}`,
      );
    }
    return out;
  },
};

const splitView: View = {
  name: "split",
  title: "split",
  render(control, context) {
    const series = seriesFor(control);
    const height = Math.max(4, Math.min(8, Math.floor((context.rows - 16) / 2)));
    const out: string[] = [];
    if (series.points.length > 0) {
      out.push(...burnChart(series, control.schedule.now, context.columns - 4, height, context.theme, context.color));
      out.push(`  ${verdict(series, control.schedule.now, context.theme, context.color)}`);
      out.push("");
    }
    out.push(...cardsView.render(control, { ...context, rows: context.rows - height - 4 }));
    return out;
  },
};

const debugView: View = {
  name: "debug",
  title: "debug",
  render(control, context) {
    const { theme, color } = context;
    const out = [
      paint(theme, "dim", `  adapter ${control.provider.id} · window ${control.schedule.key} · anchored ${control.schedule.bounds.anchored}`, color),
      paint(theme, "dim", `  from ${new Date(control.schedule.bounds.from).toISOString()} to ${new Date(control.schedule.bounds.to).toISOString()}`, color),
      paint(theme, "dim", `  quota read ${control.schedule.quota ? ago(control.schedule.quota.at, control.schedule.now) : "never"} · history ${control.schedule.quota?.history?.length ?? 0} points`, color),
      paint(theme, "dim", `  weighted total ${Math.round(control.schedule.totalWeighted)} · claimants ${control.schedule.claimants.length} · lockouts ${control.schedule.lockouts.length}`, color),
      "",
      paint(theme, "dim", `  ${padEndVisible("id", 10)} ${padEndVisible("state", 11)} ${padStartVisible("target", 7)} ${padStartVisible("used", 6)} ${padStartVisible("share", 6)} ${padStartVisible("press", 6)} ${padStartVisible("tokens", 10)}`, color),
    ];
    for (const view of control.schedule.claimants) {
      out.push(
        `  ${padEndVisible(view.claimant.id.slice(0, 8), 10)} ${padEndVisible(view.state, 11)} ${padStartVisible(view.allocation.target.toFixed(3), 7)} ${padStartVisible((view.attributedPercent ?? 0).toFixed(1), 6)} ${padStartVisible((view.observed * 100).toFixed(1), 6)} ${padStartVisible(view.pressure.value.toFixed(2), 6)} ${padStartVisible(String(view.usage.tokens), 10)}`,
      );
    }
    return out;
  },
};

const proportionView: View = {
  name: "proportion",
  title: "proportion",
  render(control, context) {
    const { theme, color } = context;
    const views = activeViews(control.schedule);
    const width = Math.max(20, context.columns - 8);
    const total = views.reduce((sum, view) => sum + view.observed, 0) || 1;
    const roles = ["accent", "ok", "warn", "danger", "dim"];
    let bar = "";
    for (const [index, view] of views.entries()) {
      const cells = Math.round((view.observed / total) * width);
      bar += paint(theme, roles[index % roles.length] ?? "dim", "█".repeat(cells), color);
    }
    const out = [...capacityRows(control, context), "", `  ${bar}`, ""];
    for (const [index, view] of views.entries()) {
      const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯", color) : " ";
      out.push(
        `${cursor} ${paint(theme, roles[index % roles.length] ?? "dim", "█", color)} ${padEndVisible(clip(context.labels.get(view.claimant.id) ?? view.claimant.label, 22), 22)} ${percentLabel(view.observed * 100)} ${paint(theme, "dim", `of measured usage · target ${percentLabel(view.allocation.target * 100)}`, color)}`,
      );
    }
    out.push("");
    out.push(statusLine(control, context));
    return out;
  },
};

export const VIEWS: View[] = [
  planView,
  minimalView,
  burnView,
  barsView,
  focusView,
  cardsView,
  sparkView,
  timelineView,
  proportionView,
  splitView,
  debugView,
];

export function viewByName(name: string): View {
  return VIEWS.find((view) => view.name === name) ?? VIEWS[0]!;
}

export function helpOverlay(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const out = [
    `  ${paint(theme, "accent", "keys", color)}`,
    "",
    "    ↑↓        select a session",
    "    ←→        move its target share by 5 points",
    "    u         unpin it, back to an even split",
    "    p         priority: high → normal → low",
    "    e         equalize — clear every pin",
    "    d b a n   mark done · blocked · active · needs-more",
    "    v / 1-9 0 switch view",
    "    P         what to preserve, and your own line of advice",
    "    r         refresh now      ?  this help      q  quit",
    "",
    `  ${paint(theme, "accent", "what the numbers mean", color)}`,
    "",
    `    ${paint(theme, "dim", "5h / 7d    published by Anthropic, captured from the status line payload", color)}`,
    `    ${paint(theme, "dim", "share      measured from your transcripts, weighted input 1 · write 1.25 · read 0.1 · output 5", color)}`,
    `    ${paint(theme, "dim", "used       published % × that share — the total is theirs, the split between sessions is ours", color)}`,
    `    ${paint(theme, "dim", "target     what you asked this session to aim for; a decision, not a measurement", color)}`,
    `    ${paint(theme, "dim", "spare      window nobody has claimed", color)}`,
    "",
    `    ${paint(theme, "dim", `enforcement: ${control.enforcement.length > 0 ? control.enforcement.join(", ") : "none"} — a hook injects text, nothing here holds a session to a number`, color)}`,
    `    ${paint(theme, "dim", "usage from another machine or claude.ai lands inside these shares", color)}`,
  ];
  return out;
}
