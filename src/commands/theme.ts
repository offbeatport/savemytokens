import { builtinThemes, loadConfig, saveConfig, userThemes } from "../runtime/kernel.mjs";
import { bold, dim, green } from "../util/ansi.js";

const LAYOUTS = ["compact", "allocation", "global"];

export function runTheme(args: string[]): void {
  const config = loadConfig();
  const surface = args[0];
  const value = args[1];

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
