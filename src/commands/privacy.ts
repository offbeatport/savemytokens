import fs from "node:fs";
import { claudeCodeAdapter } from "../adapters/claude-code/index.js";
import { displayHome } from "../storage/paths.js";
import { bold, dim } from "../util/ansi.js";

export function runPrivacy(version: string): void {
  const out: string[] = ["", bold("SaveMyTokens"), "", bold("What it reads"), ""];
  out.push(`  ${claudeCodeAdapter.dataDir}${dim("  (Claude Code's own session logs, read-only)")}`);
  out.push("");
  out.push(bold("What it writes"));
  out.push("");
  out.push(`  ${displayHome()}/claimants/  ${dim("one file per session: label, target share, priority, state")}`);
  out.push(`  ${displayHome()}/meter/      ${dim("token counts in five-minute buckets, and how far each transcript was read")}`);
  out.push(`  ${displayHome()}/quota/      ${dim("the 5h and 7d percentages Anthropic publishes to the status line")}`);
  out.push(`  ${displayHome()}/hooks/      ${dim("the three scripts install puts there")}`);
  out.push(`  ${displayHome()}/cache/      ${dim("per-session audit measurements, so repeat runs are fast")}`);
  out.push(dim("      · includes the first 120 characters of each prompt, so a finding or a row can"));
  out.push(dim("        name the task it came from"));
  out.push(`  ${displayHome()}/runs.json   ${dim("one line per audit run: score, waste ratios, token totals")}`);
  out.push("");
  out.push(dim("  Nothing outside that directory is created or modified, apart from the hook and"));
  out.push(dim("  status line entries install adds to Claude Code's own settings.json. No project"));
  out.push(dim("  file is touched unless you pass --rules."));
  out.push("");
  out.push(bold("What leaves this machine"));
  out.push("");
  out.push("  Nothing. There is no network call in this tool.");
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}
