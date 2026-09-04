import type { Options } from "../cli-options.js";
import { ADAPTER_ID } from "../adapters/claude-code/provider.js";
import { renderSchedule } from "../report/schedule.js";
import {
  activeViews,
  buildPlan,
  cyclePriority,
  equalize,
  savePreference,
  setPriority,
  setShare,
  setState,
  type ControlPlan,
} from "../scheduler/plan.js";
import { CONFIG_FILE, loadConfig, loadTheme, paint, readJson } from "../runtime/kernel.mjs";
import { colorEnabled } from "../util/ansi.js";

const REFRESH_MS = 2500;
const STEP = 0.05;
const PRESERVE_KINDS = ["implementation", "tests", "end-to-end checks", "documentation", "exploration"];
const DEFAULT_PRESERVE = [0, 1];

const ALT_ON = "\u001b[?1049h";
const ALT_OFF = "\u001b[?1049l";
const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const CLEAR = "\u001b[2J\u001b[H";

function snapshot(control: ControlPlan, interactive: boolean, selected: number): string {
  return renderSchedule(control, {
    theme: loadTheme(control.config.theme.tui),
    color: colorEnabled,
    interactive,
    selected,
    columns: process.stdout.columns ?? 100,
  });
}

function toJson(control: ControlPlan): string {
  return JSON.stringify(
    {
      generatedAt: control.schedule.now,
      window: control.schedule.bounds,
      resources: control.resources,
      unusedPool: control.schedule.unusedPool,
      unattributedPercent: control.unattributed,
      claimants: control.schedule.claimants.map((view) => ({
        id: view.claimant.id,
        label: view.claimant.label,
        project: view.claimant.project,
        state: view.state,
        priority: view.claimant.priority,
        target: view.allocation.target,
        pinned: view.allocation.pinned,
        observed: view.observed,
        attributedPercent: view.attributedPercent,
        pressure: view.pressure,
        tokens: view.usage.tokens,
        weighted: view.usage.weighted,
        prompt: view.claimant.prompt,
        stale: view.stale,
      })),
    },
    null,
    2,
  );
}

function preferencesScreen(selected: Set<number>): string {
  const theme = loadTheme(loadConfig().theme.tui);
  const color = colorEnabled;
  const out = ["", `  ${paint(theme, "accent", "SaveMyTokens", color)}`, ""];
  out.push("  When your Claude window gets tight, what should be preserved?");
  out.push("");
  for (const [index, kind] of PRESERVE_KINDS.entries()) {
    const mark = selected.has(index) ? paint(theme, "ok", "x", color) : " ";
    out.push(`    ${index + 1} [${mark}] ${kind}`);
  }
  out.push("");
  out.push(`  ${paint(theme, "dim", "1-5 toggle   enter save   esc skip", color)}`);
  out.push("");
  return out.join("\n");
}

export async function runControl(options: Options): Promise<void> {
  const control = buildPlan();

  if (options.json) {
    process.stdout.write(`${toJson(control)}\n`);
    return;
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY || options.command === "status") {
    process.stdout.write(`${snapshot(control, false, -1)}\n`);
    return;
  }

  const firstRun = readJson<unknown>(CONFIG_FILE, null) === null;
  let mode: "prefs" | "plan" = firstRun ? "prefs" : "plan";
  const chosen = new Set(DEFAULT_PRESERVE);
  let current = control;
  let selected = 0;

  const stdin = process.stdin;
  try {
    stdin.setRawMode(true);
  } catch {
    process.stdout.write(`${snapshot(control, false, -1)}\n`);
    return;
  }
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(ALT_ON + HIDE);

  const draw = (): void => {
    const frame = mode === "prefs" ? preferencesScreen(chosen) : snapshot(current, true, selected);
    process.stdout.write(CLEAR + frame);
  };

  const refresh = (): void => {
    current = buildPlan();
    const count = current.schedule.claimants.length;
    if (selected >= count) selected = Math.max(0, count - 1);
    if (mode === "plan") draw();
  };

  const stop = (): void => {
    clearInterval(timer);
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write(SHOW + ALT_OFF);
  };

  const rows = () => activeViews(current.schedule);

  const adjust = (delta: number): void => {
    const view = rows()[selected];
    if (!view) return;
    setShare(view.claimant.id, Math.max(0, Math.min(1, view.allocation.target + delta)));
    refresh();
  };

  const timer = setInterval(refresh, REFRESH_MS);
  draw();

  await new Promise<void>((resolve) => {
    stdin.on("data", (chunk: string) => {
      const key = String(chunk);

      if (mode === "prefs") {
        if (key === "\r" || key === "\n") {
          savePreference(process.cwd(), [...chosen].sort().map((index) => PRESERVE_KINDS[index] ?? ""));
          savePreference("default", [...chosen].sort().map((index) => PRESERVE_KINDS[index] ?? ""));
          mode = "plan";
          refresh();
          draw();
          return;
        }
        if (key === "\u001b" || key === "q" || key === "\u0003") {
          savePreference("default", DEFAULT_PRESERVE.map((index) => PRESERVE_KINDS[index] ?? ""));
          mode = "plan";
          draw();
          if (key === "\u0003") {
            stop();
            resolve();
          }
          return;
        }
        const index = Number(key) - 1;
        if (index >= 0 && index < PRESERVE_KINDS.length) {
          if (chosen.has(index)) chosen.delete(index);
          else chosen.add(index);
          draw();
        }
        return;
      }

      const view = rows()[selected];
      if (key === "q" || key === "\u0003") {
        stop();
        resolve();
        return;
      }
      if (key === "\u001b[A") selected = Math.max(0, selected - 1);
      else if (key === "\u001b[B") selected = Math.min(Math.max(0, rows().length - 1), selected + 1);
      else if (key === "\u001b[C") return adjust(STEP);
      else if (key === "\u001b[D") return adjust(-STEP);
      else if (key === "p" && view) {
        setPriority(view.claimant.id, cyclePriority(view.claimant.priority));
        return refresh();
      } else if (key === "e") {
        equalize();
        return refresh();
      } else if (key === "d" && view) {
        setState(view.claimant.id, "done");
        return refresh();
      } else if (key === "b" && view) {
        setState(view.claimant.id, "blocked");
        return refresh();
      } else if (key === "a" && view) {
        setState(view.claimant.id, "active");
        return refresh();
      } else if (key === "r") {
        return refresh();
      }
      draw();
    });
  });
}

export { ADAPTER_ID };
