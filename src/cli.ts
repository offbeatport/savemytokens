#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "./cli-options.js";
import { runAudit } from "./commands/audit.js";
import { runControl } from "./commands/control.js";
import { runInstall, runUninstall } from "./commands/install.js";
import { runHud } from "./commands/hud.js";
import { runDefer, runPolicy } from "./commands/policy.js";
import { runPrivacy } from "./commands/privacy.js";
import { runSet } from "./commands/set.js";
import { runTheme } from "./commands/theme.js";
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
${bold("savemytokens")}: give every Claude Code session a target share of your Claude window.

  npx savemytokens             the control centre
  npx savemytokens install     hooks + status line, so it works while the TUI is closed
  npx savemytokens uninstall   remove them
  npx savemytokens status      one plain-text snapshot
  npx savemytokens share <project> <percent|auto>
  npx savemytokens priority <project> <high|normal|low>
  npx savemytokens release <project>          hand its unused share back
  npx savemytokens pin|park <project>         keep it visible, or drop it from the set
  npx savemytokens policy      what Claude does as the window fills
  npx savemytokens defer       work pushed to the next session
  npx savemytokens hud         status line layouts, previewed on your numbers
  npx savemytokens theme       themes for the TUI and the status line
  npx savemytokens audit       the token-waste report

  -d, --days <n>   audit window (default 7)
      --json       machine-readable
      --force      install: wrap an existing status line instead of leaving it alone
      --rules      install: also write the token-discipline block into ~/.claude/CLAUDE.md
      --purge      uninstall: also delete ~/.savemytokens
      --7d         allocate against the weekly window instead of the 5-hour one
      --codex      Codex instead of Claude Code (visibility only)

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
      runInstall({ dryRun: options.dryRun, force: options.force, rules: options.rules });
      return;
    case "uninstall":
      runUninstall(options.purge);
      return;
    case "theme":
      runTheme(options.args);
      return;
    case "hud":
      runHud(options);
      return;
    case "share":
    case "priority":
    case "release":
    case "pin":
    case "park":
      runSet(options);
      return;
    case "policy":
      runPolicy(options);
      return;
    case "defer":
      runDefer(options);
      return;
    case "audit":
      await runAudit(options);
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
      await runControl(options);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`savemytokens: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
