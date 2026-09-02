import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HOOK_SCRIPT } from "../dist/hooks/nudge.js";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-install-"));
  return {
    dir,
    settings: path.join(dir, "settings.json"),
    env: { ...process.env, SAVEMYTOKENS_HOME: path.join(dir, "home"), SAVEMYTOKENS_SETTINGS: path.join(dir, "settings.json") },
    hook: path.join(dir, "home", "hooks", "nudge.cjs"),
    read: () => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")),
  };
}

function cli(box, args) {
  return execFileSync("node", [CLI, ...args], { env: box.env, encoding: "utf8" });
}

test("dry run writes nothing at all", () => {
  const box = sandbox();
  const output = cli(box, ["install", "--dry-run"]);
  assert.match(output, /nothing was written/);
  assert.equal(fs.existsSync(box.hook), false);
  assert.equal(fs.existsSync(box.settings), false);
});

test("install adds one entry and leaves existing hooks alone", () => {
  const box = sandbox();
  fs.writeFileSync(
    box.settings,
    JSON.stringify({
      model: "opus",
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }],
      },
    }),
  );

  cli(box, ["install"]);
  const settings = box.read();
  assert.equal(settings.model, "opus", "unrelated settings survive");
  assert.equal(settings.hooks.Stop.length, 1, "other events are untouched");
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "/my/notify.sh", "their hook stays first");
  assert.match(settings.hooks.UserPromptSubmit[1].hooks[0].command, /nudge\.cjs$/);
  assert.ok(fs.existsSync(box.hook));
  assert.ok(fs.existsSync(path.join(box.env.SAVEMYTOKENS_HOME, "settings.backup.json")));
});

test("install is idempotent", () => {
  const box = sandbox();
  cli(box, ["install"]);
  const output = cli(box, ["install"]);
  assert.match(output, /already installed/);
  assert.equal(box.read().hooks.UserPromptSubmit.length, 1);
});

test("uninstall removes only our entry", () => {
  const box = sandbox();
  fs.writeFileSync(
    box.settings,
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/my/notify.sh" }] }] } }),
  );
  cli(box, ["install"]);
  cli(box, ["uninstall"]);
  const settings = box.read();
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, "/my/notify.sh");
  assert.equal(fs.existsSync(box.hook), false);
});

test("uninstall drops the event key when nothing else used it", () => {
  const box = sandbox();
  cli(box, ["install"]);
  cli(box, ["uninstall"]);
  assert.equal(box.read().hooks.UserPromptSubmit, undefined);
});

function runHook(box, payload, transcript) {
  fs.mkdirSync(path.dirname(box.hook), { recursive: true });
  fs.writeFileSync(box.hook, HOOK_SCRIPT);
  return execFileSync("node", [box.hook], {
    env: box.env,
    input: JSON.stringify({ transcript_path: transcript, ...payload }),
    encoding: "utf8",
  });
}

function transcriptWith(contextTokens, dir, name = "transcript") {
  const file = path.join(dir, name + ".jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: "assistant",
      message: {
        id: "m1",
        usage: { input_tokens: 2, cache_read_input_tokens: contextTokens, cache_creation_input_tokens: 0, output_tokens: 10 },
      },
    }) + "\n",
  );
  return file;
}

test("the hook warns on a new task at high context", () => {
  const box = sandbox();
  const transcript = transcriptWith(400_000, box.dir);
  const output = runHook(box, { session_id: "a", prompt: "add rate limiting to the invoice export endpoint" }, transcript);
  assert.match(output, /\[savemytokens\]/);
  assert.match(output, /400k tokens/);
});

test("the hook stays silent on follow-ups, low context, and repeats", () => {
  const box = sandbox();
  const busy = transcriptWith(400_000, box.dir);
  assert.equal(runHook(box, { session_id: "b", prompt: "ok now do the same for the other ones as well" }, busy), "");
  const quiet = transcriptWith(20_000, box.dir, "quiet");
  assert.equal(runHook(box, { session_id: "c", prompt: "add rate limiting to the invoice export endpoint" }, quiet), "");
  const first = runHook(box, { session_id: "d", prompt: "add rate limiting to the invoice export endpoint" }, busy);
  assert.notEqual(first, "");
  assert.equal(runHook(box, { session_id: "d", prompt: "add rate limiting to the invoice export endpoint" }, busy), "");
});

test("the hook exits 0 on malformed input and a missing transcript", () => {
  const box = sandbox();
  fs.mkdirSync(path.dirname(box.hook), { recursive: true });
  fs.writeFileSync(box.hook, HOOK_SCRIPT);
  for (const input of ["", "not json", "{}", '{"prompt":"x","transcript_path":"/nope/missing.jsonl"}']) {
    const output = execFileSync("node", [box.hook], { env: box.env, input, encoding: "utf8" });
    assert.equal(output, "");
  }
});

test("install adds fenced rules and uninstall restores the file exactly", () => {
  const box = sandbox();
  const memory = path.join(box.dir, "CLAUDE.md");
  box.env.SAVEMYTOKENS_MEMORY = memory;
  const original = "# My rules\n\n- Always use pnpm.\n";
  fs.writeFileSync(memory, original);

  cli(box, ["install"]);
  const after = fs.readFileSync(memory, "utf8");
  assert.match(after, /savemytokens:start/);
  assert.match(after, /Batch shell work/);
  assert.match(after, /- Always use pnpm\./, "their own rules survive");

  cli(box, ["uninstall"]);
  assert.equal(fs.readFileSync(memory, "utf8").trim(), original.trim());
});

test("install does not duplicate the rules block", () => {
  const box = sandbox();
  const memory = path.join(box.dir, "CLAUDE.md");
  box.env.SAVEMYTOKENS_MEMORY = memory;
  cli(box, ["install"]);
  cli(box, ["uninstall"]);
  cli(box, ["install"]);
  const text = fs.readFileSync(memory, "utf8");
  assert.equal(text.split("savemytokens:start").length - 1, 1);
});

test("install works when no CLAUDE.md exists yet", () => {
  const box = sandbox();
  const memory = path.join(box.dir, "fresh", "CLAUDE.md");
  box.env.SAVEMYTOKENS_MEMORY = memory;
  cli(box, ["install"]);
  assert.match(fs.readFileSync(memory, "utf8"), /Token discipline/);
});
