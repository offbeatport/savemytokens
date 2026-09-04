import type { Options } from "../cli-options.js";
import { renderSchedule } from "../report/schedule.js";
import { keyActions, splitKeys, type Action } from "../scheduler/keys.js";
import {
  activeViews,
  buildPlan,
  cyclePriority,
  equalize,
  saveCustomAdvice,
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
const CUSTOM_ROW = PRESERVE_KINDS.length;
const MAX_CUSTOM = 200;

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

function preferencesScreen(selected: Set<number>, cursor: number, custom: string, editing: boolean): string {
  const theme = loadTheme(loadConfig().theme.tui);
  const color = colorEnabled;
  const out = ["", `  ${paint(theme, "accent", "SaveMyTokens", color)}`, ""];
  out.push("  When your Claude window gets tight, what should be preserved?");
  out.push(`  ${paint(theme, "dim", "Optional. Without it the advice preserves testing and finalisation.", color)}`);
  out.push("");
  for (const [index, kind] of PRESERVE_KINDS.entries()) {
    const here = cursor === index && !editing;
    const arrow = here ? paint(theme, "accent", "❯", color) : " ";
    const mark = selected.has(index) ? paint(theme, "ok", "x", color) : " ";
    out.push(`   ${arrow} ${index + 1} [${mark}] ${kind}`);
  }
  out.push("");
  const onCustom = cursor === CUSTOM_ROW;
  const arrow = onCustom && !editing ? paint(theme, "accent", "❯", color) : " ";
  const body = editing
    ? `${custom}${paint(theme, "accent", "▏", color)}`
    : custom
      ? custom
      : paint(theme, "dim", "nothing — press enter to write one", color);
  out.push(`   ${arrow} ${paint(theme, "dim", "your own line, injected with the advice:", color)}`);
  out.push(`      ${body}`);
  out.push("");
  out.push(
    `  ${paint(theme, "dim", editing ? "type it   enter keep   esc cancel" : "↑↓ move   space toggle   1-5 jump   enter edit   s save   esc back", color)}`,
  );
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

  let mode: "prefs" | "plan" = "plan";
  let editing = false;
  let cursor = 0;
  let custom = "";
  const chosen = new Set(DEFAULT_PRESERVE);
  let current = control;
  let selected = 0;

  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(ALT_ON + HIDE);

  const rows = () => activeViews(current.schedule);

  const draw = (): void => {
    const frame =
      mode === "prefs" ? preferencesScreen(chosen, cursor, custom, editing) : snapshot(current, true, selected);
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
    saveCustomAdvice(process.cwd(), custom);
    saveCustomAdvice("default", custom);
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
        const toggle = (index: number): void => {
          if (chosen.has(index)) chosen.delete(index);
          else chosen.add(index);
        };
        if (action.kind === "toggle" && action.index < PRESERVE_KINDS.length) {
          cursor = action.index;
          toggle(action.index);
        } else if (action.kind === "toggleCurrent" && cursor < PRESERVE_KINDS.length) {
          toggle(cursor);
        } else if (action.kind === "up") {
          cursor = Math.max(0, cursor - 1);
        } else if (action.kind === "down") {
          cursor = Math.min(CUSTOM_ROW, cursor + 1);
        } else if (action.kind === "edit" || (action.kind === "save" && cursor === CUSTOM_ROW && !editing)) {
          cursor = CUSTOM_ROW;
          editing = true;
        } else if (action.kind === "save") {
          savePreferences([...chosen].sort().map((index) => PRESERVE_KINDS[index] ?? ""));
          mode = "plan";
          refresh();
        } else if (action.kind === "skip") {
          mode = "plan";
          refresh();
        }
        return true;
      }

      const view = rows()[selected];
      switch (action.kind) {
        case "preferences": {
          const stored = current.config.preserveFor[process.cwd()] ?? current.config.preserveFor.default;
          chosen.clear();
          for (const [index, kind] of PRESERVE_KINDS.entries()) {
            if (stored ? stored.includes(kind) : DEFAULT_PRESERVE.includes(index)) chosen.add(index);
          }
          custom = current.config.customAdvice[process.cwd()] ?? current.config.customAdvice.default ?? "";
          cursor = 0;
          editing = false;
          mode = "prefs";
          break;
        }
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
      if (editing) {
        for (const key of splitKeys(String(chunk))) {
          if (key === "\r" || key === "\n" || key === "\u001b") {
            editing = false;
            cursor = 0;
          } else if (key === "\u007f" || key === "\b") {
            custom = custom.slice(0, -1);
          } else if (key === "\u0003") {
            stop();
            resolve();
            return;
          } else if (key.length === 1 && key >= " ") {
            custom = (custom + key).slice(0, MAX_CUSTOM);
          }
        }
        draw();
        return;
      }
      for (const action of keyActions(String(chunk), mode, STEP)) {
        if (!apply(action)) return;
      }
      draw();
    });
  });
}
