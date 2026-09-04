import { paint, pressureRole, type Theme } from "../runtime/kernel.mjs";
import { padStartVisible } from "../util/ansi.js";

const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const HEAT = [" ", "░", "▒", "▓", "█"];

export function percentLabel(value: number, width = 4): string {
  if (!Number.isFinite(value)) return padStartVisible("—", width);
  const rounded = Math.round(value);
  return padStartVisible(rounded > 999 ? ">999%" : `${rounded}%`, width);
}

export function weighted(row: number[]): number {
  return (row[1] ?? 0) + (row[2] ?? 0) * 5 + (row[3] ?? 0) * 1.25 + (row[4] ?? 0) * 0.1;
}

export function smallBar(ratio: number, width: number, theme: Theme, color: boolean, role: string): string {
  const cells = Math.max(4, width);
  const glyphs = theme.tui ?? {};
  const fill = glyphs.fill ?? "|";
  const empty = glyphs.empty ?? ".";
  const open = glyphs.open ? paint(theme, "dim", glyphs.open, color) : "";
  const close = glyphs.close ? paint(theme, "dim", glyphs.close, color) : "";
  if (ratio > 1) return `${open}${paint(theme, "danger", fill.repeat(cells - 1) + (glyphs.over ?? "»"), color)}${close}`;
  const filled = Math.max(0, Math.min(cells, Math.round(Math.max(0, ratio) * cells)));
  return `${open}${paint(theme, role, fill.repeat(filled), color)}${paint(theme, "track", empty.repeat(cells - filled), color)}${close}`;
}

export function emptyBar(width: number, theme: Theme, color: boolean): string {
  const glyphs = theme.tui ?? {};
  const open = glyphs.open ?? "";
  const close = glyphs.close ?? "";
  return paint(theme, "dim", `${open}${(glyphs.empty ?? ".").repeat(Math.max(4, width))}${close}`, color);
}

function slotsFor(buckets: number[][], from: number, to: number, width: number): number[] {
  const slots = new Array(width).fill(0);
  const span = Math.max(1, to - from);
  for (const row of buckets) {
    const at = row[0] ?? 0;
    if (at < from || at > to) continue;
    slots[Math.min(width - 1, Math.floor(((at - from) / span) * width))] += weighted(row);
  }
  return slots;
}

export function heatStrip(buckets: number[][], from: number, to: number, width: number, theme: Theme, color: boolean): string {
  const slots = slotsFor(buckets, from, to, width);
  const peak = Math.max(...slots, 0);
  return slots
    .map((value) => {
      if (peak <= 0 || value <= 0) return paint(theme, "track", "·", color);
      const level = Math.max(1, Math.min(HEAT.length - 1, Math.round((value / peak) * (HEAT.length - 1))));
      return paint(theme, pressureRole(value / peak), HEAT[level] ?? "█", color);
    })
    .join("");
}

export function miniSpark(buckets: number[][], from: number, to: number, width: number): string {
  const slots = slotsFor(buckets, from, to, width);
  const peak = Math.max(...slots, 0);
  if (peak <= 0) return " ".repeat(width);
  return slots.map((value) => BLOCKS[Math.max(0, Math.min(8, Math.round((value / peak) * 8)))] ?? " ").join("");
}
