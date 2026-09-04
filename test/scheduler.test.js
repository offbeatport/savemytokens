import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const HOOK = new URL("../dist/runtime/hook.mjs", import.meta.url).pathname;
const STATUSLINE = new URL("../dist/runtime/statusline.mjs", import.meta.url).pathname;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-sched-"));
  const home = path.join(dir, "home");
  const claude = path.join(dir, "claude");
  const project = path.join(dir, "webinvoke");
  const projectDir = path.join(claude, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(projectDir, { recursive: true });
  return {
    dir,
    home,
    session: "s-1",
    project,
    transcript: path.join(projectDir, "s-1.jsonl"),
    env: { ...process.env, SAVEMYTOKENS_HOME: home, CLAUDE_CONFIG_DIR: claude, NO_COLOR: "1" },
  };
}

function turn(box, id, tokens, at, text) {
  return JSON.stringify({
    type: "assistant",
    sessionId: box.session,
    cwd: box.project,
    timestamp: new Date(at).toISOString(),
    message: {
      id,
      model: "claude-opus-5",
      content: text ? [{ type: "text", text }] : [],
      usage: { input_tokens: tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
}

function appendTurns(box, lines) {
  fs.appendFileSync(box.transcript, lines.join("\n") + "\n");
}

function runHook(box, event, payload) {
  return execFileSync("node", [HOOK, event], {
    env: box.env,
    input: JSON.stringify({ session_id: box.session, transcript_path: box.transcript, cwd: box.project, ...payload }),
    encoding: "utf8",
  });
}

function runStatusLine(box, payload) {
  return execFileSync("node", [STATUSLINE], {
    env: box.env,
    input: JSON.stringify({
      session_id: box.session,
      transcript_path: box.transcript,
      cwd: box.project,
      workspace: { current_dir: box.project },
      model: { id: "claude-opus-5", display_name: "Opus" },
      ...payload,
    }),
    encoding: "utf8",
  });
}

function rateLimits(fivePercent, sevenPercent = 10) {
  const resets = Math.floor(Date.now() / 1000) + 3600;
  return {
    rate_limits: {
      five_hour: { used_percentage: fivePercent, resets_at: resets },
      seven_day: { used_percentage: sevenPercent, resets_at: resets + 86400 },
    },
  };
}

function quota(box) {
  return JSON.parse(fs.readFileSync(path.join(box.home, "quota", "claude-code.json"), "utf8"));
}

function plan(box) {
  return JSON.parse(execFileSync("node", [CLI, "status", "--json"], { env: box.env, encoding: "utf8" }));
}

test("the status line is the only place the published window is captured from", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);

  const withoutLimits = runStatusLine(box, {});
  assert.match(withoutLimits, /SMT/);
  assert.equal(fs.existsSync(path.join(box.home, "quota", "claude-code.json")), false, "nothing to capture yet");

  const line = runStatusLine(box, rateLimits(42.5));
  const captured = quota(box);
  assert.equal(captured.windows.five_hour.usedPercent, 42.5);
  assert.equal(captured.windows.seven_day.usedPercent, 10);
  assert.ok(captured.windows.five_hour.resetsAt > Math.floor(Date.now() / 1000));
  assert.match(line, /5h 43%/, "the HUD shows the published number, not an estimate");
});

test("a status line already in place is wrapped, not replaced", () => {
  const box = sandbox();
  fs.mkdirSync(box.home, { recursive: true });
  fs.writeFileSync(
    path.join(box.home, "config.json"),
    JSON.stringify({ version: 1, wrappedStatusLine: "printf 'mine'", theme: { tui: "default", hud: "default" } }),
  );
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  const line = runStatusLine(box, rateLimits(10));
  assert.match(line, /^mine {2}SMT/, "their output comes first, ours is appended");
});

test("session start states the target share and the release protocol", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  const out = runHook(box, "session-start", { source: "startup" });
  assert.match(out, /target share of the current Claude window is 100%/);
  assert.match(out, /SMT: DONE/);
  assert.match(out, /SMT: BLOCKED/);
});

test("advice fires once per stage, against the published window", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 5000, Date.now() - 60_000)]);
  runStatusLine(box, rateLimits(95));

  const first = runHook(box, "prompt", { prompt: "add rate limiting to the invoice export endpoint" });
  assert.match(first, /Verification and finalisation only/);
  const second = runHook(box, "prompt", { prompt: "and now the other endpoint as well" });
  assert.doesNotMatch(second, /Verification and finalisation only/, "the same stage never repeats in one window");
});

test("no published window and one session means no budget advice at all", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 500_000, Date.now() - 60_000)]);
  const out = runHook(box, "prompt", { prompt: "add rate limiting to the invoice export endpoint" });
  assert.doesNotMatch(out, /target share of this window/);
});

test("DONE releases the unused share back to the pool", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  runStatusLine(box, rateLimits(40));
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });

  const before = plan(box).claimants[0];
  assert.equal(before.state, "active");
  assert.ok(before.target > 0.9, "the only running session holds the window");

  appendTurns(box, [turn(box, "m2", 1000, Date.now() - 30_000, "All finished.\n\nSMT: DONE")]);
  runHook(box, "stop", {});

  const after = plan(box);
  assert.equal(after.claimants[0].state, "done");
  assert.ok(after.unusedPool > 0.5, "the share it never used goes back to the pool");
});

test("metering is incremental and never counts a turn twice", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "m1", 1000, now - 120_000), turn(box, "m1", 1000, now - 120_000)]);
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });
  const first = plan(box).claimants[0].tokens;
  assert.equal(first, 1000, "a repeated message id is one turn");

  runHook(box, "prompt", { prompt: "same again" });
  assert.equal(plan(box).claimants[0].tokens, 1000, "re-running the hook re-reads nothing");

  appendTurns(box, [turn(box, "m2", 500, now - 60_000)]);
  runHook(box, "prompt", { prompt: "and now the next one" });
  assert.equal(plan(box).claimants[0].tokens, 1500, "only the new turn is added");
});

test("usage outside the published window is not counted against it", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "old", 9_000_000, now - 6 * 60 * 60 * 1000), turn(box, "new", 1000, now - 60_000)]);
  runStatusLine(box, rateLimits(20));
  assert.equal(plan(box).claimants[0].tokens, 1000, "the six-hour-old turn is outside the 5h window");
});

test("the dead carry warning survives as part of the same hook", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 400_000, Date.now() - 60_000)]);
  const out = runHook(box, "prompt", { prompt: "add rate limiting to the invoice export endpoint" });
  assert.match(out, /400k tokens of earlier work are still in context/);
  const followUp = runHook(box, "prompt", { prompt: "ok now do the same for the other ones" });
  assert.doesNotMatch(followUp, /still in context/, "follow-up prompts stay quiet");
});

test("hooks exit 0 and print nothing on malformed input", () => {
  const box = sandbox();
  for (const input of ["", "not json", "{}"]) {
    for (const event of ["session-start", "prompt", "stop", "session-end"]) {
      const out = execFileSync("node", [HOOK, event], { env: box.env, input, encoding: "utf8" });
      assert.equal(out, "");
    }
  }
});
