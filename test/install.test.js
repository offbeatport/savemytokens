import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-install-"));
  const home = path.join(dir, "home");
  return {
    dir,
    home,
    settings: path.join(dir, "settings.json"),
    hooks: path.join(home, "hooks"),
    env: {
      ...process.env,
      SAVEMYTOKENS_HOME: home,
      SAVEMYTOKENS_SETTINGS: path.join(dir, "settings.json"),
      CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
      NO_COLOR: "1",
    },
    read: () => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")),
    config: () => JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")),
  };
}

function cli(box, args) {
  return execFileSync("node", [CLI, ...args], { env: box.env, encoding: "utf8" });
}

test("dry run writes nothing and shows every event it would add", () => {
  const box = sandbox();
  const output = cli(box, ["install", "--dry-run"]);
  assert.match(output, /nothing was written/);
  for (const event of EVENTS) assert.match(output, new RegExp(event));
  assert.match(output, /statusLine/);
  assert.equal(fs.existsSync(box.settings), false);
  assert.equal(fs.existsSync(box.hooks), false);
});

test("install adds the hooks and the status line, and leaves the rest alone", () => {
  const box = sandbox();
  fs.writeFileSync(
    box.settings,
    JSON.stringify({
      model: "opus",
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }],
      },
    }),
  );

  cli(box, ["install"]);
  const settings = box.read();
  assert.equal(settings.model, "opus", "unrelated settings survive");
  assert.equal(settings.hooks.PostToolUse.length, 1, "other events are untouched");
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "/my/notify.sh", "their hook stays first");
  for (const event of EVENTS) {
    assert.match(settings.hooks[event].at(-1).hooks[0].command, /hook\.mjs [a-z-]+$/);
  }
  assert.match(settings.statusLine.command, /statusline\.mjs/);
  for (const file of ["kernel.mjs", "hook.mjs", "statusline.mjs"]) {
    assert.ok(fs.existsSync(path.join(box.hooks, file)), `${file} is installed`);
  }
  assert.ok(fs.existsSync(path.join(box.home, "settings.backup.json")));
});

test("install is idempotent", () => {
  const box = sandbox();
  cli(box, ["install"]);
  cli(box, ["install"]);
  const settings = box.read();
  for (const event of EVENTS) assert.equal(settings.hooks[event].length, 1);
});

test("someone else's status line is kept unless you force it", () => {
  const box = sandbox();
  fs.writeFileSync(box.settings, JSON.stringify({ statusLine: { type: "command", command: "ccusage statusline" } }));

  const output = cli(box, ["install"]);
  assert.match(output, /Your status line is already set to something else/);
  assert.equal(box.read().statusLine.command, "ccusage statusline", "theirs is untouched");
  assert.equal(box.config().wrappedStatusLine, null);

  cli(box, ["install", "--force"]);
  assert.match(box.read().statusLine.command, /statusline\.mjs/);
  assert.equal(box.config().wrappedStatusLine, "ccusage statusline", "theirs is wrapped, not lost");
});

test("uninstall removes only our entries and restores a wrapped status line", () => {
  const box = sandbox();
  fs.writeFileSync(
    box.settings,
    JSON.stringify({
      statusLine: { type: "command", command: "ccusage statusline" },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }] },
    }),
  );
  cli(box, ["install", "--force"]);
  cli(box, ["uninstall"]);

  const settings = box.read();
  assert.equal(settings.statusLine.command, "ccusage statusline", "their status line comes back");
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "/my/notify.sh");
  assert.equal(settings.hooks.SessionStart, undefined, "events we added and nobody else used are dropped");
  assert.equal(fs.existsSync(box.hooks), false, "the scripts are gone");
  assert.ok(fs.existsSync(box.home), "local state stays unless you ask for it to go");
});

test("uninstall --purge deletes the local state as well", () => {
  const box = sandbox();
  cli(box, ["install"]);
  cli(box, ["uninstall", "--purge"]);
  assert.equal(fs.existsSync(box.home), false);
});

test("--purge will not delete the default state directory unattended", () => {
  const box = sandbox();
  const home = path.join(os.homedir(), ".savemytokens");
  const canary = path.join(home, "config.json");
  const before = fs.existsSync(canary) ? fs.readFileSync(canary, "utf8") : null;
  let output = "";
  try {
    output = execFileSync("node", [CLI, "uninstall", "--purge"], {
      env: { ...box.env, SAVEMYTOKENS_HOME: home },
      encoding: "utf8",
    });
  } catch (error) {
    output = String(error.stdout ?? "");
  }
  assert.match(output, /Refusing to (delete|touch)/, "it says no rather than deleting your state");
  assert.equal(fs.existsSync(canary) ? fs.readFileSync(canary, "utf8") : null, before, "your real config is untouched");
});

test("a half-sandboxed run touches nothing at all", () => {
  const real = path.join(os.homedir(), ".savemytokens", "hooks");
  const existed = fs.existsSync(real);
  for (const missing of ["SAVEMYTOKENS_HOME", "SAVEMYTOKENS_SETTINGS"]) {
    const box = sandbox();
    const env = { ...box.env };
    delete env[missing];
    delete env.CLAUDE_CONFIG_DIR;
    for (const command of ["install", "uninstall"]) {
      let output = "";
      try {
        output = execFileSync("node", [CLI, command], { env, encoding: "utf8" });
      } catch (error) {
        output = String(error.stdout ?? "");
      }
      assert.match(output, /Half of this run is sandboxed/, `${command} refuses when ${missing} is unset`);
    }
  }
  assert.equal(fs.existsSync(real), existed, "the real hooks directory is exactly as it was");
});

test("the CLAUDE.md block is opt-in and removed byte-exactly", () => {
  const box = sandbox();
  const memory = path.join(box.dir, "CLAUDE.md");
  box.env.SAVEMYTOKENS_MEMORY = memory;
  const original = "# My rules\n\n- Always use pnpm.\n";
  fs.writeFileSync(memory, original);

  cli(box, ["install"]);
  assert.equal(fs.readFileSync(memory, "utf8"), original, "install leaves projects and memory untouched by default");

  cli(box, ["install", "--rules"]);
  const after = fs.readFileSync(memory, "utf8");
  assert.match(after, /savemytokens:start/);
  assert.match(after, /- Always use pnpm\./, "their own rules survive");

  cli(box, ["uninstall"]);
  assert.equal(fs.readFileSync(memory, "utf8").trim(), original.trim());
});
