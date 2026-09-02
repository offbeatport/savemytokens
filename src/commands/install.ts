import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOOK_FILENAME, HOOK_SCRIPT, NUDGE_CONTEXT_TOKENS } from "../hooks/nudge.js";
import { RULES_BLOCK, RULES_END, RULES_START } from "../hooks/rules.js";
import { HOME, ensureHome } from "../storage/paths.js";
import { bold, dim, green } from "../util/ansi.js";
import { compactNumber } from "../util/fmt.js";

const SETTINGS = process.env.SAVEMYTOKENS_SETTINGS || path.join(os.homedir(), ".claude", "settings.json");
const EVENT = "UserPromptSubmit";
const MEMORY = process.env.SAVEMYTOKENS_MEMORY || path.join(os.homedir(), ".claude", "CLAUDE.md");

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
  const existing = readMemory();
  const body = stripRules(existing);
  const next = body.length > 0 ? body + "\n\n" + RULES_BLOCK + "\n" : RULES_BLOCK + "\n";
  fs.mkdirSync(path.dirname(MEMORY), { recursive: true });
  fs.writeFileSync(MEMORY, next);
}

export function rulesInstalled(): boolean {
  return readMemory().includes(RULES_START);
}

export function hookPath(): string {
  return path.join(HOME, "hooks", HOOK_FILENAME);
}

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
  hooks?: HookEntry[];
}

function isOurs(entry: HookEntry): boolean {
  if (typeof entry.command === "string" && entry.command.includes(HOOK_FILENAME)) return true;
  return Array.isArray(entry.hooks) && entry.hooks.some((inner) => isOurs(inner));
}

function readSettings(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function usesNestedShape(entries: HookEntry[]): boolean {
  return entries.some((entry) => Array.isArray(entry.hooks));
}

export function runInstall(dryRun: boolean): void {
  const settings = readSettings();
  const hooks = (settings.hooks ??= {});
  const entries: HookEntry[] = Array.isArray(hooks[EVENT]) ? hooks[EVENT] : [];
  const already = entries.some(isOurs);

  const command = `node ${hookPath()}`;
  const leaf: HookEntry = { type: "command", command, timeout: 5 };
  const entry: HookEntry = usesNestedShape(entries) || entries.length === 0 ? { hooks: [leaf] } : leaf;

  const out: string[] = ["", bold("SaveMyTokens"), ""];

  if (already) {
    out.push("The nudge hook is already installed.");
    out.push(dim(`  ${hookPath()}`));
    out.push("");
    out.push(dim("Remove it with: npx savemytokens uninstall"));
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  out.push(`It warns you when you start a new task while carrying more than ${compactNumber(NUDGE_CONTEXT_TOKENS)}`);
  out.push("tokens of finished work — the moment the waste is still cheap to undo.");
  out.push("");
  out.push(bold("What it does to your machine"));
  out.push("");
  out.push(`  writes  ${hookPath()}`);
  out.push(`  adds    one ${EVENT} entry to ~/.claude/settings.json`);
  out.push(`  adds    a fenced token-discipline block to ${MEMORY}`);
  out.push(`  backs up the current settings to ${path.join(HOME, "settings.backup.json")}`);
  out.push("");
  out.push(dim("  It reads the tail of the current transcript and prints one line. It never blocks a"));
  out.push(dim("  prompt, never edits a file, never makes a network call, and exits 0 on every path,"));
  out.push(dim("  so a bug in it cannot break a session. Remove it with: npx savemytokens uninstall"));
  out.push("");
  out.push(bold("CLAUDE.md gains"));
  out.push("");
  for (const line of RULES_BLOCK.split("\n")) out.push(`  ${line}`);
  out.push("");
  out.push(bold("settings.json gains"));
  out.push("");
  for (const line of JSON.stringify({ hooks: { [EVENT]: [entry] } }, null, 2).split("\n")) out.push(`  ${line}`);
  out.push("");

  if (dryRun) {
    out.push(dim("--dry-run: nothing was written."));
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }

  ensureHome();
  writeRules();
  fs.mkdirSync(path.dirname(hookPath()), { recursive: true });
  fs.writeFileSync(hookPath(), HOOK_SCRIPT, { mode: 0o755 });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(HOME, "settings.backup.json"));

  entries.push(entry);
  hooks[EVENT] = entries;
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");

  out.push(`${green("Installed.")} It takes effect in sessions you start from now on.`);
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

export function runUninstall(): void {
  const settings = readSettings();
  const entries: HookEntry[] = Array.isArray(settings.hooks?.[EVENT]) ? settings.hooks[EVENT] : [];
  const kept = entries.filter((entry) => !isOurs(entry));
  const removed = entries.length - kept.length;

  if (removed > 0) {
    if (kept.length > 0) settings.hooks[EVENT] = kept;
    else delete settings.hooks[EVENT];
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  }
  try {
    fs.rmSync(hookPath());
  } catch {}
  const memory = readMemory();
  const strippedRules = memory.includes(RULES_START);
  if (strippedRules) fs.writeFileSync(MEMORY, stripRules(memory) + "\n");

  const out = ["", bold("SaveMyTokens"), ""];
  out.push(
    removed > 0 || strippedRules
      ? "Removed the hook, its settings entry and the CLAUDE.md block. Nothing else was touched."
      : "Nothing was installed.",
  );
  out.push(dim(`Your audit history in ${HOME} is untouched.`));
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

export function hookInstalled(): boolean {
  return fs.existsSync(hookPath());
}
