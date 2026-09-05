import type { ControlPlan } from "../scheduler/plan.js";
import { visibleRows, workingSet } from "../scheduler/plan.js";
import {
  formatCountdown,
  formatReset,
  loadMeter,
  meterBar,
  paint,
  paintHead,
  pressureRole,
  type ProjectView,
  type Theme,
} from "../runtime/kernel.mjs";
import { clip, padEndVisible, padStartVisible, visibleWidth } from "../util/ansi.js";
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

export function labelsFor(views: ProjectView[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const view of views) labels.set(view.project, view.label);
  return labels;
}

function capacityRow(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const now = control.schedule.now;
  const published = control.resources.filter((resource) => resource.usedPercent !== null || resource.rolledOver);
  if (published.length === 0) {
    const installed = control.installed;
    const head = installed ? "waiting for the first reading" : "not installed";
    const tails = installed
      ? ["· it arrives the next time a Claude session draws its status line", "· wait for a Claude session to draw it", ""]
      : ["· nothing is live until you run: npx savemytokens install", "· run: npx savemytokens install", ""];
    for (const tail of tails) {
      const line = `  ${paint(theme, "warn", head, color)}${tail ? ` ${paint(theme, "dim", tail, color)}` : ""}`;
      if (visibleWidth(line) <= context.columns) return [line];
    }
    return [`  ${paint(theme, "warn", clip(head, context.columns - 2), color)}`];
  }
  const levels: Array<{ bar: number; reset: "clock" | "long" | "short" | "none"; gap: number }> = [
    { bar: 12, reset: "clock", gap: 4 },
    { bar: 12, reset: "long", gap: 4 },
    { bar: 10, reset: "short", gap: 3 },
    { bar: 6, reset: "short", gap: 2 },
    { bar: 0, reset: "none", gap: 2 },
  ];
  const build = (level: { bar: number; reset: "clock" | "long" | "short" | "none"; gap: number }): string => {
    const parts = published.map((resource) => {
      const used = resource.usedPercent ?? 0;
      const key = resource.id.split(":")[1] ?? "";
      const name = key === "five_hour" ? "5h" : key === "seven_day" ? "7d" : "spend";
      const fresh = resource.usedPercent === null;
      const countdown = !fresh && resource.window.resetsAt ? formatCountdown(resource.window.resetsAt, now) : "";
      const reset =
        !countdown || level.reset === "none"
          ? ""
          : level.reset === "clock"
            ? ` ${paint(theme, "dim", `resets in ${countdown} (${formatReset(resource.window.resetsAt ?? 0, now)})`, color)}`
            : level.reset === "long"
              ? ` ${paint(theme, "dim", `resets in ${countdown}`, color)}`
              : ` ${paint(theme, "dim", countdown, color)}`;
      const bar = level.bar > 0 ? ` ${meterBar(theme, used / 100, level.bar, pressureRole(used / 100), color)}` : "";
      const figure = fresh
        ? paint(theme, "dim", percentLabel(0), color)
        : paint(theme, pressureRole(used / 100), percentLabel(used), color);
      const note = fresh ? ` ${paint(theme, "dim", "window just reset", color)}` : reset;
      return `${paint(theme, "dim", name, color)}${bar} ${figure}${note}`;
    });
    return `  ${parts.join(" ".repeat(level.gap))}`;
  };
  for (const level of levels) {
    const line = build(level);
    if (visibleWidth(line) <= context.columns) return [line];
  }
  return [clip(build(levels[levels.length - 1] as (typeof levels)[number]), context.columns)];
}

const COLUMN_WIDTH: Record<string, number> = {
  allocation: 10,
  used: 15,
  share: 6,
  tokens: 7,
  priority: 8,
};

const DROP_ORDER = ["tokens", "share", "priority", "allocation"];
const MIN_LABEL = 8;

interface Widths {
  label: number;
  prompt: number;
  bar: number;
  used: number;
  columns: string[];
}

function columnWidths(context: ViewContext, wanted: string[]): Widths {
  const bar = barCellsFor(context.columns);
  const usedWidth = bar + 8;
  const spanOf = (list: string[]): number => {
    let total = 3;
    for (const name of list) {
      const width = name === "used" ? usedWidth : COLUMN_WIDTH[name];
      if (width) total += width + 1;
    }
    return total;
  };
  let columns = [...wanted];
  for (const drop of DROP_ORDER) {
    if (spanOf(columns) + MIN_LABEL <= context.columns) break;
    columns = columns.filter((name) => name !== drop);
  }
  const fixed = spanOf(columns);
  const ideal = Math.min(26, Math.max(14, ...[...context.labels.values()].map((value) => value.length + 2), 14));
  const room = Math.max(MIN_LABEL, context.columns - fixed);
  const wantsPrompt = columns.includes("last prompt");
  const label = Math.max(MIN_LABEL, Math.min(ideal, wantsPrompt ? Math.max(MIN_LABEL, room - 15) : room));
  const spare = room - label - 1;
  const prompt = wantsPrompt && spare >= 14 ? spare : 0;
  return { label, prompt, bar, used: usedWidth, columns };
}

function headerRow(context: ViewContext, widths: Widths, columns: string[]): string {
  const { theme, color } = context;
  const cells = [`    ${padEndVisible(clip("PROJECT", widths.label - 1), widths.label - 1)}`];
  if (columns.includes("allocation")) cells.push(padStartVisible("ALLOCATION", 10));
  if (columns.includes("used")) cells.push(padEndVisible("USED OF IT", widths.used));
  if (columns.includes("share")) cells.push(padStartVisible("SHARE", 6));
  if (columns.includes("tokens")) cells.push(padStartVisible("TOKENS", 7));
  if (columns.includes("priority")) cells.push(padEndVisible("PRIORITY", 8));
  if (columns.includes("last prompt") && widths.prompt > 0) cells.push(clip("LAST PROMPT", widths.prompt));
  return paintHead(theme, cells.join(" "), color);
}

function row(
  view: ProjectView,
  index: number,
  context: ViewContext,
  widths: Widths,
  columns: string[],
): string {
  const { theme, color } = context;
  const role = pressureRole(view.pressure.value);
  const cursor =
    context.interactive && context.selected === index ? paint(theme, "accent", theme.tui?.cursor ?? "❯", color) : " ";
  const pin = view.settings.pinned ? paint(theme, "accent", theme.tui?.pin ?? "★", color) : " ";
  const open = view.bucket === "active";
  const tone = (want: string) => (open ? want : "dim");
  const sessions = view.liveSessions > 1 ? paint(theme, "dim", `${view.liveSessions}`, color) : " ";
  const label = padEndVisible(paint(theme, tone("fg"), clip(view.label, widths.label - 1), color), widths.label - 1);
  const held = view.allocation.target > 0 ? view.allocation.target : (view.settings.share ?? 0);
  const allocationCell = padStartVisible(
    held > 0
      ? paint(theme, tone("fg"), percentLabel(held * 100, 5), color)
      : paint(theme, "dim", view.settings.share === 0 ? "none" : "-", color),
    10,
  );
  const starved = view.allocation.target <= 0;
  const used = padEndVisible(
    starved
      ? `${emptyBar(widths.bar, theme, color)} ${padStartVisible(paint(theme, "dim", open ? "-" : "idle", color), 4)}`
      : `${smallBar(view.pressure.value, widths.bar, theme, color, tone(role))} ${padStartVisible(paint(theme, tone(role), percentLabel(view.pressure.value * 100, 4), color), 4)}`,
    widths.used,
  );
  const share = padStartVisible(paint(theme, "dim", percentLabel(view.observed * 100, 5), color), 6);
  const tokens = padStartVisible(paint(theme, "dim", compactNumber(view.usage.tokens), color), 7);
  const priority = padEndVisible(
    paint(theme, view.settings.priority === "high" ? tone("accent") : "dim", view.settings.priority.toUpperCase(), color),
    8,
  );
  const cells = [`${cursor}${pin}${sessions} ${label}`];
  if (columns.includes("allocation")) cells.push(allocationCell);
  if (columns.includes("used")) cells.push(used);
  if (columns.includes("share")) cells.push(share);
  if (columns.includes("tokens")) cells.push(tokens);
  if (columns.includes("priority")) cells.push(priority);
  if (columns.includes("last prompt") && widths.prompt > 0) {
    cells.push(paint(theme, "dim", clip(view.prompt || "-", widths.prompt), color));
  }
  return cells.join(" ");
}

function promptColumn(widths: Widths, columns: string[]): number {
  let at = 4 + (widths.label - 1);
  for (const name of columns) {
    if (name === "last prompt") continue;
    const width = name === "used" ? widths.used : COLUMN_WIDTH[name];
    if (width) at += width + 1;
  }
  return at + 1;
}

function idleHeaderRow(context: ViewContext, widths: Widths, columns: string[]): string {
  const { theme, color } = context;
  const head = `    ${padEndVisible("PROJECT", widths.label - 1)} ${padStartVisible("LAST TURN", 10)}`;
  const gap = Math.min(8, Math.max(2, promptColumn(widths, columns) - visibleWidth(head)));
  return paintHead(theme, `${head}${" ".repeat(gap)}LAST PROMPT`, color);
}

function idleRow(
  view: ProjectView,
  index: number,
  context: ViewContext,
  widths: Widths,
  now: number,
  columns: string[],
): string {
  const { theme, color } = context;
  const cursor =
    context.interactive && context.selected === index ? paint(theme, "accent", theme.tui?.cursor ?? "❯", color) : " ";
  const pin = view.settings.pinned ? paint(theme, "accent", theme.tui?.pin ?? "★", color) : " ";
  const label = padEndVisible(clip(view.label, widths.label - 1), widths.label - 1);
  const when = padStartVisible(ago(view.lastSeen, now), 10);
  const reserved = view.settings.share != null && view.settings.share > 0 ? `${percentLabel(view.settings.share * 100, 4)} held` : "";
  const tag = view.settings.parked ? "parked" : reserved;
  const head = `${label} ${when}`;
  const gap = Math.min(8, Math.max(2, promptColumn(widths, columns) - 4 - visibleWidth(head)));
  const room = Math.max(10, context.columns - 4 - visibleWidth(head) - gap - (tag ? tag.length + 2 : 0));
  const prompt = padEndVisible(clip(view.prompt || "-", room), tag ? room : 0);
  return `${cursor}${pin}  ${paint(theme, "dim", `${head}${" ".repeat(gap)}${prompt}${tag ? `  ${tag}` : ""}`, color)}`;
}

function footerNote(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const set = workingSet(control.schedule, context.expanded);
  const open = set.members.filter((view) => view.bucket === "active");
  const sessions = open.reduce((sum, view) => sum + view.liveSessions, 0);
  const spare = Math.round(control.schedule.unusedPool * 100);
  const room = Math.max(10, context.columns - 2);
  const waiting = set.members.length - open.length;
  const long = `${open.length} of ${set.members.length} open, across ${sessions} ${sessions === 1 ? "session" : "sessions"}${waiting > 0 ? `, ${waiting} waiting` : ""}${spare > 0 ? `, ${spare}% unclaimed` : ""}.`;
  const short = `${open.length}/${set.members.length} open · ${sessions}s${spare > 0 ? ` · ${spare}% spare` : ""}`;
  const out = [`  ${paint(theme, "dim", long.length <= room ? long : short, color)}`];
  const drift = control.unattributed ?? 0;
  if (drift >= UNATTRIBUTED_FLOOR) {
    const head = `${Math.round(drift)}% of the window was spent outside these projects`;
    const tail = "from claude.ai, another machine, or usage SaveMyTokens was not running for";
    const fits = head.length + 1 + tail.length <= room;
    out.push(`  ${paint(theme, "warn", clip(head, room), color)}${fits ? ` ${paint(theme, "dim", tail, color)}` : ""}`);
  }
  return out;
}

function sectionTitle(name: string, count: number, hint: string, context: ViewContext): string {
  const { theme, color } = context;
  const head = `  ${paintHead(theme, name, color)} ${paint(theme, "dim", String(count), color)}`;
  const room = context.columns - visibleWidth(head) - 3;
  return hint.length <= room ? `${head}  ${paint(theme, "dim", hint, color)}` : head;
}

export function planRows(control: ControlPlan, context: ViewContext): string[] {
  const set = workingSet(control.schedule, context.expanded);
  const columns = control.config.columns ?? [];
  const widths = columnWidths(context, columns);
  const shown = widths.columns;
  const now = control.schedule.now;
  const out = [...capacityRow(control, context)];
  let index = 0;
  let printed = 0;
  const budget = context.expanded ? Number.MAX_SAFE_INTEGER : Math.max(6, context.rows - 15);

  out.push("");
  if (set.members.length === 0) {
    out.push(`  ${paint(context.theme, "dim", "Nothing sharing the window yet. Open Claude Code in a project, or press a on one below.", context.color)}`);
  } else {
    out.push(sectionTitle("ACTIVE", set.members.length, "sharing the window · x drops one", context));
    out.push(headerRow(context, widths, shown));
    for (const view of set.members) {
      if (printed < budget) out.push(row(view, index, context, widths, shown));
      index += 1;
      printed += 1;
    }
  }

  if (set.candidates.length > 0) {
    out.push("");
    out.push(sectionTitle("RECENT", set.candidates.length, "holding nothing · a moves one up", context));
    out.push(idleHeaderRow(context, widths, shown));
    for (const view of set.candidates) {
      if (printed < budget) out.push(idleRow(view, index, context, widths, now, shown));
      index += 1;
      printed += 1;
    }
  }

  const total = set.members.length + set.candidates.length + set.hidden;
  if (total > printed) {
    out.push(`  ${paint(context.theme, "dim", `+${total - printed} more, m shows them`, context.color)}`);
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

  const at = Math.max(0, Math.min(context.selected, rows.length - 1));
  const walk = rows.length > 1 ? `   ${at + 1}/${rows.length} · ↑↓ moves to the next project` : "";
  const out = [
    `  ${paint(theme, "accent", view.label, color)} ${paint(theme, "dim", `· ${view.bucket}${view.settings.pinned ? " · pinned" : ""}${view.settings.parked ? " · parked" : ""} · ${view.settings.priority}${walk}`, color)}`,
    `  ${paint(theme, "dim", clip(view.project, context.columns - 4), color)}`,
    "",
  ];

  if (live) {
    out.push(`  ${paint(theme, "dim", "allocation", color)} ${meterBar(theme, view.allocation.target, width, "accent", color)} ${percentLabel(view.allocation.target * 100)}`);
    out.push(
      `  ${paint(theme, "dim", "used of it", color)} ${smallBar(view.pressure.value, width, theme, color, pressureRole(view.pressure.value))} ${percentLabel(view.pressure.value * 100)}`,
    );
  } else {
    out.push(`  ${paint(theme, "dim", `nothing running. Last turn ${ago(view.lastSeen, control.schedule.now)}, holding no allocation`, color)}`);
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
      `    ${mark} ${padEndVisible(session.claimant.id.slice(0, 8), 9)} ${padEndVisible(when, 18)} ${paint(theme, "dim", clip(session.claimant.prompt || "-", context.columns - 36), color)}`,
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

const HELP_KEYS: Array<[string, string]> = [
  ["↑ ↓", "select a project"],
  ["⏎", "open it and see its sessions, esc comes back"],
  ["← →", "move its allocation by 5 points"],
  ["u", "unset this target: back to an even split with the rest"],
  ["e", "unset every target at once"],
  ["p", "priority: high → normal → low, who gets spare capacity first"],
  ["a", "add a project to the plan"],
  ["x", "take one out of the plan"],
  ["f", "pin the row to the top of the list"],
  ["d", "mark it done: hands its unspent share to the others now"],
  ["b n", "mark it blocked, or needs-more"],
  ["m", "show every project, not just the first screenful"],
  [", P", "settings: columns, theme, status line, what to protect"],
  ["r", "read everything again now"],
  ["? q", "this help · quit"],
];

function helpSection(title: string, context: ViewContext): string[] {
  return ["", `  ${paintHead(context.theme, title.toUpperCase(), context.color)}`, ""];
}

function helpProse(text: string, context: ViewContext): string[] {
  const { theme, color } = context;
  const room = Math.max(24, context.columns - 6);
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= room) line += ` ${word}`;
    else {
      out.push(`    ${paint(theme, "dim", line, color)}`);
      line = word;
    }
  }
  if (line) out.push(`    ${paint(theme, "dim", line, color)}`);
  return out;
}

export function helpOverlay(control: ControlPlan, context: ViewContext): string[] {
  const { theme, color } = context;
  const policy = control.config.policy;
  const stages = policy === "strict" ? "35/60/80" : policy === "relaxed" ? "80/95" : policy === "off" ? "" : "50/80/90";
  const keyWidth = Math.max(...HELP_KEYS.map(([key]) => key.length));
  const room = Math.max(16, context.columns - keyWidth - 8);

  const out: string[] = [`  ${paintHead(theme, "KEYS", color)}`, ""];
  for (const [key, what] of HELP_KEYS) {
    const wrapped: string[] = [];
    let line = "";
    for (const word of what.split(" ")) {
      if (line.length === 0) line = word;
      else if (line.length + 1 + word.length <= room) line += ` ${word}`;
      else {
        wrapped.push(line);
        line = word;
      }
    }
    if (line) wrapped.push(line);
    for (const [at, text] of wrapped.entries()) {
      const gutter = at === 0 ? paint(theme, "accent", padEndVisible(key, keyWidth), color) : " ".repeat(keyWidth);
      out.push(`    ${gutter}  ${paint(theme, "dim", text, color)}`);
    }
  }

  out.push(...helpSection("the two tables", context));
  out.push(...helpProse("ACTIVE is what shares your window. A project joins it on its own the moment you open Claude Code there, and stays after you close it, holding whatever target you gave it.", context));
  out.push("");
  out.push(...helpProse("RECENT is everything else SaveMyTokens has seen. Nothing there holds a share. Press a to move one up into ACTIVE, x to send one back down.", context));
  out.push("");
  out.push(...helpProse("A filled dot means a session is open there right now. Only those spend the window, so one sitting in ACTIVE with nothing running lends its share to the rest and takes it back when you return.", context));

  out.push(...helpSection("allocation and priority", context));
  out.push(...helpProse("Allocation is what you asked for: the share of the window this project should get. Move it with the arrows.", context));
  out.push("");
  out.push(...helpProse("Priority decides who gets the leftovers. Capacity is released whenever a project finishes or sits idle under its target, and that spare goes to every HIGH project first, then NORMAL, then LOW. It is an order, not a weighting: a LOW project gets nothing while a HIGH one still has room.", context));
  out.push("");
  out.push(...helpProse("So allocation is your intent and priority is the tie-break. If pinned targets already add up to the whole window there is no spare, and priority does nothing.", context));

  out.push(...helpSection("the status line", context));
  out.push(
    ...helpProse(
      control.installed
        ? "Installed. It is the only place Anthropic publishes your 5h and 7d usage, and it is what proves a session is still open, so without it nothing here is live. Change its shape with P."
        : "Not installed, so nothing here is live. It is the only place Anthropic publishes your 5h and 7d usage, and it is what proves a session is still open. Run: npx savemytokens install",
      context,
    ),
  );

  out.push(...helpSection("the numbers", context));
  out.push(...helpProse("5h and 7d are Anthropic's own. Share is measured from the tokens in your transcripts. Used of it is their number split by that share, so the split between rows is ours, not theirs.", context));

  const drift = control.unattributed ?? 0;
  if (drift >= UNATTRIBUTED_FLOOR) {
    out.push("");
    out.push(...helpProse("Window spent outside these projects is claude.ai, another machine, or work done before SaveMyTokens was watching.", context));
  }

  out.push(...helpSection("when it gets tight", context));
  out.push(
    ...helpProse(
      stages
        ? `Claude is told to wind down at ${stages}% of a project's target. Change it with P.`
        : "Nothing is ever said to Claude, because the policy is off. Change it with P.",
      context,
    ),
  );

  out.push(...helpSection("anything else", context));
  out.push(...helpProse("Questions, bugs and ideas: hello@offbeatport.com", context));
  return out;
}
