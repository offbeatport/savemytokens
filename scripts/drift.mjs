import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { name, version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function run(command, args, cwd = ROOT) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

function quiet(command, args, cwd = ROOT) {
  try {
    return run(command, args, cwd);
  } catch {
    return "";
  }
}

function filesIn(dir) {
  const out = new Map();
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(dir, full), fs.readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const published = quiet("npm", ["view", name, "version"]);
const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "smt-drift-")));
const lines = [""];

lines.push(`  ${name}`);
lines.push(`    package.json  ${version}`);
lines.push(`    npm           ${published || "not published"}`);
lines.push(`    git           ${quiet("git", ["describe", "--tags", "--always"])}${quiet("git", ["status", "--porcelain"]) ? "  (uncommitted changes)" : ""}`);
lines.push("");

if (!published) {
  lines.push("  Nothing is published yet, so there is nothing to compare.");
} else if (published !== version) {
  lines.push(`  package.json is ${version} and npm has ${published}, so they are different by design.`);
  lines.push(`  Publish, or compare a matching version.`);
} else {
  fs.mkdirSync(path.join(work, "them"), { recursive: true });
  fs.mkdirSync(path.join(work, "us"), { recursive: true });
  run("npm", ["pack", `${name}@${version}`, "--silent", "--pack-destination", path.join(work, "them")]);
  const theirs = fs.readdirSync(path.join(work, "them"))[0];
  run("tar", ["xzf", path.join(work, "them", theirs ?? ""), "-C", path.join(work, "them")]);

  run("npm", ["pack", "--silent", "--pack-destination", path.join(work, "us")]);
  const ours = fs.readdirSync(path.join(work, "us")).find((file) => file.endsWith(".tgz"));
  run("tar", ["xzf", path.join(work, "us", ours ?? ""), "-C", path.join(work, "us")]);

  const them = filesIn(path.join(work, "them", "package"));
  const us = filesIn(path.join(work, "us", "package"));
  const names = [...new Set([...them.keys(), ...us.keys()])].sort();
  const changed = names.filter((file) => them.get(file) !== us.get(file));

  if (changed.length === 0) {
    lines.push(`  What is on npm is byte for byte what is in this tree. ${names.length} files.`);
  } else {
    lines.push(`  ${changed.length} of ${names.length} files differ from what is published:`);
    lines.push("");
    for (const file of changed) {
      const state = !them.has(file) ? "only here" : !us.has(file) ? "only on npm" : "changed";
      lines.push(`    ${state.padEnd(12)}${file}`);
    }
    lines.push("");
    lines.push(`  Bump the version and publish, or these stay out of step.`);
  }
}

lines.push("");
fs.rmSync(work, { recursive: true, force: true });
process.stdout.write(lines.join("\n") + "\n");
