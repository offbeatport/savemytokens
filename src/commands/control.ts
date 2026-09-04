import type { Options } from "../cli-options.js";
import { renderSchedule } from "../report/schedule.js";
import { keyActions, type Action } from "../scheduler/keys.js";
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
import { loadConfig, loadTheme, paint } from "../runtime/kernel.mjs";
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
      window: { key: control.schedule.key, ...control.schedule.bounds },
      resources: control.resources,
      enforcement: control.enforcement,
      unusedPool: control.schedule.unusedPool,
      unattributedPercent: control.unattributed,
      deferred: control.deferred,
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
  const control = buildPlan(Date.now(), true, options.window, options.adapter);

  if (options.json) {
    process.stdout.write(`${toJson(control)}\n`);
    return;
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY || options.command === "status") {
    process.stdout.write(`${snapshot(control, false, -1)}\n`);
    return;
  }

  const stdin = process.stdin;
  try {
    stdin.setRawMode(true);
  } catch {
    process.stdout.write(`${snapshot(control, false, -1)}\n`);
    return;
  }

  let mode: "prefs" | "plan" = control.config.preferencesSetAt > 0 ? "plan" : "prefs";
  const chosen = new Set(DEFAULT_PRESERVE);
  let current = control;
  let selected = 0;

  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(ALT_ON + HIDE);

  const rows = () => activeViews(current.schedule);

  const draw = (): void => {
    const frame = mode === "prefs" ? preferencesScreen(chosen) : snapshot(current, true, selected);
    process.stdout.write(CLEAR + frame);
  };

  const refresh = (): void => {
    current = buildPlan(Date.now(), true, options.window, options.adapter);
    selected = Math.max(0, Math.min(selected, rows().length - 1));
    if (mode === "plan") draw();
  };

  const stop = (): void => {
    clearInterval(timer);
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write(SHOW + ALT_OFF);
  };

  const savePreferences = (kinds: string[]): void => {
    savePreference(process.cwd(), kinds);
    savePreference("default", kinds);
  };

  const timer = setInterval(refresh, REFRESH_MS);
  draw();

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      stop();
      resolve();
    };

    const apply = (action: Action): boolean => {
      if (action.kind === "quit") {
        finish();
        return false;
      }

      if (mode === "prefs") {
        if (action.kind === "toggle" && action.index < PRESERVE_KINDS.length) {
          if (chosen.has(action.index)) chosen.delete(action.index);
          else chosen.add(action.index);
        } else if (action.kind === "save") {
          savePreferences([...chosen].sort().map((index) => PRESERVE_KINDS[index] ?? ""));
          mode = "plan";
          refresh();
        } else if (action.kind === "skip") {
          savePreferences(DEFAULT_PRESERVE.map((index) => PRESERVE_KINDS[index] ?? ""));
          mode = "plan";
          refresh();
        }
        return true;
      }

      const view = rows()[selected];
      switch (action.kind) {
        case "up":
          selected = Math.max(0, selected - 1);
          break;
        case "down":
          selected = Math.min(Math.max(0, rows().length - 1), selected + 1);
          break;
        case "share":
          if (view) {
            setShare(view.claimant.id, view.allocation.target + action.delta);
            refresh();
          }
          break;
        case "unpin":
          if (view) {
            setShare(view.claimant.id, null);
            refresh();
          }
          break;
        case "priority":
          if (view) {
            setPriority(view.claimant.id, cyclePriority(view.claimant.priority));
            refresh();
          }
          break;
        case "equalize":
          equalize();
          refresh();
          break;
        case "state":
          if (view) {
            setState(view.claimant.id, action.state);
            refresh();
          }
          break;
        case "refresh":
          refresh();
          break;
        default:
          break;
      }
      return true;
    };

    stdin.on("data", (chunk: string) => {
      for (const action of keyActions(String(chunk), mode, STEP)) {
        if (!apply(action)) return;
      }
      draw();
    });
  });
}
