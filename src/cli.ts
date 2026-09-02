#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "./cli-options.js";
import { runAudit } from "./commands/audit.js";
import { runInstall, runUninstall } from "./commands/install.js";
import { runPrivacy } from "./commands/privacy.js";
import { runWatch } from "./commands/watch.js";
import { renderHistory } from "./report/render.js";
import { loadRuns } from "./storage/store.js";
import { bold, dim } from "./util/ansi.js";

function version(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function help(): string {
  return `
${bold("savemytokens")} — what your AI coding sessions wasted, and the one thing to change.

  npx savemytokens             audit this project, or all of them if you are not in one
  npx savemytokens install     warn you when a new task drags finished work along
  npx savemytokens uninstall   remove that hook

  -d, --days <n>   window to analyse (default 7)
      --all        every project, not just this one
  -v, --verbose    every finding, per-file detail, spend by project
      --json       machine-readable

${dim("Everything runs locally. No account, no daemon, no upload. See what it stores: savemytokens privacy")}
`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.version) {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (options.help || options.command === "help") {
    process.stdout.write(help());
    return;
  }

  switch (options.command) {
    case "install":
      runInstall(options.dryRun);
      return;
    case "uninstall":
      runUninstall();
      return;
    case "watch":
      await runWatch(options);
      return;
    case "history":
      process.stdout.write(renderHistory(loadRuns()));
      return;
    case "privacy":
      runPrivacy(version());
      return;
    default:
      await runAudit(options);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`savemytokens: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
