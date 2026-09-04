import type { Options } from "../cli-options.js";
import { detailRows, helpOverlay, labelsFor, planRows, type ViewContext } from "../report/views.js";
import { keyActions, splitKeys, type Action } from "../scheduler/keys.js";
import {
  buildPlan,
  cyclePriority,
  selectionIndex,
  equalize,
  saveCustomAdvice,
  savePreference,
  setPriority,
  setShare,
  setPinned,
  setParked,
  setState,
  visibleRows,
  type ControlPlan,
} from "../scheduler/plan.js";
import { loadConfig, loadTheme, paint, saveConfig, type Theme } from "../runtime/kernel.mjs";
import { hookInstalled, runInstall } from "./install.js";
import { colorEnabled, padEndVisible, visibleWidth } from "../util/ansi.js";
import { ago } from "../util/fmt.js";

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

function size(): { columns: number; rows: number } {
  return { columns: Math.max(60, process.stdout.columns ?? 100), rows: Math.max(14, process.stdout.rows ?? 30) };
}

function contextFor(control: ControlPlan, selected: number, interactive: boolean, expanded = false): ViewContext {
  const { columns, rows } = size();
  return {
    expanded,
    theme: loadTheme(control.config.theme.tui),
    color: colorEnabled,
    columns,
    rows,
    selected,
    interactive,
    labels: labelsFor(visibleRows(control.schedule)),
  };
}

function header(control: ControlPlan, viewName: string, theme: Theme, color: boolean, columns: number): string {
  const windowLabel = control.schedule.key === "seven_day" ? "7d" : "5h";
  const left = ` ${paint(theme, "accent", "SaveMyTokens", color)} ${paint(theme, "dim", `· ${control.provider.label} · ${windowLabel}`, color)}`;
  const read = control.schedule.quota ? `read ${ago(control.schedule.quota.at, control.schedule.now)}` : "no reading";
  const right = `${paint(theme, "dim", read, color)}  ${paint(theme, "accent", viewName, color)} `;
  const gap = Math.max(1, columns - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(gap) + right;
}

export function boxed(lines: string[], theme: Theme, color: boolean, columns: number): string[] {
  const widest = Math.max(24, ...lines.map((line) => visibleWidth(line)));
  const inner = Math.min(Math.max(0, columns - 4), widest + 4);
  const h = theme.border.h ?? "─";
  const v = theme.border.v ?? "│";
  const left = Math.max(0, Math.floor((columns - inner - 2) / 2));
  const pad = " ".repeat(left);
  const edge = (start: string, end: string): string => `${pad}${paint(theme, "accent", `${start}${h.repeat(inner)}${end}`, color)}`;
  const out = [edge(theme.border.tl ?? "┌", theme.border.tr ?? "┐")];
  for (const line of lines) {
    const body = visibleWidth(line) > inner - 2 ? line : padEndVisible(line, inner - 2);
    out.push(`${pad}${paint(theme, "accent", v, color)} ${body} ${paint(theme, "accent", v, color)}`);
  }
  out.push(edge(theme.border.bl ?? "└", theme.border.br ?? "┘"));
  return out;
}

function fullScreen(
  control: ControlPlan,
  body: string[],
  footer: string[],
  viewName: string,
  context: ViewContext,
  center = false,
): string {
  const { theme, color, columns, rows } = context;
  const rule = paint(theme, "dim", (theme.border.h ?? "─").repeat(columns), color);
  const top = [header(control, viewName, theme, color, columns), rule];
  const bottom = [rule, ...footer];
  const room = Math.max(1, rows - top.length - bottom.length - 1);
  const framed = center ? boxed(body, theme, color, columns) : body;
  const shown = framed.slice(0, room);
  const spare = Math.max(0, room - shown.length);
  const above: string[] = new Array(center ? Math.floor(spare / 2) : 0).fill("");
  const below: string[] = new Array(spare - above.length).fill("");
  return [...top, ...above, ...shown, ...below, ...bottom].join("\n");
}

function footerFor(control: ControlPlan, context: ViewContext, showHelp: boolean): string[] {
  const { theme, color } = context;
  if (showHelp) return [paint(theme, "dim", "  ? close help    q quit", color)];
  return [
    paint(
      theme,
      "dim",
      "  ↑↓ select   ⏎ open   ←→ target   p priority   f pin   x park   m all   ? help   q quit",
      color,
    ),
  ];
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
        bucket: view.bucket,
        pinned_by_user: view.claimant.pinned,
        parked: view.claimant.parked,
        heartbeat: view.claimant.heartbeat ?? 0,
      })),
    },
    null,
    2,
  );
}

function centre(line: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
  return " ".repeat(pad) + line;
}

function wrapPlain(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function setupScreen(choice: boolean, theme: Theme, color: boolean, columns: number): string[] {
  const yes = choice ? paint(theme, "ok", "[ Yes ]", color) : paint(theme, "dim", "  Yes  ", color);
  const no = choice ? paint(theme, "dim", "  Not now  ", color) : paint(theme, "warn", "[ Not now ]", color);
  const inner = Math.max(20, Math.min(columns - 10, 60));
  const lines: string[] = [];
  lines.push(...wrapPlain("Enable live Claude usage in your status bar?", inner).map((line) => paint(theme, "accent", line, color)));
  lines.push("");
  lines.push(...wrapPlain("Shows your 5h and weekly capacity, and this session's share of it.", inner));
  lines.push(
    ...wrapPlain("It adds four hooks and a status line to Claude Code's settings.json, backing that file up first.", inner).map(
      (line) => paint(theme, "dim", line, color),
    ),
  );
  lines.push("");
  lines.push(`${yes}    ${no}`);
  lines.push("");
  lines.push(paint(theme, "dim", "← → choose · enter confirm", color));
  lines.push("");
  lines.push(...wrapPlain("Later, any time: npx savemytokens install · uninstall", inner).map((line) => paint(theme, "dim", line, color)));
  return lines.map((line) => centre(line, inner));
}

function preferencesScreen(
  selected: Set<number>,
  cursor: number,
  custom: string,
  editing: boolean,
  theme: Theme,
  color: boolean,
): string[] {
  const out = ["", "  When your Claude window gets tight, what should be preserved?"];
  out.push(`  ${paint(theme, "dim", "Optional. Without it the advice preserves testing and finalisation.", color)}`);
  out.push("");
  for (const [index, kind] of PRESERVE_KINDS.entries()) {
    const here = cursor === index && !editing;
    const arrow = here ? paint(theme, "accent", "❯", color) : " ";
    const mark = selected.has(index) ? paint(theme, "ok", "x", color) : " ";
    out.push(`   ${arrow} ${index + 1} [${mark}] ${kind}`);
  }
  out.push("");
  const arrow = cursor === CUSTOM_ROW && !editing ? paint(theme, "accent", "❯", color) : " ";
  const body = editing
    ? `${custom}${paint(theme, "accent", "▏", color)}`
    : custom || paint(theme, "dim", "nothing — press enter to write one", color);
  out.push(`   ${arrow} ${paint(theme, "dim", "your own line, injected with the advice:", color)}`);
  out.push(`      ${body}`);
  return out;
}

export async function runControl(options: Options): Promise<void> {
  let control = buildPlan(Date.now(), true, options.window, options.adapter);

  if (options.json) {
    process.stdout.write(`${toJson(control)}\n`);
    return;
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY || options.command === "status") {
    const context = contextFor(control, -1, false, true);
    process.stdout.write(`\n${planRows(control, context).join("\n")}\n\n`);
    return;
  }

  const stdin = process.stdin;
  try {
    stdin.setRawMode(true);
  } catch {
    const context = contextFor(control, -1, false, true);
    process.stdout.write(`\n${planRows(control, context).join("\n")}\n\n`);
    return;
  }

  const config = loadConfig();
  const offerInstall = !hookInstalled() && !config.offeredInstallAt;
  let mode: "plan" | "prefs" | "setup" | "detail" = offerInstall ? "setup" : "plan";
  let setupChoice = true;
  let expanded = false;
  let showHelp = false;
  let editing = false;
  let cursor = 0;
  let custom = "";
  let selected = 0;
  let selectedId: string | null = null;
  const chosen = new Set(DEFAULT_PRESERVE);

  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(ALT_ON + HIDE);

  const rows = () => visibleRows(control.schedule, expanded);
  const settle = (): void => {
    const list = rows();
    selected = selectionIndex(
      list.map((view) => view.claimant.id),
      selectedId,
      selected,
    );
    selectedId = list[selected]?.claimant.id ?? null;
  };
  const context = () => contextFor(control, selected, true, expanded);

  const draw = (): void => {
    const context = contextFor(control, selected, true, expanded);
    const body = showHelp
      ? helpOverlay(control, context)
      : mode === "setup"
        ? setupScreen(setupChoice, context.theme, context.color, context.columns)
        : mode === "prefs"
          ? preferencesScreen(chosen, cursor, custom, editing, context.theme, context.color)
          : mode === "detail"
            ? detailRows(control, context)
            : planRows(control, context);
    const footer =
      mode === "setup" && !showHelp
        ? [paint(context.theme, "dim", "  ← → choose   enter confirm   q quit", context.color)]
        : mode === "detail" && !showHelp
          ? [paint(context.theme, "dim", "  ←→ target   p priority   f pin   x park   d done   esc back   q quit", context.color)]
        : mode === "prefs" && !showHelp
        ? [
            paint(
              context.theme,
              "dim",
              editing
                ? "  type it   enter keep   esc cancel"
                : "  ↑↓ move   space toggle   1-5 jump   enter edit   s save   esc back",
              context.color,
            ),
          ]
        : footerFor(control, context, showHelp);
    const title = mode === "setup" ? "setup" : mode === "prefs" ? "preserve" : mode === "detail" ? "session" : "plan";
    process.stdout.write(CLEAR + fullScreen(control, body, footer, title, context, mode === "setup" && !showHelp));
  };

  const refresh = (): void => {
    control = buildPlan(Date.now(), true, options.window, options.adapter);
    settle();
    draw();
  };

  const stop = (): void => {
    clearInterval(timer);
    process.stdout.off("resize", draw);
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

  settle();
  const timer = setInterval(refresh, REFRESH_MS);
  process.stdout.on("resize", draw);
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

      if (mode === "setup") {
        if (action.kind === "share") setupChoice = action.delta > 0 ? false : true;
        else if (action.kind === "up" || action.kind === "down") setupChoice = !setupChoice;
        else if (action.kind === "resume" || action.kind === "save") {
          const stored = loadConfig();
          stored.offeredInstallAt = Date.now();
          saveConfig(stored);
          if (setupChoice) {
            try {
              runInstall({ dryRun: false, force: false, rules: false, quiet: true });
            } catch {}
          }
          mode = "plan";
          refresh();
        } else if (action.kind === "skip") {
          const stored = loadConfig();
          stored.offeredInstallAt = Date.now();
          saveConfig(stored);
          mode = "plan";
          refresh();
        }
        return true;
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
        case "help":
          showHelp = !showHelp;
          break;
        case "expand":
          expanded = !expanded;
          settle();
          break;
        case "resume":
          mode = mode === "detail" ? "plan" : "detail";
          break;
        case "back":
          if (mode === "detail") mode = "plan";
          else if (showHelp) showHelp = false;
          break;
        case "preferences": {
          const stored = control.config.preserveFor[process.cwd()] ?? control.config.preserveFor.default;
          chosen.clear();
          for (const [index, kind] of PRESERVE_KINDS.entries()) {
            if (stored ? stored.includes(kind) : DEFAULT_PRESERVE.includes(index)) chosen.add(index);
          }
          custom = control.config.customAdvice[process.cwd()] ?? control.config.customAdvice.default ?? "";
          cursor = 0;
          editing = false;
          showHelp = false;
          mode = "prefs";
          break;
        }
        case "up":
          selected = Math.max(0, selected - 1);
          selectedId = rows()[selected]?.claimant.id ?? null;
          break;
        case "down":
          selected = Math.min(Math.max(0, rows().length - 1), selected + 1);
          selectedId = rows()[selected]?.claimant.id ?? null;
          break;
        case "share":
          if (view) {
            setShare(view.claimant.id, view.allocation.target + action.delta, control.provider.id);
            refresh();
          }
          break;
        case "unpin":
          if (view) {
            setShare(view.claimant.id, null, control.provider.id);
            refresh();
          }
          break;
        case "priority":
          if (view) {
            setPriority(view.claimant.id, cyclePriority(view.claimant.priority), control.provider.id);
            refresh();
          }
          break;
        case "equalize":
          equalize(control.provider.id);
          refresh();
          break;
        case "state":
          if (view) {
            setState(view.claimant.id, action.state, control.provider.id);
            refresh();
          }
          break;
        case "pin":
          if (view) {
            setPinned(view.claimant.id, !view.claimant.pinned, control.provider.id);
            refresh();
          }
          break;
        case "park":
          if (view) {
            setParked(view.claimant.id, !view.claimant.parked, control.provider.id);
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
            finish();
            return;
          } else if (key.length === 1 && key >= " ") {
            custom = (custom + key).slice(0, MAX_CUSTOM);
          }
        }
        draw();
        return;
      }
      for (const action of keyActions(String(chunk), mode === "prefs" ? "prefs" : "plan", STEP)) {
        if (!apply(action)) return;
      }
      draw();
    });
  });

}
