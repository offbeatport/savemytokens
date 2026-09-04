import type { Options } from "../cli-options.js";
import { detailRows, helpOverlay, labelsFor, pickerRows, planRows, type ViewContext } from "../report/views.js";
import { PRESERVE_KINDS, renderSettings, selectableRows, settingsRows, type TightPreview } from "../report/settings.js";
import { keyActions, splitKeys, type Action } from "../scheduler/keys.js";
import {
  buildPlan,
  cyclePriority,
  selectionIndex,
  equalize,
  cyclePolicy,
  cyclePreset,
  cycleTheme,
  moveSegment,
  nextShare,
  saveCustomAdvice,
  toggleColumn,
  togglePreserve,
  toggleSegment,
  setPriority,
  setShare,
  setPinned,
  joinPlan,
  resetPreferences,
  leavePlan,
  workingSet,
  setState,
  visibleRows,
  type ControlPlan,
} from "../scheduler/plan.js";
import {
  HUD_PRESETS,
  builtinThemes,
  loadConfig,
  loadTheme,
  paint,
  saveConfig,
  userThemes,
  windowBounds,
  type HudView,
  type Theme,
} from "../runtime/kernel.mjs";
import { hookInstalled, runInstall } from "./install.js";
import { colorEnabled, padEndVisible, visibleWidth } from "../util/ansi.js";
import { ago } from "../util/fmt.js";

const REFRESH_MS = 2500;
const STEP = 0.05;
const MAX_CUSTOM = 200;

const ALT_ON = "\u001b[?1049h";
const ALT_OFF = "\u001b[?1049l";
const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const CLEAR = "\u001b[2J\u001b[H";

const MIN_COLUMNS = 60;

function size(): { columns: number; rows: number } {
  return { columns: Math.max(MIN_COLUMNS, process.stdout.columns ?? 100), rows: Math.max(14, process.stdout.rows ?? 30) };
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
  const read = control.schedule.quota ? `read ${ago(control.schedule.quota.at, control.schedule.now)}` : "no reading";
  const lefts = [
    ` ${paint(theme, "accent", "SaveMyTokens", color)} ${paint(theme, "dim", `· ${control.provider.label} · ${windowLabel}`, color)}`,
    ` ${paint(theme, "accent", "SaveMyTokens", color)} ${paint(theme, "dim", `· ${windowLabel}`, color)}`,
    ` ${paint(theme, "accent", "smt", color)}`,
  ];
  const rights = [
    `${paint(theme, "dim", read, color)}  ${paint(theme, "accent", viewName, color)} `,
    `${paint(theme, "accent", viewName, color)} `,
  ];
  for (const right of rights) {
    for (const left of lefts) {
      const gap = columns - visibleWidth(left) - visibleWidth(right);
      if (gap >= 2) return left + " ".repeat(gap) + right;
    }
  }
  return padEndVisible(lefts[lefts.length - 1] ?? "", columns);
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

function windowAround(lines: string[], room: number): string[] {
  if (lines.length <= room) return lines;
  const cursorLine = lines.findIndex((line) => line.includes("❯"));
  if (cursorLine === -1) return lines.slice(0, room);
  const half = Math.floor(room / 2);
  const start = Math.max(0, Math.min(lines.length - room, cursorLine - half));
  return lines.slice(start, start + room);
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
  const shown = center ? framed.slice(0, room) : windowAround(framed, room);
  const spare = Math.max(0, room - shown.length);
  const above: string[] = new Array(center ? Math.floor(spare / 2) : 0).fill("");
  const below: string[] = new Array(spare - above.length).fill("");
  return [...top, ...above, ...shown, ...below, ...bottom].join("\n");
}

function footerFor(control: ControlPlan, context: ViewContext, showHelp: boolean): string[] {
  const { theme, color } = context;
  if (showHelp) return [paint(theme, "dim", "  ? close help    q quit", color)];
  return [paint(theme, "dim", keyHints(HINTS, context.columns), color)];
}

const HINTS = [
  "↑↓ select",
  "⏎ open",
  "←→ target",
  "p priority",
  "f pin",
  "x park",
  "P settings",
  "? help",
  "q quit",
];

function keyHints(hints: string[], columns: number): string {
  for (let keep = hints.length; keep > 1; keep--) {
    const shown = [...hints.slice(0, keep - 1), hints[hints.length - 1] ?? ""];
    const line = `  ${shown.join("   ")}`;
    if (line.length <= columns) return line;
  }
  return `  ${hints[hints.length - 1] ?? ""}`;
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
      projects: control.schedule.projects.map((view) => ({
        project: view.project,
        label: view.label,
        bucket: view.bucket,
        liveSessions: view.liveSessions,
        target: view.allocation.target,
        pinnedTarget: view.allocation.pinned,
        priority: view.settings.priority,
        pinned: view.settings.pinned,
        parked: view.settings.parked,
        observed: view.observed,
        attributedPercent: view.attributedPercent,
        pressure: view.pressure,
        tokens: view.usage.tokens,
        prompt: view.prompt,
        sessions: view.sessions.map((session) => session.claimant.id),
      })),
      sessions: control.schedule.claimants.map((view) => ({
        id: view.claimant.id,
        label: view.claimant.label,
        project: view.claimant.project,
        state: view.state,
        bucket: view.bucket,
        target: view.allocation.target,
        observed: view.observed,
        attributedPercent: view.attributedPercent,
        pressure: view.pressure,
        tokens: view.usage.tokens,
        weighted: view.usage.weighted,
        prompt: view.claimant.prompt,
        stale: view.stale,
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
  const yes = choice ? paint(theme, "ok", "[ Install ]", color) : paint(theme, "dim", "  Install  ", color);
  const no = choice ? paint(theme, "dim", "  Not now  ", color) : paint(theme, "warn", "[ Not now ]", color);
  const inner = Math.max(24, Math.min(columns - 10, 56));
  const out: string[] = [];
  const middle = (line: string): void => {
    out.push(centre(line, inner));
  };
  const flush = (text: string, role: string): void => {
    for (const line of wrapPlain(text, inner)) out.push(paint(theme, role, line, color));
  };

  middle(paint(theme, "accent", "Install SaveMyTokens?", color));
  out.push("");
  flush("It needs four hooks and a status line in Claude Code to see which sessions are open and how much of your window is left. The status line is the only place Anthropic publishes that number.", "fg");
  out.push("");
  flush("Without them it reads transcripts already on disk and nothing more: no live sessions, no window, nothing said to Claude.", "dim");
  out.push("");
  middle(`${yes}    ${no}`);
  out.push("");
  middle(paint(theme, "dim", "← → choose · enter confirm", color));
  out.push("");
  flush("settings.json is backed up first. Undo any time with: npx savemytokens uninstall", "dim");
  return out;
}

function tightPreview(control: ControlPlan): TightPreview {
  const now = control.schedule.now;
  const project =
    control.schedule.projects.find((view) => view.bucket === "active") ?? control.schedule.projects[0];
  const history = control.schedule.quota?.history ?? [];
  const recent = history.filter((point) => typeof point.five_hour === "number" && point.at >= now - 45 * 60 * 1000);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const globalRate =
    first && last && last.at > first.at
      ? ((last.five_hour as number) - (first.five_hour as number)) / ((last.at - first.at) / 3_600_000)
      : null;
  const config = control.config;
  return {
    label: project?.label ?? "this project",
    target: project?.allocation.target ?? 0,
    usedPoints: project?.attributedPercent ?? 0,
    pressure: project?.pressure.value ?? 0,
    ratePerHour: globalRate === null ? null : globalRate * (project?.observed ?? 0),
    now,
    preserve: config.preserveFor[process.cwd()] ?? config.preserveFor.default ?? [],
    custom: config.customAdvice[process.cwd()] ?? config.customAdvice.default ?? "",
  };
}

function previewView(control: ControlPlan): HudView {
  const now = control.schedule.now;
  const bounds = windowBounds(control.schedule.quota, "five_hour", now);
  const view = control.schedule.claimants.find((row) => row.bucket === "active") ?? control.schedule.claimants[0];
  const quota: HudView["quota"] = {};
  for (const key of ["five_hour", "seven_day", "spend_limit"] as const) {
    const window = control.schedule.quota?.windows?.[key];
    if (window && (typeof window.resetsAt !== "number" || window.resetsAt * 1000 > now)) quota[key] = window;
  }
  return {
    label: view?.claimant.label || "session",
    target: view?.allocation.target ?? 1,
    observed: view?.observed ?? 0,
    used: view?.attributedPercent ?? null,
    pressure: view?.pressure.value ?? 0,
    priority: view?.claimant.priority ?? "normal",
    quota,
    history: (control.schedule.quota?.history ?? [])
      .filter((point) => typeof point.five_hour === "number")
      .map((point) => point.five_hour as number),
    rate: null,
    from: bounds.from,
    to: bounds.to,
    now,
  };
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
  let mode: "plan" | "settings" | "setup" | "detail" | "picker" = offerInstall ? "setup" : "plan";
  let pickerCursor = 0;
  let settingsCursor = 0;
  let setupChoice = true;
  let expanded = false;
  let showHelp = false;
  let editing = false;
  let custom = "";
  let selected = 0;
  let selectedId: string | null = null;

  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(ALT_ON + HIDE);

  const rows = () => visibleRows(control.schedule, expanded);
  const settle = (): void => {
    const list = rows();
    selected = selectionIndex(
      list.map((view) => view.project),
      selectedId,
      selected,
    );
    selectedId = list[selected]?.project ?? null;
  };
  const context = () => contextFor(control, selected, true, expanded);

  const draw = (): void => {
    const context = contextFor(control, selected, true, expanded);
    const actual = process.stdout.columns ?? 0;
    if (actual > 0 && actual < MIN_COLUMNS) {
      process.stdout.write(
        `${CLEAR}\n  ${paint(context.theme, "warn", `${actual} columns is too narrow`, context.color)}\n  ${paint(context.theme, "dim", `widen the terminal to ${MIN_COLUMNS} · q quits`, context.color)}\n`,
      );
      return;
    }
    const body = showHelp
      ? helpOverlay(control, context)
      : mode === "setup"
        ? setupScreen(setupChoice, context.theme, context.color, context.columns)
        : mode === "settings"
          ? renderSettings(
              control.config,
              settingsRows(control.config),
              settingsCursor,
              editing,
              custom,
              previewView(control),
              context.theme,
              context.color,
              tightPreview(control),
              context.columns,
            )
          : mode === "detail"
            ? detailRows(control, context)
            : mode === "picker"
              ? pickerRows(control, context, pickerCursor)
              : planRows(control, context);
    const footer =
      mode === "setup" && !showHelp
        ? [paint(context.theme, "dim", keyHints(["← → choose", "enter confirm", "q quit"], context.columns), context.color)]
        : mode === "picker" && !showHelp
        ? [paint(context.theme, "dim", keyHints(["↑↓ choose", "⏎ add it", "esc back"], context.columns), context.color)]
      : mode === "detail" && !showHelp
          ? [
              paint(
                context.theme,
                "dim",
                keyHints(["↑↓ project", "←→ target", "p priority", "f pin", "x park", "d done", "esc back", "q quit"], context.columns),
                context.color,
              ),
            ]
        : mode === "settings" && !showHelp
        ? [
            paint(
              context.theme,
              "dim",
              editing
                ? keyHints(["type it", "enter keep", "esc cancel"], context.columns)
                : keyHints(["↑↓ move", "space or enter toggles", "←→ change or reorder", "esc back"], context.columns),
              context.color,
            ),
          ]
        : footerFor(control, context, showHelp);
    const title =
      mode === "setup" ? "setup" : mode === "settings" ? "settings" : mode === "detail" ? "session" : mode === "picker" ? "add" : "plan";
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

      if (mode === "picker") {
        const candidates = workingSet(control.schedule, true).candidates;
        if (action.kind === "up") pickerCursor = Math.max(0, pickerCursor - 1);
        else if (action.kind === "down") pickerCursor = Math.min(Math.max(0, candidates.length - 1), pickerCursor + 1);
        else if (action.kind === "back" || action.kind === "skip" || action.kind === "add") mode = "plan";
        else if (action.kind === "resume" || action.kind === "save" || action.kind === "toggleCurrent") {
          const chosen = candidates[pickerCursor];
          if (chosen) {
            joinPlan(chosen.project, control.provider.id);
            selectedId = chosen.project;
          }
          mode = "plan";
          refresh();
        }
        return true;
      }

      if (mode === "settings") {
        const rows = settingsRows(control.config);
        const selectable = selectableRows(rows);
        if (!selectable.includes(settingsCursor)) settingsCursor = selectable[0] ?? 0;
        const at = selectable.indexOf(settingsCursor);
        const current = rows[settingsCursor];

        if (action.kind === "up") settingsCursor = selectable[Math.max(0, at - 1)] ?? settingsCursor;
        else if (action.kind === "down") settingsCursor = selectable[Math.min(selectable.length - 1, at + 1)] ?? settingsCursor;
        else if (action.kind === "back" || action.kind === "skip") {
          mode = "plan";
          refresh();
        } else if (current) {
          const names = [...new Set([...builtinThemes(), ...userThemes()])];
          const activate = action.kind === "toggleCurrent" || action.kind === "save" || action.kind === "resume";
          if (activate && current.kind === "advice") {
            custom = control.config.customAdvice.default ?? "";
            editing = true;
          } else if (activate) {
            if (current.kind === "reset") resetPreferences();
            else if (current.kind === "column") toggleColumn(current.id);
            else if (current.kind === "segment") toggleSegment(current.id);
            else if (current.kind === "preserve") togglePreserve(PRESERVE_KINDS[current.index] ?? "");
            else if (current.kind === "theme") cycleTheme(current.surface, 1, [...new Set([...builtinThemes(), ...userThemes()])]);
            else if (current.kind === "policy") cyclePolicy(1);
            else if (current.kind === "preset") cyclePreset(1, Object.keys(HUD_PRESETS));
          } else if (action.kind === "share") {
            const delta = action.delta > 0 ? 1 : -1;
            if (current.kind === "theme") cycleTheme(current.surface, delta, names);
            else if (current.kind === "policy") cyclePolicy(delta);
            else if (current.kind === "preset") cyclePreset(delta, Object.keys(HUD_PRESETS));
            else if (current.kind === "segment") moveSegment(current.id, delta);
          }
          control = buildPlan(Date.now(), false, options.window, options.adapter);
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
        case "preferences":
          settingsCursor = 0;
          editing = false;
          showHelp = false;
          mode = "settings";
          break;
        case "up":
          selected = Math.max(0, selected - 1);
          selectedId = rows()[selected]?.project ?? null;
          break;
        case "down":
          selected = Math.min(Math.max(0, rows().length - 1), selected + 1);
          selectedId = rows()[selected]?.project ?? null;
          break;
        case "share":
          if (view) {
            setShare(view.project, nextShare(view, action.delta), control.provider.id);
            refresh();
          }
          break;
        case "unpin":
          if (view) {
            setShare(view.project, null, control.provider.id);
            refresh();
          }
          break;
        case "priority":
          if (view) {
            setPriority(view.project, cyclePriority(view.settings.priority), control.provider.id);
            refresh();
          }
          break;
        case "equalize":
          equalize(control.provider.id);
          refresh();
          break;
        case "state":
          if (view) {
            setState(view.project, action.state, control.provider.id);
            refresh();
          }
          break;
        case "pin":
          if (view) {
            setPinned(view.project, !view.settings.pinned, control.provider.id);
            refresh();
          }
          break;
        case "park":
          if (view) {
            leavePlan(view.project, control.provider.id);
            refresh();
          }
          break;
        case "add":
          pickerCursor = 0;
          mode = "picker";
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
            if (key !== "\u001b") {
              saveCustomAdvice("default", custom);
              control = buildPlan(Date.now(), false, options.window, options.adapter);
            }
            editing = false;
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
      for (const action of keyActions(String(chunk), mode === "settings" ? "prefs" : "plan", STEP)) {
        if (!apply(action)) return;
      }
      draw();
    });
  });

}
