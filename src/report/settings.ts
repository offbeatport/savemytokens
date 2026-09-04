import {
  COLUMNS,
  DEFAULT_COLUMNS,
  DEFAULT_HUD_SEGMENTS,
  HUD_SEGMENTS,
  POLICIES,
  builtinThemes,
  loadTheme,
  paint,
  policyNames,
  renderSegments,
  userThemes,
  type Config,
  type HudView,
  type Theme,
} from "../runtime/kernel.mjs";
import { padEndVisible } from "../util/ansi.js";

export const PRESERVE_KINDS = ["implementation", "tests", "end-to-end checks", "documentation", "exploration"];

export type SettingRow =
  | { kind: "header"; label: string; hint?: string }
  | { kind: "blank" }
  | { kind: "column"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "theme"; surface: "tui" | "hud" }
  | { kind: "policy" }
  | { kind: "preserve"; index: number }
  | { kind: "advice" }
  | { kind: "preview" };

export function settingsRows(config: Config): SettingRow[] {
  const rows: SettingRow[] = [];
  rows.push({ kind: "header", label: "COLUMNS", hint: "space toggles" });
  for (const id of COLUMNS) rows.push({ kind: "column", id });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "PALETTE", hint: "← → changes it" });
  rows.push({ kind: "theme", surface: "tui" });
  rows.push({ kind: "theme", surface: "hud" });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "STATUS LINE", hint: "space adds or removes · ← → moves it" });
  rows.push({ kind: "preview" });
  const chosen = config.hud?.segments ?? DEFAULT_HUD_SEGMENTS;
  const rest = HUD_SEGMENTS.filter((id) => !chosen.includes(id));
  for (const id of [...chosen, ...rest]) rows.push({ kind: "segment", id });

  rows.push({ kind: "blank" });
  rows.push({ kind: "header", label: "WHEN IT GETS TIGHT", hint: "← → changes it" });
  rows.push({ kind: "policy" });
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
    if (row.kind !== "header" && row.kind !== "blank" && row.kind !== "preview") out.push(index);
  }
  return out;
}

function themeNames(): string[] {
  return [...new Set([...builtinThemes(), ...userThemes()])];
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
): string[] {
  const columns = config.columns ?? DEFAULT_COLUMNS;
  const segments = config.hud?.segments ?? DEFAULT_HUD_SEGMENTS;
  const preserve = config.preserveFor.default ?? [];
  const out: string[] = [];

  for (const [index, row] of rows.entries()) {
    const here = index === cursor;
    const mark = here ? paint(theme, "accent", "❯", color) : " ";

    if (row.kind === "blank") {
      out.push("");
      continue;
    }
    if (row.kind === "header") {
      out.push(`  ${paint(theme, "accent", row.label, color)}  ${paint(theme, "dim", row.hint ?? "", color)}`);
      continue;
    }
    if (row.kind === "preview") {
      out.push(`     ${renderSegments(segments, preview, loadTheme(config.theme.hud), color)}`);
      continue;
    }
    if (row.kind === "column") {
      const on = columns.includes(row.id);
      out.push(`  ${mark} ${on ? paint(theme, "ok", "◉", color) : paint(theme, "dim", "○", color)} ${row.id}`);
      continue;
    }
    if (row.kind === "segment") {
      const at = segments.indexOf(row.id);
      const on = at !== -1;
      const order = on ? paint(theme, "dim", String(at + 1).padStart(2), color) : "  ";
      out.push(`  ${mark} ${on ? paint(theme, "ok", "◉", color) : paint(theme, "dim", "○", color)} ${order} ${on ? row.id : paint(theme, "dim", row.id, color)}`);
      continue;
    }
    if (row.kind === "theme") {
      const names = themeNames();
      const current = config.theme[row.surface];
      const rendered = names
        .map((name) => (name === current ? paint(theme, "accent", `[${name}]`, color) : paint(theme, "dim", name, color)))
        .join(" ");
      out.push(`  ${mark} ${padEndVisible(row.surface === "tui" ? "control centre" : "status line", 15)} ${rendered}`);
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
