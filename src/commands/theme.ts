import fs from "node:fs";
import path from "node:path";
import { THEME_DIR, builtinThemes, loadConfig, loadTheme, saveConfig, userThemes, writeJson } from "../runtime/kernel.mjs";
import { bold, dim, green } from "../util/ansi.js";

const LAYOUTS = ["compact", "allocation", "global"];

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
  process.stdout.write(`\n${green("Wrote")} ${file}\n${dim(`  edit it, then: npx savemytokens theme tui ${name}`)}\n\n`);
}

export function runTheme(args: string[]): void {
  const config = loadConfig();
  const surface = args[0];
  const value = args[1];

  if (surface === "new") {
    scaffold(String(value ?? ""), String(args[2] ?? config.theme.tui));
    return;
  }

  if (!surface || (surface !== "tui" && surface !== "hud")) {
    const out = ["", bold("SaveMyTokens themes"), ""];
    out.push(`  tui   ${config.theme.tui}`);
    out.push(`  hud   ${config.theme.hud} ${dim(`· layout ${config.layout.hud}`)}`);
    out.push("");
    out.push(dim(`  built in: ${builtinThemes().join(", ")}`));
    const custom = userThemes().filter((name) => !builtinThemes().includes(name));
    if (custom.length > 0) out.push(dim(`  yours: ${custom.join(", ")}`));
    out.push(dim(`  hud layouts: ${LAYOUTS.join(", ")}`));
    out.push("");
    out.push(dim("  npx savemytokens theme tui nord"));
    out.push(dim("  npx savemytokens theme hud compact"));
    out.push(dim("  drop your own in ~/.savemytokens/themes/<name>.json"));
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  if (!value) {
    process.stdout.write(`\n  ${surface} theme is ${config.theme[surface]}\n\n`);
    return;
  }

  if (surface === "hud" && LAYOUTS.includes(value)) {
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

  config.theme[surface] = value;
  saveConfig(config);
  process.stdout.write(`\n${green("Set")} ${surface} theme to ${bold(value)}\n\n`);
}
