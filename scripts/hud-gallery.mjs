import { loadTheme, paint } from "../dist/runtime/kernel.mjs";

const theme = loadTheme(process.argv[2] ?? "default");
const on = process.env.NO_COLOR === undefined;

const SHARE = 0.42;
const FIVE = 0.42;
const SEVEN = 0.18;
const RESET = "3h52";
const PROJECT = "webinvoke";

const dim = (t) => paint(theme, "dim", t, on);
const track = (t) => paint(theme, "track", t, on);
const ok = (t) => paint(theme, "ok", t, on);
const warn = (t) => paint(theme, "warn", t, on);
const accent = (t) => paint(theme, "accent", t, on);
const fg = (t) => paint(theme, "fg", t, on);
const role = (value) => (value >= 0.9 ? warn : value >= 0.8 ? warn : ok);

function bar(value, width, full, empty, painter = null) {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  const paintFilled = painter ?? role(value);
  return paintFilled(full.repeat(filled)) + track(empty.repeat(width - filled));
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

function fineBar(value, width, painter = null) {
  const exact = Math.max(0, Math.min(width, value * width));
  const whole = Math.floor(exact);
  const rest = EIGHTHS[Math.floor((exact - whole) * 8)] ?? "";
  const paintFilled = painter ?? role(value);
  const head = paintFilled("█".repeat(whole) + rest);
  const pad = width - whole - (rest ? 1 : 0);
  return head + track("░".repeat(Math.max(0, pad)));
}

function nested(share, window, width) {
  const mine = Math.round(share * width);
  const theirs = Math.max(0, Math.round(window * width) - mine);
  return role(share)("█".repeat(mine)) + dim("▒".repeat(theirs)) + track("░".repeat(Math.max(0, width - mine - theirs)));
}

const VARIANTS = [
  ["one bar, block", () => `${bar(SHARE, 10, "█", "░")} ${dim("21%/50%")} ${dim("· 5h")} ${dim("42%")}`],
  ["one bar, fine", () => `${fineBar(SHARE, 10)} ${dim("21%/50%")} ${dim("· 5h 42% · in " + RESET)}`],
  ["one bar, thin rule", () => `${bar(SHARE, 12, "━", "─")} ${dim("21%/50%")} ${dim("· 5h 42%")}`],
  ["one bar, pips", () => `${bar(SHARE, 8, "▰", "▱")} ${dim("21%/50%")} ${dim("· 5h 42% · in " + RESET)}`],
  ["one bar, braille", () => `${bar(SHARE, 8, "⣿", "⣀")} ${dim("21%/50%")} ${dim("· 5h 42%")}`],
  ["one bar, ticks", () => `${bar(SHARE, 10, "▮", "▯")} ${dim("21%/50%")} ${dim("· 5h 42%")}`],
  ["one bar, dots", () => `${bar(SHARE, 12, "•", "·")} ${dim("21%/50%")} ${dim("· 5h 42%")}`],
  ["one bar, no numbers", () => `${bar(SHARE, 14, "█", "░")} ${dim("of your 50%")}`],

  ["two bars, labelled", () => `${dim("you")} ${bar(SHARE, 8, "█", "░")} ${dim("5h")} ${bar(FIVE, 8, "█", "░")} ${dim("in " + RESET)}`],
  ["two bars, bare", () => `${bar(SHARE, 9, "█", "░")} ${track("│")} ${bar(FIVE, 9, "█", "░")} ${dim("in " + RESET)}`],
  ["two bars, numbers after", () => `${bar(SHARE, 8, "█", "░")} ${dim("21%")}  ${bar(FIVE, 8, "█", "░")} ${dim("42%")}`],
  ["two bars, thin", () => `${bar(SHARE, 10, "━", "─")} ${dim("you")}  ${bar(FIVE, 10, "━", "─")} ${dim("5h")}`],
  ["two bars, pips", () => `${bar(SHARE, 7, "▰", "▱")} ${bar(FIVE, 7, "▰", "▱")} ${dim("21%/50% · 5h 42%")}`],

  ["three bars, labelled", () => `${dim("you")} ${bar(SHARE, 7, "█", "░")} ${dim("5h")} ${bar(FIVE, 7, "█", "░")} ${dim("7d")} ${bar(SEVEN, 7, "█", "░")}`],
  ["three bars, bare", () => `${bar(SHARE, 7, "█", "░")}${track(" ")}${bar(FIVE, 7, "█", "░")}${track(" ")}${bar(SEVEN, 7, "█", "░")} ${dim("in " + RESET)}`],
  ["three bars, thin", () => `${bar(SHARE, 8, "━", "─")} ${bar(FIVE, 8, "━", "─")} ${bar(SEVEN, 8, "━", "─")} ${dim("you · 5h · 7d")}`],

  ["nested: you inside the window", () => `${nested(0.21, FIVE, 16)} ${dim("you 21% of 42% used · in " + RESET)}`],
  ["nested, with target mark", () => `${nested(0.21, FIVE, 14)}${dim("┃")} ${dim("target 50% · in " + RESET)}`],
  ["window bar, share as text", () => `${bar(FIVE, 14, "█", "░")} ${dim("5h · you " + "21%/50%")}`],
  ["bar with reset countdown inline", () => `${bar(FIVE, 12, "█", "░")} ${dim("42%")} ${track("│")} ${dim(RESET + " left")}`],
  ["project first, then bar", () => `${dim(PROJECT)} ${bar(SHARE, 10, "█", "░")} ${dim("21%/50%")}`],
  ["all muted, one accent", () => `${accent("▎")}${bar(SHARE, 11, "█", "░")} ${dim("21%/50% · 5h 42% · in " + RESET)}`],
];

const width = Math.max(...VARIANTS.map(([name]) => name.length));
process.stdout.write(`\n  ${fg("SaveMyTokens status line")} ${dim(`· theme ${theme.name ?? "default"} · session at 21% of a 50% target, 5h at 42%, 7d at 18%`)}\n\n`);
for (const [at, [name, render]] of VARIANTS.entries()) {
  process.stdout.write(`  ${dim(String(at + 1).padStart(2))} ${dim(name.padEnd(width))}  ${render()}\n`);
}
process.stdout.write(`\n  ${dim("try another theme:")} node scripts/hud-gallery.mjs nord\n\n`);
