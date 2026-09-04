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

const BLOCKS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const HEAT = [" ", "░", "▒", "▓", "█"];

export function columns(series: Series, width: number, until = Infinity): Array<number | null> {
  const out: Array<number | null> = new Array(width).fill(null);
  const span = Math.max(1, series.to - series.from);
  const lastColumn = Number.isFinite(until)
    ? Math.min(width - 1, Math.floor(((until - series.from) / span) * width))
    : width - 1;
  for (const point of series.points) {
    if (point.at < series.from || point.at > series.to) continue;
    const index = Math.min(width - 1, Math.floor(((point.at - series.from) / span) * width));
    out[index] = point.value;
  }
  let carried: number | null = null;
  for (let index = 0; index <= lastColumn; index++) {
    const value = out[index];
    if (value === null || value === undefined) out[index] = carried;
    else carried = value;
  }
  return out;
}

export function projection(series: Series, now: number): { rate: number; atReset: number } | null {
  const points = series.points.filter((point) => point.at >= series.from && point.at <= now);
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const window = 45 * 60 * 1000;
  const earlier = points.find((point) => point.at >= (last?.at ?? now) - window) ?? points[0];
  if (!last || !earlier || last.at <= earlier.at) return null;
  const rate = ((last.value - earlier.value) / (last.at - earlier.at)) * 60 * 60 * 1000;
  const hoursLeft = Math.max(0, (series.to - now) / (60 * 60 * 1000));
  return { rate, atReset: last.value + rate * hoursLeft };
}

function clockAt(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function burnChart(
  series: Series,
  now: number,
  width: number,
  height: number,
  theme: Theme,
  color: boolean,
): string[] {
  const plotWidth = Math.max(12, width - 6);
  const values = columns(series, plotWidth, now);
  const forecast = projection(series, now);
  const nowIndex = Math.min(
    plotWidth - 1,
    Math.floor(((now - series.from) / Math.max(1, series.to - series.from)) * plotWidth),
  );
  const last = [...values].reverse().find((value) => value !== null) ?? 0;

  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    const top = ((row + 1) / height) * 100;
    const bottom = (row / height) * 100;
    const label = row === height - 1 ? "100%" : row === 0 ? "  0%" : row === Math.floor(height / 2) ? " 50%" : "    ";
    let line = "";
    for (let index = 0; index < plotWidth; index++) {
      const value = values[index];
      if (value === null || value === undefined) {
        if (index > nowIndex && forecast) {
          const share = index / Math.max(1, plotWidth - 1);
          const projected = last + (forecast.atReset - last) * ((share * plotWidth - nowIndex) / Math.max(1, plotWidth - nowIndex));
          line += projected >= bottom && projected < top + (100 / height) ? paint(theme, "dim", "┈", color) : " ";
        } else {
          line += " ";
        }
        continue;
      }
      if (value >= top) {
        line += paint(theme, pressureRole(value / 100), "█", color);
      } else if (value > bottom) {
        const fraction = (value - bottom) / (top - bottom);
        const glyph = BLOCKS[Math.max(1, Math.round(fraction * 8))] ?? "▁";
        line += paint(theme, pressureRole(value / 100), glyph, color);
      } else {
        line += " ";
      }
    }
    rows.push(`${paint(theme, "dim", label, color)} ${line}`);
  }

  const axis = `     ${paint(theme, "dim", clockAt(series.from).padEnd(Math.max(1, plotWidth - 10)) + `reset ${clockAt(series.to)}`, color)}`;
  rows.push(axis);
  return rows;
}

export function verdict(series: Series, now: number, theme: Theme, color: boolean): string {
  const forecast = projection(series, now);
  if (!forecast) return paint(theme, "dim", "not enough readings yet — the line fills in as you work", color);
  const atReset = Math.round(forecast.atReset);
  const rate = forecast.rate;
  if (rate <= 0.5) {
    return paint(theme, "ok", `flat — barely burning; on this rate the window ends near ${Math.max(0, atReset)}%`, color);
  }
  if (forecast.atReset >= 100) {
    const last = series.points[series.points.length - 1];
    const remaining = last ? ((100 - last.value) / rate) * 60 : 0;
    const out = new Date(now + remaining * 60 * 1000);
    return paint(
      theme,
      "danger",
      `${Math.round(rate)}%/h — at this rate you run out at ${clockAt(out.getTime())}, before the reset`,
      color,
    );
  }
  return paint(
    theme,
    atReset > 85 ? "warn" : "ok",
    `${Math.round(rate)}%/h — at this rate the window ends at ${atReset}%`,
    color,
  );
}

export function dualBar(target: number, used: number, width: number, theme: Theme, color: boolean): string {
  const cells = Math.max(6, width);
  const usedCells = Math.round(Math.max(0, Math.min(1, used)) * cells);
  const targetCell = Math.round(Math.max(0, Math.min(1, target)) * cells);
  let out = "";
  for (let index = 0; index < cells; index++) {
    if (index === targetCell - 1 && targetCell > 0) {
      out += paint(theme, "accent", index < usedCells ? "┃" : "╵", color);
    } else if (index < usedCells) {
      out += paint(theme, pressureRole(target > 0 ? used / target : 0), "█", color);
    } else {
      out += paint(theme, "track", "░", color);
    }
  }
  return out;
}

export function heatStrip(buckets: number[][], from: number, to: number, width: number, theme: Theme, color: boolean): string {
  const slots = new Array(width).fill(0);
  const span = Math.max(1, to - from);
  let peak = 0;
  for (const row of buckets) {
    const at = row[0] ?? 0;
    if (at < from || at > to) continue;
    const weighted = (row[1] ?? 0) + (row[2] ?? 0) * 5 + (row[3] ?? 0) * 1.25 + (row[4] ?? 0) * 0.1;
    const index = Math.min(width - 1, Math.floor(((at - from) / span) * width));
    slots[index] += weighted;
    if (slots[index] > peak) peak = slots[index];
  }
  return slots
    .map((value) => {
      if (peak <= 0 || value <= 0) return paint(theme, "track", HEAT[0] ?? " ", color);
      const level = Math.max(1, Math.min(HEAT.length - 1, Math.round((value / peak) * (HEAT.length - 1))));
      return paint(theme, pressureRole(value / peak), HEAT[level] ?? "█", color);
    })
    .join("");
}

export function miniSpark(buckets: number[][], from: number, to: number, width: number): string {
  const slots = new Array(width).fill(0);
  const span = Math.max(1, to - from);
  for (const row of buckets) {
    const at = row[0] ?? 0;
    if (at < from || at > to) continue;
    const weighted = (row[1] ?? 0) + (row[2] ?? 0) * 5 + (row[3] ?? 0) * 1.25 + (row[4] ?? 0) * 0.1;
    slots[Math.min(width - 1, Math.floor(((at - from) / span) * width))] += weighted;
  }
  const peak = Math.max(...slots, 0);
  if (peak <= 0) return " ".repeat(width);
  return slots.map((value) => BLOCKS[Math.max(0, Math.min(8, Math.round((value / peak) * 8)))] ?? " ").join("");
}

export function percentLabel(value: number, width = 4): string {
  return padStartVisible(`${Math.round(value)}%`, width);
}
