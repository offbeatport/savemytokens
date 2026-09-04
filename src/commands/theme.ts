import fs from "node:fs";
import path from "node:path";
import {
  HUD_LAYOUTS,
  THEME_DIR,
  builtinThemes,
  loadConfig,
  loadTheme,
  saveConfig,
  userThemes,
  writeJson,
} from "../runtime/kernel.mjs";
import { bold, dim, green, red } from "../util/ansi.js";

const LAYOUTS = HUD_LAYOUTS;

function scaffold(name: string, from: string): void {
  if (!name) {
    process.stdout.write(`\nName it: ${bold("npx savemytokens theme new midnight")}\n\n`);
    process.exitCode = 1;
    return;
  }
  const file = path.join(THEME_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    process.stdout.write(`\n${file} already exists.\n\n`);
    process.exitCode = 1;
    return;
  }
  const base = loadTheme(from);
  writeJson(file, { ...base, name });
  fs.writeFileSync(file, JSON.stringify({ ...base, name }, null, 2) + "\n");
  process.stdout.write(
    `\n${green("Wrote")} ${file}\n${dim(`  edit it, then: npx savemytokens theme check ${name} && npx savemytokens theme tui ${name}`)}\n\n`,
  );
}

const TEXT_ROLES = ["fg", "accent", "ok", "warn", "danger"];
const REQUIRED_TUI = ["cursor", "pin", "active", "done", "blocked", "idle", "fill", "empty", "over", "meter", "track"];

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(hex: string, background: string): number | null {
  const first = luminance(hex);
  const second = luminance(background);
  if (first === null || second === null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function check(name: string, background: string): void {
  const known = new Set([...builtinThemes(), ...userThemes()]);
  if (!known.has(name)) {
    process.stdout.write(`\nNo theme called ${bold(name)}. Known: ${[...known].join(", ")}\n\n`);
    process.exitCode = 1;
    return;
  }
  const theme = loadTheme(name);
  const out = ["", bold(`theme ${name}`), dim(`  measured against ${background}`), ""];
  let problems = 0;

  for (const [role, value] of Object.entries(theme.colors)) {
    const ratio = contrast(String(value), background);
    if (ratio === null) {
      out.push(`  ${red("✗")} ${role.padEnd(8)} ${value} ${dim("is not a #rrggbb colour")}`);
      problems++;
      continue;
    }
    const floor = TEXT_ROLES.includes(role) ? 4.5 : role === "dim" ? 2.5 : 1.15;
    const ceiling = role === "track" ? 4 : Infinity;
    const ok = ratio >= floor && ratio <= ceiling;
    if (!ok) problems++;
    out.push(
      `  ${ok ? green("✓") : red("✗")} ${role.padEnd(8)} ${String(value).padEnd(9)} ${ratio.toFixed(1)}:1 ${dim(ok ? "" : ratio < floor ? `wants at least ${floor}:1` : `wants at most ${ceiling}:1`)}`,
    );
  }

  const missing = REQUIRED_TUI.filter((key) => !(theme.tui ?? {})[key]);
  if (missing.length > 0) {
    out.push("");
    out.push(`  ${dim(`inherits ${missing.join(", ")} from the default theme`)}`);
  }

  out.push("");
  out.push(problems === 0 ? green("  Readable everywhere.") : red(`  ${problems} ${problems === 1 ? "problem" : "problems"} to fix.`));
  out.push(dim("  --light checks against a white terminal instead"));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
  if (problems > 0) process.exitCode = 1;
}

export function runTheme(args: string[]): void {
  const config = loadConfig();
  const surface = args[0];
  const value = args[1];

  if (surface === "new") {
    scaffold(String(value ?? ""), String(args[2] ?? config.theme.tui));
    return;
  }

  if (surface === "check") {
    const light = args.includes("--light");
    check(String(value ?? config.theme.tui), light ? "#ffffff" : "#1e1e1e");
    return;
  }

  const target: "tui" | "hud" | null = surface === "tui" || surface === "hud" ? surface : null;
  if (surface && !target) {
    process.stderr.write(`\nNo theme surface called ${surface}. Use: theme tui <name>, theme hud <name>, theme check, theme new\n\n`);
    process.exitCode = 1;
    return;
  }

  if (!surface) {
    const out = ["", bold("SaveMyTokens themes"), ""];
    out.push(`  tui   ${config.theme.tui}`);
    out.push(`  hud   ${config.theme.hud} ${dim(`· layout ${config.layout.hud}`)}`);
    out.push("");
    out.push(dim(`  built in: ${builtinThemes().join(", ")}`));
    const custom = userThemes().filter((name) => !builtinThemes().includes(name));
    if (custom.length > 0) out.push(dim(`  yours: ${custom.join(", ")}`));
    out.push(dim(`  hud layouts: ${LAYOUTS.join(", ")}`));
    out.push("");
    out.push(dim("  npx savemytokens theme tui nord           use it in the control centre"));
    out.push(dim("  npx savemytokens theme new mine nord      copy one to start from"));
    out.push(dim("  npx savemytokens theme check mine         is it readable?"));
    out.push(dim("  they live in ~/.savemytokens/themes/<name>.json"));
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  if (!value) {
    process.stdout.write(`\n  ${target} theme is ${config.theme[target ?? "tui"]}\n\n`);
    return;
  }

  if (target === "hud" && LAYOUTS.includes(value)) {
    config.layout.hud = value;
    saveConfig(config);
    process.stdout.write(`\n${green("Set")} hud layout to ${bold(value)}\n\n`);
    return;
  }

  const known = new Set([...builtinThemes(), ...userThemes()]);
  if (!known.has(value)) {
    process.stdout.write(`\nNo theme called ${bold(value)}. Known: ${[...known].join(", ")}\n\n`);
    process.exitCode = 1;
    return;
  }

  config.theme[target ?? "tui"] = value;
  saveConfig(config);
  process.stdout.write(`\n${green("Set")} ${target} theme to ${bold(value)}\n\n`);
}
