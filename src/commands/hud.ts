import type { Options } from "../cli-options.js";
import {
  HUD_LAYOUTS,
  builtinThemes,
  loadConfig,
  loadTheme,
  renderHud,
  saveConfig,
  userThemes,
  windowBounds,
  type HudView,
} from "../runtime/kernel.mjs";
import { buildPlan } from "../scheduler/plan.js";
import { bold, colorEnabled, dim, green, padEndVisible } from "../util/ansi.js";

function sampleView(options: Options): HudView {
  const control = buildPlan(Date.now(), true, options.window, options.adapter);
  const now = control.schedule.now;
  const bounds = windowBounds(control.schedule.quota, "five_hour", now);
  const live = control.schedule.claimants.find((view) => view.state === "active") ?? control.schedule.claimants[0];
  const quota: HudView["quota"] = {};
  for (const key of ["five_hour", "seven_day", "spend_limit"] as const) {
    const window = control.schedule.quota?.windows?.[key];
    if (window && (typeof window.resetsAt !== "number" || window.resetsAt * 1000 > now)) quota[key] = window;
  }
  const history = (control.schedule.quota?.history ?? [])
    .filter((point) => typeof point.five_hour === "number" && point.at >= bounds.from)
    .map((point) => point.five_hour as number);

  return {
    label: live?.claimant.label || "session",
    target: live?.allocation.target ?? 1,
    observed: live?.observed ?? 0,
    used: live?.attributedPercent ?? null,
    pressure: live?.pressure.value ?? 0,
    priority: live?.claimant.priority ?? "normal",
    quota,
    history,
    rate: null,
    from: bounds.from,
    to: bounds.to,
    now,
  };
}

export function runHud(options: Options): void {
  const config = loadConfig();
  const [first, second] = options.args;

  if (first && HUD_LAYOUTS.includes(first)) {
    config.layout.hud = first;
    if (second) config.theme.hud = second;
    saveConfig(config);
    process.stdout.write(`\n${green("Status line")} ${bold(first)}${second ? ` · theme ${bold(second)}` : ""}\n\n`);
    return;
  }
  if (first) {
    process.stdout.write(`\nNo layout called ${bold(first)}. Known: ${HUD_LAYOUTS.join(", ")}\n\n`);
    process.exitCode = 1;
    return;
  }

  const view = sampleView(options);
  const themeName = config.theme.hud;
  const theme = loadTheme(themeName);
  const out = ["", bold("Status line layouts"), dim("  what Claude Code shows you, on your own numbers"), ""];

  for (const layout of HUD_LAYOUTS) {
    const marker = layout === config.layout.hud ? green("→") : " ";
    out.push(`  ${marker} ${dim(padEndVisible(layout, 11))} ${renderHud(layout, view, theme, colorEnabled)}`);
  }

  out.push("");
  out.push(bold("The same layout in every theme"));
  out.push("");
  const themes = [...new Set([...builtinThemes(), ...userThemes()])];
  for (const name of themes) {
    const marker = name === themeName ? green("→") : " ";
    out.push(`  ${marker} ${dim(padEndVisible(name, 11))} ${renderHud(config.layout.hud, view, loadTheme(name), colorEnabled)}`);
  }

  out.push("");
  out.push(dim("  npx savemytokens hud blocks          set the layout"));
  out.push(dim("  npx savemytokens hud blocks nord     layout and theme together"));
  out.push(dim("  npx savemytokens theme hud dracula   theme only"));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}
