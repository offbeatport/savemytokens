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
import { compactNumber } from "../util/fmt.js";
import {
  asciiBar,
  bigRows,
  blockBar,
  brailleRows,
  columnRows,
  gaugeRows,
  heatRows,
  markerBar,
  paceRows,
  percentLabel,
  runwayRows,
  segmentRows,
  sparkRow,
  stackRows,
  twinBar,
  type Series,
  type Slice,
} from "./graphs.js";

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
  if (live) {
    const last = points[points.length - 1];
    if (!last || last.value !== live.usedPercent) points.push({ at: control.schedule.now, value: live.usedPercent });
  }
  return { points, from: control.schedule.bounds.from, to: control.schedule.bounds.to };
}

function allBuckets(control: ControlPlan): number[][] {
  const out: number[][] = [];
  for (const view of control.schedule.claimants) out.push(...loadMeter(control.provider.id, view.claimant.id).buckets);
  return out;
}

function slicesFor(control: ControlPlan, context: ViewContext, limit = 5): Slice[] {
  return activeViews(control.schedule)
    .slice(0, limit)
    .map((view) => ({
      label: context.labels.get(view.claimant.id) ?? view.claimant.label,
      buckets: loadMeter(control.provider.id, view.claimant.id).buckets,
    }));
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

function labelWidthFor(context: ViewContext): number {
  return Math.min(24, Math.max(9, ...[...context.labels.values()].map((label) => label.length), 9));
}

function tableRows(control: ControlPlan, context: ViewContext, limit: number): string[] {
  const { theme, color, labels, selected } = context;
  const views = activeViews(control.schedule).slice(0, limit);
  const attributed = control.schedule.live !== null;
  const labelWidth = labelWidthFor(context);
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
    out.push(
      `${cursor}${mark} ${label} ${target}${pinned}${used}  ${share}  ${priority} ${paint(theme, "dim", clip(view.claimant.prompt || "—", promptWidth), color)}`,
    );
  }
  return out;
}

function statusRow(control: ControlPlan, context: ViewContext): string {
  const { theme, color } = context;
  const spare = control.schedule.unusedPool;
  const parts = [
    `${paint(theme, "dim", "spare", color)} ${paint(theme, spare > 0.01 ? "warn" : "dim", percentLabel(spare * 100), color)}`,
    paint(theme, "dim", `policy ${control.config.policyFor?.[process.cwd()] ?? control.config.policy}`, color),
    paint(theme, "dim", control.enforcement.length > 0 ? `${control.enforcement.join("/")} only` : "visibility only", color),
  ];
  if (control.unattributed !== null) parts.push(paint(theme, "warn", `${percentLabel(control.unattributed)} unattributed`, color));
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
    return [...capacityRows(control, context), "", ...tableRows(control, context, 14), "", statusRow(control, context)];
  },
};

interface GraphSpec {
  name: string;
  title: string;
  needsSeries: boolean;
  render(control: ControlPlan, context: ViewContext, series: Series): string[];
}

const GRAPHS: GraphSpec[] = [
  {
    name: "spark",
    title: "spark",
    needsSeries: true,
    render: (control, context, series) => sparkRow(series, control.schedule.now, context.columns - 6, context.theme, context.color),
  },
  {
    name: "gauge",
    title: "gauge",
    needsSeries: true,
    render: (control, context, series) => gaugeRows(series, control.schedule.now, context.columns, context.theme, context.color),
  },
  {
    name: "segments",
    title: "segments",
    needsSeries: true,
    render: (control, context, series) => segmentRows(series, control.schedule.now, context.columns, context.theme, context.color),
  },
  {
    name: "pace",
    title: "pace",
    needsSeries: true,
    render: (control, context, series) => paceRows(series, control.schedule.now, context.columns, context.theme, context.color),
  },
  {
    name: "line",
    title: "line",
    needsSeries: true,
    render: (control, context, series) =>
      brailleRows(series, control.schedule.now, context.columns, Math.max(4, Math.min(8, context.rows - 16)), context.theme, context.color),
  },
  {
    name: "runway",
    title: "runway",
    needsSeries: true,
    render: (control, context, series) => runwayRows(series, control.schedule.now, context.columns, context.theme, context.color),
  },
  {
    name: "big",
    title: "big",
    needsSeries: true,
    render: (control, context, series) => bigRows(series, control.schedule.now, context.theme, context.color),
  },
  {
    name: "columns",
    title: "columns",
    needsSeries: false,
    render: (control, context) =>
      columnRows(
        allBuckets(control),
        control.schedule.bounds.from,
        control.schedule.bounds.to,
        context.columns,
        Math.max(3, Math.min(7, context.rows - 17)),
        context.theme,
        context.color,
      ),
  },
  {
    name: "stack",
    title: "stack",
    needsSeries: false,
    render: (control, context) =>
      stackRows(
        slicesFor(control, context),
        control.schedule.bounds.from,
        control.schedule.bounds.to,
        context.columns,
        Math.max(3, Math.min(7, context.rows - 18)),
        context.theme,
        context.color,
      ),
  },
  {
    name: "heat",
    title: "heat",
    needsSeries: false,
    render: (control, context) =>
      heatRows(allBuckets(control), control.schedule.bounds.from, control.schedule.bounds.to, context.columns, context.theme, context.color),
  },
];

function graphView(spec: GraphSpec): View {
  return {
    name: spec.name,
    title: spec.title,
    render(control, context) {
      const series = seriesFor(control);
      const head =
        spec.needsSeries && series.points.length === 0
          ? [`  ${paint(context.theme, "dim", "no published reading yet — the graph fills in as you work", context.color)}`]
          : spec.render(control, context, series);
      const room = Math.max(3, context.rows - head.length - 9);
      return [...head, "", ...tableRows(control, context, room), "", statusRow(control, context)];
    },
  };
}

interface BarSpec {
  name: string;
  title: string;
  basis: "window" | "target";
  bar(used: number, target: number, width: number, theme: Theme, color: boolean, role: string): string;
  trailing?: boolean;
}

const BARS: BarSpec[] = [
  { name: "bars", title: "bars", basis: "target", bar: (value, _t, width, theme, color, role) => asciiBar(value, width, theme, color, role) },
  { name: "blocks", title: "blocks", basis: "target", bar: (value, _t, width, theme, color, role) => blockBar(value, width, theme, color, role) },
  { name: "target", title: "target", basis: "window", bar: (used, target, width, theme, color, role) => markerBar(used, target, width, theme, color, role) },
  { name: "twin", title: "twin", basis: "window", bar: (used, target, width, theme, color, role) => twinBar(used, target, width, theme, color, role) },
  {
    name: "wide",
    title: "wide",
    basis: "window",
    bar: (used, target, width, theme, color, role) => markerBar(used, target, width, theme, color, role),
    trailing: true,
  },
];

function barView(spec: BarSpec): View {
  return {
    name: spec.name,
    title: spec.title,
    render(control, context) {
      const { theme, color } = context;
      const views = activeViews(control.schedule);
      const attributed = control.schedule.live !== null;
      const labelWidth = labelWidthFor(context);
      const out = [...capacityRows(control, context), ""];

      if (spec.trailing) {
        for (const [index, view] of views.entries()) {
          const running = view.state === "active" || view.state === "needs-more";
          const role = running ? pressureRole(view.pressure.value) : "dim";
          const used = attributed ? (view.attributedPercent ?? 0) / 100 : view.observed;
          const value = spec.basis === "target" ? view.pressure.value : used;
          const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯ ", color) : "  ";
          out.push(
            `${cursor}${context.labels.get(view.claimant.id) ?? view.claimant.label} ${paint(theme, "dim", `· ${view.claimant.priority} · ${compactNumber(view.usage.tokens)} tok · ${clip(view.claimant.prompt || "—", Math.max(10, context.columns - labelWidth - 36))}`, color)}`,
          );
          out.push(
            `    ${spec.bar(value, view.allocation.target, context.columns - 20, theme, color, role)} ${percentLabel(used * 100)} ${paint(theme, "dim", `/ ${percentLabel(view.allocation.target * 100)}`, color)}`,
          );
        }
      } else {
        out.push(
          paint(
            theme,
            "dim",
            `    ${padEndVisible("session", labelWidth)}  ${spec.basis === "target" ? "how much of its own target share is spent" : spec.name === "twin" ? "target │ used, of the window" : "used of the window, ┃ marks target"}`,
            color,
          ),
        );
        for (const [index, view] of views.entries()) {
          const running = view.state === "active" || view.state === "needs-more";
          const role = running ? pressureRole(view.pressure.value) : "dim";
          const used = attributed ? (view.attributedPercent ?? 0) / 100 : view.observed;
          const value = spec.basis === "target" ? view.pressure.value : used;
          const cursor = context.interactive && context.selected === index ? paint(theme, "accent", "❯ ", color) : "  ";
          const mark = paint(theme, view.state === "blocked" ? "danger" : running ? "ok" : "dim", STATE_MARK[view.state] ?? "•", color);
          const label = padEndVisible(clip(context.labels.get(view.claimant.id) ?? view.claimant.label, labelWidth), labelWidth);
          const trailingLabel =
            spec.basis === "target"
              ? `${percentLabel(view.pressure.value * 100)} ${paint(theme, "dim", `of ${percentLabel(view.allocation.target * 100)}`, color)}`
              : `${percentLabel(used * 100)} ${paint(theme, "dim", `/ ${percentLabel(view.allocation.target * 100)}`, color)}`;
          out.push(
            `${cursor}${mark} ${label} ${spec.bar(value, view.allocation.target, Math.max(16, context.columns - labelWidth - 28), theme, color, role)} ${trailingLabel}`,
          );
        }
      }

      out.push("");
      out.push(statusRow(control, context));
      return out;
    },
  };
}

export const VIEWS: View[] = [planView, ...GRAPHS.map(graphView), ...BARS.map(barView)];

export function viewByName(name: string): View {
  return VIEWS.find((view) => view.name === name) ?? VIEWS[0]!;
}

export function helpOverlay(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  return [
    `  ${paint(theme, "accent", "keys", color)}`,
    "",
    "    ↑↓        select a session",
    "    ←→        move its target share by 5 points",
    "    u         unpin it, back to an even split",
    "    p         priority: high → normal → low",
    "    e         equalize — clear every pin",
    "    d b a n   mark done · blocked · active · needs-more",
    "    v V       next / previous view",
    "    P         what to preserve, and your own line of advice",
    "    r         refresh now      ?  this help      q  quit",
    "",
    `  ${paint(theme, "accent", "views", color)}`,
    "",
    `    ${paint(theme, "dim", "plan — the table on its own", color)}`,
    `    ${paint(theme, "dim", `a graph above the table: ${GRAPHS.map((graph) => graph.name).join(", ")}`, color)}`,
    `    ${paint(theme, "dim", `a bar per session: ${BARS.map((bar) => bar.name).join(", ")}`, color)}`,
    `    ${paint(theme, "dim", "npx savemytokens --view <name> prints one without the TUI", color)}`,
    "",
    `  ${paint(theme, "accent", "what the numbers mean", color)}`,
    "",
    `    ${paint(theme, "dim", "5h / 7d    published by Anthropic, captured from the status line payload", color)}`,
    `    ${paint(theme, "dim", "share      measured from your transcripts, weighted input 1 · write 1.25 · read 0.1 · output 5", color)}`,
    `    ${paint(theme, "dim", "used       published % × that share — the total is theirs, the split between sessions is ours", color)}`,
    `    ${paint(theme, "dim", "target     what you asked this session to aim for; a decision, not a measurement", color)}`,
    "",
    `    ${paint(theme, "dim", `enforcement: ${control.enforcement.length > 0 ? control.enforcement.join(", ") : "none"} — a hook injects text, nothing here holds a session to a number`, color)}`,
  ];
}
