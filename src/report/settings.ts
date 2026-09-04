import {
  COLUMNS,
  HUD_PRESETS,
  HUD_PRESET_ABOUT,
  POLICIES as ALL_POLICIES,
  presetMatching,
  DEFAULT_COLUMNS,
  DEFAULT_HUD_SEGMENTS,
  HUD_SEGMENTS,
  POLICIES,
  builtinThemes,
  loadTheme,
  paint,
  policyNames,
  renderSegments,
  stageText,
  userThemes,
  type Config,
  type HudView,
  type Theme,
} from "../runtime/kernel.mjs";
import { padEndVisible } from "../util/ansi.js";

export const PRESERVE_KINDS = ["implementation", "tests", "end-to-end checks", "documentation", "exploration"];

const COLUMN_ABOUT: Record<string, string> = {
  allocation: "the share of the window you want this project to get",
  used: "how much of that allocation it has spent",
  share: "its part of the tokens measured on disk",
  tokens: "tokens it burned in this window",
  priority: "who gets spare capacity first",
  "last prompt": "the last thing you typed there",
};

const SEGMENT_ABOUT: Record<string, string> = {
  tag: "SMT, to mark our half of a wrapped status line",
  project: "the project this session belongs to",
  target: "its allocation, as a percentage of the window",
  used: "how much of the window this session has spent",
  share: "its part of the tokens measured on disk",
  pair: "used and allocation together, as 21%/50%",
  bar: "how far through its allocation it is",
  priority: "HIGH, NORMAL or LOW",
  "5h": "the 5-hour window Anthropic publishes",
  "7d": "the weekly window",
  spend: "a gateway spend limit, when you have one",
  reset: "how long until the 5-hour window resets",
  meter5h: "the 5-hour window drawn as a bar",
  spark: "the shape of the window so far",
  pace: "how far ahead or behind the clock you are",
  empty: "when you run dry at this rate",
};

export type SettingRow =
  | { kind: "header"; label: string; hint?: string }
  | { kind: "blank" }
  | { kind: "column"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "theme"; surface: "tui" | "hud" }
  | { kind: "policy" }
  | { kind: "timeline" }
  | { kind: "pace" }
  | { kind: "stage"; at: number }
  | { kind: "preserve"; index: number }
  | { kind: "advice" }
  | { kind: "preview" }
  | { kind: "preset" };

export function settingsRows(config: Config): SettingRow[] {
  const rows: SettingRow[] = [];
  rows.push({ kind: "header", label: "COLUMNS", hint: "space toggles" });
  for (const id of COLUMNS) rows.push({ kind: "column", id });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "THEME", hint: "← → changes it" });
  rows.push({ kind: "theme", surface: "tui" });
  rows.push({ kind: "theme", surface: "hud" });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "STATUS LINE", hint: "← → picks a shape · space adds or removes a piece" });
  rows.push({ kind: "preset" });
  rows.push({ kind: "preview" });
  const chosen = config.hud?.segments ?? DEFAULT_HUD_SEGMENTS;
  const rest = HUD_SEGMENTS.filter((id) => !chosen.includes(id));
  for (const id of [...chosen, ...rest]) rows.push({ kind: "segment", id });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "WHEN IT GETS TIGHT", hint: "← → changes it" });
  rows.push({ kind: "policy" });
  rows.push({ kind: "timeline" });
  rows.push({ kind: "pace" });
  const policy = ALL_POLICIES[config.policy] ?? ALL_POLICIES.finish;
  for (const stage of policy?.stages ?? []) rows.push({ kind: "stage", at: stage.at });
  rows.push({ kind: "blank" });
  for (let index = 0; index < PRESERVE_KINDS.length; index++) rows.push({ kind: "preserve", index });
  rows.push({ kind: "advice" });
  return rows;
}

export function withToggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

export function withMoved(list: string[], id: string, delta: number): string[] {
  const at = list.indexOf(id);
  if (at === -1) return list;
  const to = Math.max(0, Math.min(list.length - 1, at + delta));
  if (to === at) return list;
  const next = [...list];
  const [item] = next.splice(at, 1);
  if (item) next.splice(to, 0, item);
  return next;
}

export function selectableRows(rows: SettingRow[]): number[] {
  const out: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (!["header", "blank", "preview", "timeline", "pace"].includes(row.kind)) out.push(index);
  }
  return out;
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

function themeNames(): string[] {
  return [...new Set([...builtinThemes(), ...userThemes()])];
}

export interface TightPreview {
  label: string;
  target: number;
  usedPoints: number;
  pressure: number;
  ratePerHour: number | null;
  now: number;
  preserve: string[];
  custom: string;
}

function clockAt(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

function whenStage(at: number, tight: TightPreview): string {
  if (!(tight.target > 0)) return "no allocation";
  if (tight.pressure >= at / 100) return "now";
  if (!tight.ratePerHour || tight.ratePerHour <= 0.05) return "not burning";
  const needed = (at / 100) * tight.target * 100 - tight.usedPoints;
  const hours = needed / tight.ratePerHour;
  if (!Number.isFinite(hours) || hours < 0) return "now";
  if (hours > 12) return "not today";
  return `~${clockAt(tight.now + hours * 3_600_000)}`;
}

function timelineRow(config: Config, tight: TightPreview, width: number, theme: Theme, color: boolean): string[] {
  const policy = ALL_POLICIES[config.policy] ?? ALL_POLICIES.finish;
  const stages = policy?.stages ?? [];
  const cells = Math.max(24, Math.min(width - 20, 56));
  const marks = new Map<number, string>();
  for (const stage of stages) marks.set(Math.round((stage.at / 100) * (cells - 1)), "┬");
  const here = Math.max(0, Math.min(cells - 1, Math.round(Math.min(1, tight.pressure) * (cells - 1))));

  let track = "";
  for (let index = 0; index < cells; index++) {
    if (marks.has(index)) track += paint(theme, "accent", "┬", color);
    else track += paint(theme, index <= here ? "ok" : "track", index <= here ? "━" : "─", color);
  }
  const pointer = `${" ".repeat(here)}${paint(theme, "accent", "▲", color)}`;
  const labels = stages.map((stage) => `${stage.at}% ${stage.actions.join("+")}`).join("   ");
  return [
    `      ${track}`,
    `      ${pointer} ${paint(theme, "dim", `${tight.label} is at ${Math.round(tight.pressure * 100)}% of its allocation`, color)}`,
    `      ${paint(theme, "dim", labels || "nothing is ever injected", color)}`,
  ];
}

export function renderSettings(
  config: Config,
  rows: SettingRow[],
  cursor: number,
  editing: boolean,
  draft: string,
  preview: HudView,
  theme: Theme,
  color: boolean,
  tight?: TightPreview,
  width = 100,
): string[] {
  const columns = config.columns ?? DEFAULT_COLUMNS;
  const segments = config.hud?.segments ?? DEFAULT_HUD_SEGMENTS;
  const preserve = config.preserveFor.default ?? [];
  const out: string[] = [];

  for (const [index, row] of rows.entries()) {
    const here = index === cursor;
    const mark = here ? paint(theme, "accent", theme.tui?.cursor ?? "❯", color) : " ";

    if (row.kind === "blank") {
      out.push("");
      continue;
    }
    if (row.kind === "header") {
      out.push(`  ${paint(theme, "accent", row.label, color)}  ${paint(theme, "dim", row.hint ?? "", color)}`);
      continue;
    }
    if (row.kind === "preset") {
      const names = Object.keys(HUD_PRESETS);
      const current = presetMatching(segments);
      const at = current ? names.indexOf(current) : -1;
      const label = current ?? "custom";
      const about = current ? HUD_PRESET_ABOUT[current] ?? "" : "your own arrangement";
      out.push(
        `  ${mark} ${padEndVisible("shape", 15)} ${paint(theme, "dim", "‹", color)} ${paint(theme, "accent", padEndVisible(label, 11), color)} ${paint(theme, "dim", "›", color)} ${paint(theme, "dim", at >= 0 ? `${at + 1}/${names.length}` : "   ", color)}   ${paint(theme, "dim", about, color)}`,
      );
      continue;
    }
    if (row.kind === "preview") {
      out.push(`      ${renderSegments(segments, preview, loadTheme(config.theme.hud), color)}`);
      out.push("");
      continue;
    }
    if (row.kind === "column") {
      const on = columns.includes(row.id);
      const about = COLUMN_ABOUT[row.id] ?? "";
      out.push(
        `  ${mark} ${on ? paint(theme, "ok", "◉", color) : paint(theme, "dim", "○", color)} ${padEndVisible(row.id, 12)} ${paint(theme, "dim", `— ${about}`, color)}`,
      );
      continue;
    }
    if (row.kind === "segment") {
      const at = segments.indexOf(row.id);
      const on = at !== -1;
      const order = on ? paint(theme, "dim", String(at + 1).padStart(2), color) : "  ";
      const name = padEndVisible(row.id, 9);
      const about = SEGMENT_ABOUT[row.id] ?? "";
      out.push(
        `  ${mark} ${on ? paint(theme, "ok", "◉", color) : paint(theme, "dim", "○", color)} ${order} ${on ? name : paint(theme, "dim", name, color)} ${paint(theme, "dim", `— ${about}`, color)}`,
      );
      continue;
    }
    if (row.kind === "theme") {
      const names = themeNames();
      const current = config.theme[row.surface];
      const at = Math.max(0, names.indexOf(current));
      const shown = loadTheme(current);
      const name = `${paint(theme, "dim", "‹", color)} ${paint(theme, "accent", padEndVisible(current, 11), color)} ${paint(theme, "dim", "›", color)}`;
      const position = paint(theme, "dim", `${at + 1}/${names.length}`, color);
      const sample =
        row.surface === "tui"
          ? `${paint(shown, "accent", shown.tui.cursor ?? "", color)} ${paint(shown, "ok", shown.tui.active ?? "", color)} ${paint(shown, "dim", shown.tui.done ?? "", color)}  ${paint(shown, "ok", (shown.tui.fill ?? "|").repeat(4), color)}${paint(shown, "track", (shown.tui.empty ?? ".").repeat(4), color)}`
          : renderSegments(["project", "pair", "5h"], preview, shown, color);
      out.push(
        `  ${mark} ${padEndVisible(row.surface === "tui" ? "control centre" : "status line", 15)} ${name} ${position}   ${sample}`,
      );
      continue;
    }
    if (row.kind === "timeline") {
      if (!tight) continue;
      out.push(...timelineRow(config, tight, width, theme, color));
      continue;
    }
    if (row.kind === "pace") {
      if (!tight) continue;
      const policy = ALL_POLICIES[config.policy] ?? ALL_POLICIES.finish;
      const parts = (policy?.stages ?? []).map((stage) => `${stage.actions[0]} ${whenStage(stage.at, tight)}`);
      out.push(`      ${paint(theme, "dim", parts.length > 0 ? `at this pace   ${parts.join("  ·  ")}` : "", color)}`);
      continue;
    }
    if (row.kind === "stage") {
      const policy = ALL_POLICIES[config.policy] ?? ALL_POLICIES.finish;
      const stage = (policy?.stages ?? []).find((entry) => entry.at === row.at);
      const head = `${padEndVisible(`${row.at}%`, 5)} ${paint(theme, here ? "accent" : "dim", (stage?.actions ?? []).join(" + "), color)}`;
      out.push(`  ${mark} ${head}`);
      if (here && tight) {
        const text = stageText(row.at, {
          target: tight.target,
          observed: 0,
          pressure: tight.pressure,
          basis: "budget",
          preserve: tight.preserve,
          policy,
          custom: tight.custom,
        });
        for (const line of wrap(text, Math.max(30, width - 14))) out.push(`        ${paint(theme, "dim", line, color)}`);
      }
      continue;
    }
    if (row.kind === "policy") {
      const rendered = policyNames()
        .map((name) => (name === config.policy ? paint(theme, "accent", `[${name}]`, color) : paint(theme, "dim", name, color)))
        .join(" ");
      const policy = POLICIES[config.policy] ?? POLICIES.finish;
      const stages = (policy?.stages ?? []).map((stage) => `${stage.at}%`).join(" ") || "never";
      out.push(`  ${mark} ${padEndVisible("policy", 15)} ${rendered}  ${paint(theme, "dim", stages, color)}`);
      continue;
    }
    if (row.kind === "preserve") {
      const kind = PRESERVE_KINDS[row.index] ?? "";
      const on = preserve.includes(kind);
      out.push(`  ${mark} ${on ? paint(theme, "ok", "◉", color) : paint(theme, "dim", "○", color)} ${paint(theme, on ? "fg" : "dim", `preserve ${kind}`, color)}`);
      continue;
    }
    const text = editing && here ? `${draft}${paint(theme, "accent", "▏", color)}` : config.customAdvice.default || paint(theme, "dim", "nothing — enter writes one", color);
    out.push(`  ${mark} ${padEndVisible("your own line", 15)} ${text}`);
  }

  return out;
}
