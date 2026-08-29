import fs from "node:fs";
import { claudeCodeAdapter } from "../adapters/claude-code/index.js";
import type { Audit } from "../core/types.js";
import { buildPayload } from "../privacy/payload.js";
import { LAST_AUDIT_FILE, displayHome, readJson } from "../storage/paths.js";
import { loadConfig } from "../storage/store.js";
import { bold, dim } from "../util/ansi.js";

export function runPrivacy(version: string): void {
  const config = loadConfig();
  const out: string[] = ["", bold("SaveMyTokens"), "", bold("What it reads"), ""];
  out.push(`  ${claudeCodeAdapter.dataDir}${dim("  (Claude Code's own session logs, read-only)")}`);
  out.push("");
  out.push(bold("What it writes"));
  out.push("");
  out.push(`  ${displayHome()}/cache/     ${dim("per-session measurements, so repeat runs are fast")}`);
  out.push(dim("      · includes the first 120 characters of each prompt, so a finding can name"));
  out.push(dim("        the task it came from"));
  out.push(`  ${displayHome()}/runs.json  ${dim("one line per run: score, waste ratios, token totals")}`);
  out.push(`  ${displayHome()}/last-audit.json`);
  out.push("");
  out.push(dim("  Nothing outside that directory is created or modified. No project file is touched."));
  out.push("");
  out.push(bold("What leaves this machine"));
  out.push("");
  out.push(`  Nothing. There is no network call in this tool. Contribution is ${config.contribute ? "ON" : "OFF"} and opt-in only.`);
  out.push("");
  out.push(bold("If you ever opt in, this is the exact shape that would be sent"));
  out.push("");

  const audit = fs.existsSync(LAST_AUDIT_FILE) ? readJson<Audit | null>(LAST_AUDIT_FILE, null) : null;
  if (!audit) {
    out.push(dim("  Run `npx savemytokens` once, then this shows your real payload."));
  } else {
    const payload = buildPayload(audit, version, audit.outcomes);
    for (const line of JSON.stringify(payload, null, 2).split("\n")) out.push(`  ${line}`);
  }
  out.push("");
  out.push(dim("  Counters only. No prompts, responses, file paths, commands, repo names or code."));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}
