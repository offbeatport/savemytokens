#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "./cli-options.js";
import { runAudit } from "./commands/audit.js";
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
${bold("SaveMyTokens")} — find what wastes tokens in your AI coding sessions.

${bold("Usage")}
  npx savemytokens              audit the last 7 days
  npx savemytokens watch        observe continuously, report regressions
  npx savemytokens history      score over time
  npx savemytokens privacy      what is read, stored, and never sent

${bold("Options")}
  -d, --days <n>    window to analyse (default 7)
      --here        only this project
      --project <p> only the given project directory
      --json        machine-readable output
  -v, --verbose     per-file detail and score breakdown
      --interval <s> watch poll seconds (default 60)
      --no-save     do not write to ~/.savemytokens
  -h, --help        this text
      --version     print version

${dim("Everything runs locally. No account, no daemon, no upload.")}
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
    case "watch":
      await runWatch(options);
      return;
    case "history":
      process.stdout.write(renderHistory(loadRuns()));
      return;
    case "privacy":
      runPrivacy(version());
      return;
    case "fix":
      process.stdout.write(
        `\n${bold("SaveMyTokens")}\n\n` +
          `\`fix\` is not in v1 on purpose. v1 only measures — it never changes your setup.\n` +
          `Apply the fixes from \`npx savemytokens\` yourself, then run it again and watch the score move.\n\n`,
      );
      return;
    default:
      await runAudit(options);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`savemytokens: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
