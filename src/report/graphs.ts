import { paint, pressureRole, type Theme } from "../runtime/kernel.mjs";
import { padStartVisible } from "../util/ansi.js";

export interface Point {
  at: number;
  value: number;
}

export interface Series {
  points: Point[];
  from: number;
  to: number;
}

export interface Slice {
  label: string;
  buckets: number[][];
}

const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const HEAT = [" ", "░", "▒", "▓", "█"];
const SHADES = ["█", "▓", "▒", "░"];
const BRAILLE_BASE = 0x2800;

export function clockAt(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function percentLabel(value: number, width = 4): string {
  return padStartVisible(`${Math.round(value)}%`, width);
}

export function sampleSeries(series: Series, width: number, until: number): Array<number | null> {
  const out: Array<number | null> = new Array(width).fill(null);
  const span = Math.max(1, series.to - series.from);
  const lastColumn = Math.min(width - 1, Math.floor(((until - series.from) / span) * width));
  for (const point of series.points) {
    if (point.at < series.from || point.at > series.to) continue;
    out[Math.min(width - 1, Math.floor(((point.at - series.from) / span) * width))] = point.value;
  }
  let carried: number | null = null;
  for (let index = 0; index <= lastColumn; index++) {
    const value = out[index];
    if (value === null || value === undefined) out[index] = carried;
    else carried = value;
  }
  return out;
}

export function weighted(row: number[]): number {
  return (row[1] ?? 0) + (row[2] ?? 0) * 5 + (row[3] ?? 0) * 1.25 + (row[4] ?? 0) * 0.1;
}

export function bucketColumns(buckets: number[][], from: number, to: number, width: number): number[] {
  const slots = new Array(width).fill(0);
  const span = Math.max(1, to - from);
  for (const row of buckets) {
    const at = row[0] ?? 0;
    if (at < from || at > to) continue;
    slots[Math.min(width - 1, Math.floor(((at - from) / span) * width))] += weighted(row);
  }
  return slots;
}

export function rateFrom(series: Series, now: number): number | null {
  const points = series.points.filter((point) => point.at >= series.from && point.at <= now);
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const earlier = points.find((point) => point.at >= (last?.at ?? now) - 45 * 60 * 1000) ?? points[0];
  if (!last || !earlier || last.at <= earlier.at) return null;
  return ((last.value - earlier.value) / (last.at - earlier.at)) * 60 * 60 * 1000;
}

export function elapsedFraction(from: number, to: number, now: number): number {
  return Math.max(0, Math.min(1, (now - from) / Math.max(1, to - from)));
}

export function sparkRow(series: Series, now: number, width: number, theme: Theme, color: boolean): string[] {
  const values = sampleSeries(series, width, now);
  const line = values
    .map((value) => {
      if (value === null || value === undefined) return paint(theme, "track", "·", color);
      return paint(theme, pressureRole(value / 100), BLOCKS[Math.max(1, Math.round((value / 100) * 8))] ?? "▁", color);
    })
    .join("");
  const last = [...values].reverse().find((value) => value !== null) ?? 0;
  return [
    `  ${line}`,
    `  ${paint(theme, "dim", `${clockAt(series.from)} → ${clockAt(series.to)}`, color)}  ${paint(theme, pressureRole(last / 100), percentLabel(last), color)} ${paint(theme, "dim", "of the window", color)}`,
  ];
}

export function gaugeRows(series: Series, now: number, width: number, theme: Theme, color: boolean): string[] {
  const used = series.points[series.points.length - 1]?.value ?? 0;
  const elapsed = elapsedFraction(series.from, series.to, now) * 100;
  const cells = Math.max(20, width - 18);
  const usedCells = Math.round((used / 100) * cells);
  const paceCell = Math.round((elapsed / 100) * cells);
  let bar = "";
  for (let index = 0; index < cells; index++) {
    if (index === paceCell) bar += paint(theme, "accent", "│", color);
    else if (index < usedCells) bar += paint(theme, pressureRole(used / 100), "█", color);
    else bar += paint(theme, "track", "─", color);
  }
  const ahead = used - elapsed;
  return [
    `  ${paint(theme, "dim", "window", color)} ${bar} ${paint(theme, pressureRole(used / 100), percentLabel(used), color)}`,
    `  ${paint(theme, "dim", `${clockAt(series.from)}`, color)}${" ".repeat(Math.max(1, cells - 16))}${paint(theme, "dim", `reset ${clockAt(series.to)}`, color)}`,
    `  ${paint(theme, "accent", "│", color)} ${paint(theme, "dim", `even pace is ${percentLabel(elapsed)} by now — you are ${ahead >= 0 ? `${percentLabel(Math.abs(ahead))} ahead of it` : `${percentLabel(Math.abs(ahead))} behind it`}`, color)}`,
  ];
}

export function segmentRows(series: Series, now: number, width: number, theme: Theme, color: boolean): string[] {
  const used = series.points[series.points.length - 1]?.value ?? 0;
  const elapsed = elapsedFraction(series.from, series.to, now) * 100;
  const segments = Math.max(10, Math.min(40, Math.floor((width - 20) / 2)));
  const filled = Math.round((used / 100) * segments);
  const pace = Math.round((elapsed / 100) * segments);
  const cells: string[] = [];
  for (let index = 0; index < segments; index++) {
    const glyph = index < filled ? "▰" : index === pace ? "▮" : "▱";
    const role = index < filled ? pressureRole(used / 100) : index === pace ? "accent" : "track";
    cells.push(paint(theme, role, glyph, color));
  }
  return [
    `  ${cells.join(" ")}`,
    "",
    `  ${paint(theme, pressureRole(used / 100), `${Math.round(used)}%`, color)} ${paint(theme, "dim", `used · ${segments} segments · ${paint(theme, "accent", "▮", color)} marks even pace · resets ${clockAt(series.to)}`, color)}`,
  ];
}

export function brailleRows(series: Series, now: number, width: number, height: number, theme: Theme, color: boolean): string[] {
  const plot = Math.max(16, width - 6);
  const values = sampleSeries(series, plot * 2, now);
  const dotsHigh = height * 4;
  const grid: number[][] = Array.from({ length: height }, () => new Array(plot).fill(0));

  for (let column = 0; column < plot * 2; column++) {
    const value = values[column];
    if (value === null || value === undefined) continue;
    const level = Math.max(0, Math.min(dotsHigh - 1, Math.round((value / 100) * (dotsHigh - 1))));
    const row = height - 1 - Math.floor(level / 4);
    const dotRow = 3 - (level % 4);
    const x = column % 2;
    const bit = x === 0 ? (dotRow < 3 ? dotRow : 6) : dotRow < 3 ? dotRow + 3 : 7;
    const target = grid[row];
    if (target) target[Math.floor(column / 2)] = (target[Math.floor(column / 2)] ?? 0) | (1 << bit);
  }

  const rows = grid.map((row, index) => {
    const label = index === 0 ? "100%" : index === height - 1 ? "  0%" : "    ";
    const line = row.map((mask) => (mask === 0 ? " " : String.fromCharCode(BRAILLE_BASE + mask))).join("");
    return `${paint(theme, "dim", label, color)} ${paint(theme, "accent", line, color)}`;
  });
  rows.push(`     ${paint(theme, "dim", `${clockAt(series.from)}${" ".repeat(Math.max(1, plot - 16))}reset ${clockAt(series.to)}`, color)}`);
  return rows;
}

export function columnRows(buckets: number[][], from: number, to: number, width: number, height: number, theme: Theme, color: boolean): string[] {
  const plot = Math.max(16, width - 8);
  const slots = bucketColumns(buckets, from, to, plot);
  const peak = Math.max(...slots, 1);
  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    const top = ((row + 1) / height) * peak;
    const bottom = (row / height) * peak;
    let line = "";
    for (const value of slots) {
      if (value >= top) line += paint(theme, "accent", "█", color);
      else if (value > bottom) line += paint(theme, "accent", BLOCKS[Math.max(1, Math.round(((value - bottom) / (top - bottom)) * 8))] ?? "▁", color);
      else line += " ";
    }
    rows.push(`     ${line}`);
  }
  rows.push(`     ${paint(theme, "dim", `${clockAt(from)}${" ".repeat(Math.max(1, plot - 16))}${clockAt(to)}`, color)}`);
  rows.push(`  ${paint(theme, "dim", "tokens burned per slice of this window, all sessions", color)}`);
  return rows;
}

export function stackRows(slices: Slice[], from: number, to: number, width: number, height: number, theme: Theme, color: boolean): string[] {
  const plot = Math.max(16, width - 8);
  const perSlice = slices.map((slice) => ({ label: slice.label, values: bucketColumns(slice.buckets, from, to, plot) }));
  const totals = new Array(plot).fill(0);
  for (const slice of perSlice) for (const [index, value] of slice.values.entries()) totals[index] += value;
  const peak = Math.max(...totals, 1);
  const roles = ["accent", "ok", "warn", "danger", "dim"];

  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    const top = ((row + 1) / height) * peak;
    const bottom = (row / height) * peak;
    let line = "";
    for (let column = 0; column < plot; column++) {
      let stacked = 0;
      let glyph = " ";
      let role = "track";
      for (const [index, slice] of perSlice.entries()) {
        const value = slice.values[column] ?? 0;
        if (value <= 0) continue;
        const next = stacked + value;
        if (next > bottom && stacked < top) {
          glyph = SHADES[index % SHADES.length] ?? "█";
          role = roles[index % roles.length] ?? "dim";
        }
        stacked = next;
      }
      line += glyph === " " ? " " : paint(theme, role, glyph, color);
    }
    rows.push(`     ${line}`);
  }
  rows.push(`     ${paint(theme, "dim", `${clockAt(from)}${" ".repeat(Math.max(1, plot - 16))}${clockAt(to)}`, color)}`);
  rows.push(
    `  ${perSlice
      .slice(0, 5)
      .map((slice, index) => `${paint(theme, roles[index % roles.length] ?? "dim", SHADES[index % SHADES.length] ?? "█", color)} ${paint(theme, "dim", slice.label, color)}`)
      .join("   ")}`,
  );
  return rows;
}

export function paceRows(series: Series, now: number, width: number, theme: Theme, color: boolean): string[] {
  const used = series.points[series.points.length - 1]?.value ?? 0;
  const elapsed = elapsedFraction(series.from, series.to, now) * 100;
  const cells = Math.max(20, width - 24);
  const bar = (value: number, role: string): string => {
    const filled = Math.round((value / 100) * cells);
    return paint(theme, role, "█".repeat(filled), color) + paint(theme, "track", "░".repeat(Math.max(0, cells - filled)), color);
  };
  const verdictText =
    used > elapsed + 5
      ? `burning faster than the clock — ${percentLabel(used - elapsed)} ahead`
      : used < elapsed - 5
        ? `slower than the clock — ${percentLabel(elapsed - used)} in hand`
        : "tracking the clock almost exactly";
  return [
    `  ${paint(theme, "dim", "window used ", color)} ${bar(used, pressureRole(used / 100))} ${percentLabel(used)}`,
    `  ${paint(theme, "dim", "window gone ", color)} ${bar(elapsed, "accent")} ${percentLabel(elapsed)}`,
    "",
    `  ${paint(theme, used > elapsed + 5 ? "warn" : "ok", verdictText, color)} ${paint(theme, "dim", `· resets ${clockAt(series.to)}`, color)}`,
  ];
}

export function heatRows(buckets: number[][], from: number, to: number, width: number, theme: Theme, color: boolean): string[] {
  const plot = Math.max(20, width - 8);
  const slots = bucketColumns(buckets, from, to, plot);
  const peak = Math.max(...slots, 1);
  const strip = slots
    .map((value) => {
      if (value <= 0) return paint(theme, "track", "·", color);
      const level = Math.max(1, Math.min(HEAT.length - 1, Math.round((value / peak) * (HEAT.length - 1))));
      return paint(theme, pressureRole(value / peak), HEAT[level] ?? "█", color);
    })
    .join("");
  return [
    `  ${strip}`,
    `  ${paint(theme, "dim", `${clockAt(from)}${" ".repeat(Math.max(1, plot - 16))}${clockAt(to)}`, color)}`,
    `  ${paint(theme, "dim", "darker means more tokens burned in that slice", color)}`,
  ];
}

const DIGITS: Record<string, string[]> = {
  "0": ["███", "█ █", "█ █", "█ █", "███"],
  "1": ["  █", "  █", "  █", "  █", "  █"],
  "2": ["███", "  █", "███", "█  ", "███"],
  "3": ["███", "  █", "███", "  █", "███"],
  "4": ["█ █", "█ █", "███", "  █", "  █"],
  "5": ["███", "█  ", "███", "  █", "███"],
  "6": ["███", "█  ", "███", "█ █", "███"],
  "7": ["███", "  █", "  █", "  █", "  █"],
  "8": ["███", "█ █", "███", "█ █", "███"],
  "9": ["███", "█ █", "███", "  █", "███"],
  "%": ["█ █", "  █", " █ ", "█  ", "█ █"],
};

export function bigRows(series: Series, now: number, theme: Theme, color: boolean): string[] {
  const used = Math.round(series.points[series.points.length - 1]?.value ?? 0);
  const glyphs = `${used}%`.split("");
  const role = pressureRole(used / 100);
  const rows: string[] = [];
  for (let line = 0; line < 5; line++) {
    rows.push(`   ${glyphs.map((glyph) => paint(theme, role, DIGITS[glyph]?.[line] ?? "   ", color)).join(" ")}`);
  }
  const rate = rateFrom(series, now);
  rows.push("");
  rows.push(
    `  ${paint(theme, "dim", `of the window · resets ${clockAt(series.to)}${rate !== null ? ` · ${Math.round(rate)}%/h right now` : ""}`, color)}`,
  );
  return rows;
}

export function runwayRows(series: Series, now: number, width: number, theme: Theme, color: boolean): string[] {
  const used = series.points[series.points.length - 1]?.value ?? 0;
  const rate = rateFrom(series, now);
  const cells = Math.max(24, width - 20);
  const msLeft = Math.max(0, series.to - now);
  const hoursLeft = msLeft / 3_600_000;
  const hoursToEmpty = rate && rate > 0 ? (100 - used) / rate : Infinity;
  const emptyCell = Number.isFinite(hoursToEmpty) ? Math.round((hoursToEmpty / Math.max(hoursLeft, hoursToEmpty)) * cells) : cells;
  const resetCell = Math.round((hoursLeft / Math.max(hoursLeft, Number.isFinite(hoursToEmpty) ? hoursToEmpty : hoursLeft)) * cells);

  let track = "";
  for (let index = 0; index < cells; index++) {
    if (index === Math.min(emptyCell, cells - 1) && Number.isFinite(hoursToEmpty)) track += paint(theme, "danger", "▼", color);
    else if (index === Math.min(resetCell, cells - 1)) track += paint(theme, "ok", "▼", color);
    else track += paint(theme, "track", "─", color);
  }

  const resetMark = `${paint(theme, "ok", "▼", color)} ${paint(theme, "dim", `resets ${clockAt(series.to)}`, color)}`;
  const emptyMark = Number.isFinite(hoursToEmpty)
    ? `${paint(theme, "danger", "▼", color)} ${paint(theme, "dim", `empty ${clockAt(now + hoursToEmpty * 3_600_000)}`, color)}`
    : `${paint(theme, "ok", "▼", color)} ${paint(theme, "dim", "never empties at this rate", color)}`;
  const ordered = Number.isFinite(hoursToEmpty) && hoursToEmpty < hoursLeft ? [emptyMark, resetMark] : [resetMark, emptyMark];
  const safe = !Number.isFinite(hoursToEmpty) || hoursToEmpty >= hoursLeft;
  return [
    `  ${paint(theme, "dim", "now", color)} ${track}`,
    "",
    `  ${ordered.join("    ")}`,
    `  ${paint(theme, safe ? "ok" : "danger", safe ? "the window resets before you run out" : "you run out before the window resets", color)} ${paint(theme, "dim", `· ${percentLabel(used)} used${rate !== null ? ` · ${Math.round(rate)}%/h` : ""}`, color)}`,
  ];
}

export function asciiBar(ratio: number, width: number, theme: Theme, color: boolean, role: string): string {
  const cells = Math.max(6, width);
  const over = ratio > 1;
  const filled = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, ratio)) * cells)));
  const body = over
    ? paint(theme, "danger", "|".repeat(cells - 1) + "»", color)
    : paint(theme, role, "|".repeat(filled), color) + paint(theme, "track", ".".repeat(cells - filled), color);
  return `${paint(theme, "dim", "[", color)}${body}${paint(theme, "dim", "]", color)}`;
}

export function blockBar(ratio: number, width: number, theme: Theme, color: boolean, role: string): string {
  const cells = Math.max(6, width);
  if (ratio > 1) return paint(theme, "danger", "▰".repeat(cells - 1) + "▶", color);
  const filled = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, ratio)) * cells)));
  return paint(theme, role, "▰".repeat(filled), color) + paint(theme, "track", "▱".repeat(cells - filled), color);
}

export function markerBar(used: number, target: number, width: number, theme: Theme, color: boolean, role: string): string {
  const cells = Math.max(8, width);
  const usedCells = Math.round(Math.max(0, Math.min(1, used)) * cells);
  const targetCell = Math.round(Math.max(0, Math.min(1, target)) * cells);
  let out = "";
  for (let index = 0; index < cells; index++) {
    if (index === targetCell - 1 && targetCell > 0) out += paint(theme, "accent", index < usedCells ? "┃" : "╵", color);
    else if (index < usedCells) out += paint(theme, role, "█", color);
    else out += paint(theme, "track", "░", color);
  }
  return out;
}

export function twinBar(used: number, target: number, width: number, theme: Theme, color: boolean, role: string): string {
  const half = Math.max(5, Math.floor(width / 2) - 1);
  const fill = (value: number, glyph: string, cellRole: string): string => {
    const filled = Math.round(Math.max(0, Math.min(1, value)) * half);
    return paint(theme, cellRole, glyph.repeat(filled), color) + paint(theme, "track", "·".repeat(Math.max(0, half - filled)), color);
  };
  return `${fill(target, "▪", "accent")} ${paint(theme, "dim", "│", color)} ${fill(used, "▪", role)}`;
}
