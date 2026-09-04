import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES_BLOCK, RULES_END, RULES_START } from "../hooks/rules.js";
import { HOME, HOOKS_DIR, loadConfig, saveConfig } from "../runtime/kernel.mjs";
import { bold, dim, green, yellow } from "../util/ansi.js";

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const SETTINGS = process.env.SAVEMYTOKENS_SETTINGS || path.join(CLAUDE_HOME, "settings.json");
const MEMORY = process.env.SAVEMYTOKENS_MEMORY || path.join(CLAUDE_HOME, "CLAUDE.md");
const RUNTIME_FILES = ["kernel.mjs", "hook.mjs", "statusline.mjs"];

export const HOOK_EVENTS: Array<[string, string]> = [
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "prompt"],
  ["Stop", "stop"],
  ["SessionEnd", "session-end"],
];

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
  hooks?: HookEntry[];
}

function quoted(value: string): string {
  return /[\s"']/.test(value) ? `"${value}"` : value;
}

export function hookPath(name: string): string {
  return path.join(HOOKS_DIR, name);
}

function hookCommand(event: string): string {
  return `${quoted(process.execPath)} ${quoted(hookPath("hook.mjs"))} ${event}`;
}

function statusLineCommand(): string {
  return `${quoted(process.execPath)} ${quoted(hookPath("statusline.mjs"))}`;
}

function ourCommand(command: unknown): boolean {
  if (typeof command !== "string") return false;
  return command.includes(HOOKS_DIR) || command.includes("savemytokens") || command.includes("nudge.cjs");
}

function isOurs(entry: HookEntry): boolean {
  if (ourCommand(entry.command)) return true;
  return Array.isArray(entry.hooks) && entry.hooks.some(isOurs);
}

function readSettings(): Record<string, any> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(SETTINGS, "utf8");
  } catch {
    return {};
  }
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function unreadableSettings(): void {
  process.stdout.write(
    `\n${bold("SaveMyTokens")}\n\n${SETTINGS} is not valid JSON, so it could not be read.\nRefusing to touch it — fix the file and try again. Nothing was changed.\n\n`,
  );
  process.exitCode = 1;
}

function writeSettings(settings: Record<string, any>): void {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
}

function readMemory(): string {
  try {
    return fs.readFileSync(MEMORY, "utf8");
  } catch {
    return "";
  }
}

function stripRules(text: string): string {
  const start = text.indexOf(RULES_START);
  const end = text.indexOf(RULES_END);
  if (start === -1 || end === -1) return text;
  return (text.slice(0, start) + text.slice(end + RULES_END.length)).replace(/\n{3,}/g, "\n\n").trimEnd();
}

function writeRules(): void {
  const body = stripRules(readMemory());
  const next = body.length > 0 ? body + "\n\n" + RULES_BLOCK + "\n" : RULES_BLOCK + "\n";
  fs.mkdirSync(path.dirname(MEMORY), { recursive: true });
  fs.writeFileSync(MEMORY, next);
}

export function rulesInstalled(): boolean {
  return readMemory().includes(RULES_START);
}

export function hookInstalled(): boolean {
  return fs.existsSync(hookPath("hook.mjs"));
}

function copyRuntime(): void {
  const from = fileURLToPath(new URL("../runtime/", import.meta.url));
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  for (const name of RUNTIME_FILES) {
    fs.copyFileSync(path.join(from, name), path.join(HOOKS_DIR, name));
  }
  fs.chmodSync(path.join(HOOKS_DIR, "hook.mjs"), 0o755);
  fs.chmodSync(path.join(HOOKS_DIR, "statusline.mjs"), 0o755);
}

function addHooks(settings: Record<string, any>): number {
  const hooks = (settings.hooks ??= {});
  let added = 0;
  for (const [event, action] of HOOK_EVENTS) {
    const entries: HookEntry[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = entries.filter((entry) => !isOurs(entry));
    kept.push({ hooks: [{ type: "command", command: hookCommand(action), timeout: 10 }] });
    hooks[event] = kept;
    added++;
  }
  return added;
}

export interface InstallOptions {
  dryRun: boolean;
  force: boolean;
  rules: boolean;
  quiet?: boolean;
}

export function runInstall(options: InstallOptions): void {
  const parsed = readSettings();
  if (parsed === null) {
    unreadableSettings();
    return;
  }
  if (sandboxMismatch()) {
    process.stdout.write(
      `\n${bold("SaveMyTokens")}\n\nSAVEMYTOKENS_HOME points somewhere else, but the Claude settings do not.\nRefusing to edit ${SETTINGS} from a sandboxed run — set SAVEMYTOKENS_SETTINGS\nor CLAUDE_CONFIG_DIR too, or unset SAVEMYTOKENS_HOME.\n\n`,
    );
    process.exitCode = 1;
    return;
  }
  const settings = parsed;
  const existingStatusLine = settings.statusLine?.command;
  const ours = ourCommand(existingStatusLine);
  const conflict = typeof existingStatusLine === "string" && !ours;
  const out: string[] = ["", bold("SaveMyTokens"), ""];

  out.push("It gives every Claude Code session a target share of your Claude window, and tells");
  out.push("Claude what share it is working within.");
  out.push("");
  out.push(bold("What it does to your machine"));
  out.push("");
  out.push(`  writes  ${HOOKS_DIR}/{kernel,hook,statusline}.mjs`);
  out.push(`  adds    ${HOOK_EVENTS.map(([event]) => event).join(", ")} hooks to ${SETTINGS}`);
  out.push(
    conflict && !options.force
      ? `  keeps   your existing status line ${dim("(--force wraps it and appends the SMT segment)")}`
      : conflict
        ? `  wraps   your existing status line, then appends the SMT segment`
        : `  sets    the status line, the only place Anthropic publishes your 5h and 7d usage`,
  );
  out.push(`  backs up the current settings to ${path.join(HOME, "settings.backup.json")}`);
  if (options.rules) out.push(`  adds    a fenced token-discipline block to ${MEMORY}`);
  out.push("");
  out.push(dim("  Hooks read your transcripts, write only to ~/.savemytokens, never block a prompt,"));
  out.push(dim("  never make a network call, and exit 0 on every path. Remove with: npx savemytokens uninstall"));
  out.push("");

  if (conflict && !options.force) {
    out.push(yellow("  Your status line is already set to something else:"));
    out.push(dim(`    ${existingStatusLine}`));
    out.push("  Without it SMT cannot read your published 5h/7d usage — every other part still works.");
    out.push(`  Run ${bold("npx savemytokens install --force")} to keep yours and append the SMT segment.`);
    out.push("");
  }

  if (options.quiet && !options.dryRun) {
    fs.mkdirSync(HOME, { recursive: true });
    if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(HOME, "settings.backup.json"));
    copyRuntime();
    addHooks(settings);
    const quietConfig = loadConfig();
    if (!conflict || options.force) {
      if (conflict && options.force) quietConfig.wrappedStatusLine = existingStatusLine;
      settings.statusLine = { type: "command", command: statusLineCommand(), padding: 0, refreshInterval: 10 };
    }
    if (!quietConfig.createdAt) quietConfig.createdAt = Date.now();
    saveConfig(quietConfig);
    writeSettings(settings);
    return;
  }

  if (options.dryRun) {
    const preview = {
      statusLine: { type: "command", command: statusLineCommand(), padding: 0, refreshInterval: 10 },
      hooks: Object.fromEntries(
        HOOK_EVENTS.map(([event, action]) => [event, [{ hooks: [{ type: "command", command: hookCommand(action), timeout: 10 }] }]]),
      ),
    };
    out.push(bold("settings.json gains"));
    out.push("");
    for (const line of JSON.stringify(preview, null, 2).split("\n")) out.push(`  ${line}`);
    out.push("");
    out.push(dim("--dry-run: nothing was written."));
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  fs.mkdirSync(HOME, { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(HOME, "settings.backup.json"));
  copyRuntime();
  if (options.rules) writeRules();

  addHooks(settings);

  const config = loadConfig();
  if (!conflict || options.force) {
    if (conflict && options.force) config.wrappedStatusLine = existingStatusLine;
    settings.statusLine = { type: "command", command: statusLineCommand(), padding: 0, refreshInterval: 10 };
  }
  if (!config.createdAt) config.createdAt = Date.now();
  saveConfig(config);
  writeSettings(settings);

  out.push(`${green("Installed.")} It takes effect in sessions you start from now on.`);
  out.push(dim("  Open the control centre with: npx savemytokens"));
  out.push("");
  if (!options.quiet) process.stdout.write(out.join("\n") + "\n");
}

function sandboxMismatch(): boolean {
  const homeOverridden = Boolean(process.env.SAVEMYTOKENS_HOME);
  const settingsChosen = Boolean(process.env.SAVEMYTOKENS_SETTINGS || process.env.CLAUDE_CONFIG_DIR);
  return homeOverridden && !settingsChosen;
}

export function runUninstall(purge: boolean): void {
  const parsed = readSettings();
  if (parsed === null) {
    unreadableSettings();
    return;
  }
  if (sandboxMismatch()) {
    process.stdout.write(
      `\n${bold("SaveMyTokens")}\n\nSAVEMYTOKENS_HOME points somewhere else, but the Claude settings do not.\nRefusing to edit ${SETTINGS} from a sandboxed run — set SAVEMYTOKENS_SETTINGS\nor CLAUDE_CONFIG_DIR too, or unset SAVEMYTOKENS_HOME.\n\n`,
    );
    process.exitCode = 1;
    return;
  }
  const settings = parsed;
  let removed = 0;

  for (const [event] of HOOK_EVENTS) {
    const entries: HookEntry[] = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
    const kept = entries.filter((entry) => !isOurs(entry));
    removed += entries.length - kept.length;
    if (kept.length > 0) settings.hooks[event] = kept;
    else if (settings.hooks) delete settings.hooks[event];
  }

  const config = loadConfig();
  let statusLineRestored = false;
  if (ourCommand(settings.statusLine?.command)) {
    if (config.wrappedStatusLine) {
      settings.statusLine = { type: "command", command: config.wrappedStatusLine, padding: 0 };
      statusLineRestored = true;
    } else {
      delete settings.statusLine;
    }
    removed++;
  }

  if (removed > 0) writeSettings(settings);

  try {
    fs.rmSync(HOOKS_DIR, { recursive: true, force: true });
  } catch {}

  const memory = readMemory();
  const strippedRules = memory.includes(RULES_START);
  if (strippedRules) fs.writeFileSync(MEMORY, stripRules(memory) + "\n");

  const defaultHome = !process.env.SAVEMYTOKENS_HOME;
  let purged = false;
  if (purge && defaultHome && !process.stdin.isTTY) {
    process.stdout.write(
      `\n${bold("SaveMyTokens")}\n\nRefusing to delete ${HOME} from a non-interactive run.\nRun it from a terminal, or delete the directory yourself.\n\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (purge) {
    try {
      fs.rmSync(HOME, { recursive: true, force: true });
      purged = true;
    } catch {}
  }

  const out = ["", bold("SaveMyTokens"), ""];
  out.push(
    removed > 0 || strippedRules
      ? "Removed the hooks, the status line and the scripts. Nothing else was touched."
      : "Nothing was installed.",
  );
  if (statusLineRestored) out.push(dim("Your own status line is back in place."));
  out.push(dim(purged ? `Deleted ${HOME}.` : `Your local state in ${HOME} is untouched — remove it with --purge.`));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

export interface NudgeStats {
  installedAt: number;
  fired: number;
  usdAtStake: number;
}

export function nudgeStats(): NudgeStats | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(HOME, "nudges.json"), "utf8"));
    if (!Array.isArray(parsed.events) || parsed.events.length === 0) return null;
    return {
      installedAt: parsed.installedAt ?? parsed.events[0]?.at ?? Date.now(),
      fired: parsed.events.length,
      usdAtStake: parsed.events.reduce((sum: number, event: { usd?: number }) => sum + (event.usd ?? 0), 0),
    };
  } catch {
    return null;
  }
}
