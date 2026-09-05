import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const tag = `v${version}`;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function notesFor(release) {
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const from = changelog.indexOf(`## ${release}\n`);
  if (from === -1) return "";
  const next = changelog.indexOf("\n## ", from + 1);
  return changelog.slice(from + `## ${release}`.length, next === -1 ? undefined : next).trim();
}

function already(command, args) {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (git("status", "--porcelain")) {
  process.stdout.write(`\nsavemytokens: the tree is dirty, so ${tag} would not be what was published.\n\n`);
  process.exitCode = 1;
} else {
  if (already("git", ["rev-parse", tag])) git("tag", "-d", tag);
  git("tag", "-a", tag, "-m", `SaveMyTokens ${version}`);
  execFileSync("git", ["push", "--force", "origin", tag], { cwd: ROOT, stdio: "inherit" });

  const notes = notesFor(version);
  if (!notes) {
    process.stdout.write(`\nsavemytokens: ${tag} is tagged, but CHANGELOG.md has no ## ${version} section to release from.\n\n`);
    process.exitCode = 1;
  } else if (already("gh", ["release", "view", tag])) {
    execFileSync("gh", ["release", "edit", tag, "--notes", notes], { cwd: ROOT, stdio: "inherit" });
    process.stdout.write(`\nUpdated the release notes for ${tag}.\n\n`);
  } else {
    execFileSync("gh", ["release", "create", tag, "--title", `SaveMyTokens ${version}`, "--notes", notes], {
      cwd: ROOT,
      stdio: "inherit",
    });
    process.stdout.write(`\nReleased ${tag}.\n\n`);
  }
}
