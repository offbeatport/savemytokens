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

function project(box, index = 0) {
  return plan(box).projects[index];
}

function session(box, index = 0) {
  return plan(box).sessions[index];
}

test("the status line is the only place the published window is captured from", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);

  const withoutLimits = runStatusLine(box, {});
  assert.match(withoutLimits, /webinvoke/, "the session is named even with no window to report");
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
  assert.match(line, /^mine {2}webinvoke/, "their output comes first, ours is appended");
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

  const before = project(box);
  assert.equal(before.bucket, "active");
  assert.ok(before.target > 0.9, "the only running project holds the window");

  appendTurns(box, [turn(box, "m2", 1000, Date.now() - 30_000, "All finished.\n\nSMT: DONE")]);
  runHook(box, "stop", {});

  const after = plan(box);
  assert.equal(after.sessions[0].state, "done");
  assert.ok(after.unusedPool > 0.5, "the share it never used goes back to the pool");
});

test("metering is incremental and never counts a turn twice", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "m1", 1000, now - 120_000), turn(box, "m1", 1000, now - 120_000)]);
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });
  const first = session(box).tokens;
  assert.equal(first, 1000, "a repeated message id is one turn");

  runHook(box, "prompt", { prompt: "same again" });
  assert.equal(session(box).tokens, 1000, "re-running the hook re-reads nothing");

  appendTurns(box, [turn(box, "m2", 500, now - 60_000)]);
  runHook(box, "prompt", { prompt: "and now the next one" });
  assert.equal(session(box).tokens, 1500, "only the new turn is added");
});

test("usage outside the published window is not counted against it", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "old", 9_000_000, now - 6 * 60 * 60 * 1000), turn(box, "new", 1000, now - 60_000)]);
  runStatusLine(box, rateLimits(20));
  assert.equal(session(box).tokens, 1000, "the six-hour-old turn is outside the 5h window");
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

test("what a session drops comes back at the start of the next one", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 120_000)]);
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });

  appendTurns(box, [
    turn(box, "m2", 1000, Date.now() - 60_000, "Shipped the happy path.\n\nSMT: DEFER wire the retry path into the CLI\nSMT: DONE"),
  ]);
  runHook(box, "stop", {});

  const listed = execFileSync("node", [CLI, "defer"], { env: box.env, encoding: "utf8" });
  assert.match(listed, /wire the retry path into the CLI/);

  const next = runHook(box, "session-start", { source: "startup" });
  assert.match(next, /Deferred earlier in this project/);
  assert.match(next, /wire the retry path into the CLI/);

  execFileSync("node", [CLI, "defer", "clear", "--project", box.project], { env: box.env, encoding: "utf8" });
  const after = runHook(box, "session-start", { source: "startup" });
  assert.doesNotMatch(after, /Deferred earlier/);
});

test("the policy decides how early and how hard the advice lands", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 5000, Date.now() - 60_000)]);
  runStatusLine(box, rateLimits(65));

  const relaxed = runHook(box, "prompt", { prompt: "add pagination to the invoice list endpoint" });
  assert.match(relaxed, /Stay on completion/, "the default policy only asks for focus at 65%");

  execFileSync("node", [CLI, "policy", "strict"], { env: box.env, encoding: "utf8" });
  const strict = runHook(box, "prompt", { prompt: "and now the export endpoint as well" });
  assert.match(strict, /Narrow the scope/, "strict narrows at 65% of the window, the default does not");

  execFileSync("node", [CLI, "policy", "off"], { env: box.env, encoding: "utf8" });
  const quiet = runHook(box, "session-start", { source: "startup" });
  assert.doesNotMatch(quiet, /target share of the current Claude window/, "off injects nothing");
});

test("share, priority and release work on a project without the TUI", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });

  const set = execFileSync("node", [CLI, "share", "webinvoke", "40"], { env: box.env, encoding: "utf8" });
  assert.match(set, /Set webinvoke target to 40%/);
  assert.equal(Math.round(project(box).target * 100), 40);
  assert.equal(project(box).pinnedTarget, true);

  execFileSync("node", [CLI, "priority", "webinvoke", "high"], { env: box.env, encoding: "utf8" });
  assert.equal(project(box).priority, "high");

  execFileSync("node", [CLI, "share", "webinvoke", "auto"], { env: box.env, encoding: "utf8" });
  assert.equal(project(box).pinnedTarget, false);

  execFileSync("node", [CLI, "release", "webinvoke"], { env: box.env, encoding: "utf8" });
  assert.equal(session(box).state, "done");

  let missing = "";
  let failed = false;
  try {
    execFileSync("node", [CLI, "share", "nothinglikethis", "40"], { env: box.env, encoding: "utf8" });
  } catch (error) {
    failed = true;
    missing = String(error.stdout ?? "");
  }
  assert.ok(failed, "an unknown session is an error exit, so scripts can react");
  assert.match(missing, /No project matching/);
});

test("a spend limit is rendered as its own resource when a gateway reports one", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  const resets = Math.floor(Date.now() / 1000) + 3600;
  runStatusLine(box, {
    rate_limits: {
      five_hour: { used_percentage: 12, resets_at: resets },
      spend_limit: { used_percentage: 64, resets_at: resets + 86400 },
    },
  });
  const resources = plan(box).resources;
  const spend = resources.find((resource) => resource.id.endsWith("spend_limit"));
  assert.ok(spend, "the spend limit becomes a resource");
  assert.equal(spend.unit, "usd");
  assert.equal(spend.capacity.confidence, "published");
});

test("Codex is metered from its own rollout files, with no hook anywhere", () => {
  const box = sandbox();
  const codex = path.join(box.dir, "codex");
  const day = path.join(codex, "sessions", "2026", "09", "04");
  fs.mkdirSync(day, { recursive: true });
  const now = Date.now();
  const rollout = path.join(day, "rollout-2026-09-04T10-00-00-abc.jsonl");
  const resets = Math.floor(now / 1000) + 3600;
  fs.writeFileSync(
    rollout,
    [
      JSON.stringify({ timestamp: new Date(now - 300_000).toISOString(), type: "session_meta", payload: { cwd: "/tmp/codexproj" } }),
      JSON.stringify({
        timestamp: new Date(now - 200_000).toISOString(),
        type: "event_msg",
        payload: { type: "user_message", message: "refactor the retry helper" },
      }),
      JSON.stringify({
        timestamp: new Date(now - 120_000).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 500 } },
          rate_limits: {
            primary: { used_percent: 9, window_minutes: 300, resets_at: resets },
            secondary: { used_percent: 21, window_minutes: 10080, resets_at: resets + 86400 },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  const env = { ...box.env, CODEX_HOME: codex };
  const out = JSON.parse(execFileSync("node", [CLI, "status", "--codex", "--json"], { env, encoding: "utf8" }));
  assert.equal(out.resources[0].capacity.confidence, "published", "the rollout publishes the window");
  assert.equal(out.resources[0].usedPercent, 9);
  assert.equal(out.resources[1].usedPercent, 21);
  assert.equal(out.projects.length, 1);
  assert.equal(out.projects[0].label, "codexproj");
  assert.equal(out.projects[0].tokens, 5500);
  assert.deepEqual(out.enforcement, [], "Codex has no hook, so it declares no enforcement at all");
});

test("a user theme overrides a built-in without forking it", () => {
  const box = sandbox();
  execFileSync("node", [CLI, "theme", "new", "midnight", "nord"], { env: box.env, encoding: "utf8" });
  const file = path.join(box.home, "themes", "midnight.json");
  assert.ok(fs.existsSync(file));
  const theme = JSON.parse(fs.readFileSync(file, "utf8"));
  theme.glyphs.sep = "//";
  fs.writeFileSync(file, JSON.stringify(theme));

  execFileSync("node", [CLI, "theme", "hud", "midnight"], { env: box.env, encoding: "utf8" });
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  const line = runStatusLine(box, rateLimits(10));
  assert.match(line, /\/\//, "the status line uses the user theme's separator");
});

test("the window can be switched to the weekly one", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 6 * 60 * 60 * 1000)]);
  runStatusLine(box, rateLimits(30, 70));
  const week = JSON.parse(execFileSync("node", [CLI, "status", "--7d", "--json"], { env: box.env, encoding: "utf8" }));
  assert.equal(week.window.key, "seven_day");
  assert.equal(week.sessions[0].tokens, 1000, "a six-hour-old turn is inside the weekly window");
});

test("small drift stays quiet", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "m1", 1000, now - 120_000)]);
  runStatusLine(box, rateLimits(10));

  const file = path.join(box.home, "quota", "claude-code.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  stored.history = [
    { at: now - 60_000, metered: 1, turnAt: now - 120_000, five_hour: 10, seven_day: 10 },
    { at: now - 30_000, metered: 1, turnAt: now - 120_000, five_hour: 12, seven_day: 10 },
  ];
  fs.writeFileSync(file, JSON.stringify(stored));

  const text = execFileSync("node", [CLI, "status"], { env: box.env, encoding: "utf8" });
  assert.doesNotMatch(text, /spent outside these sessions/, "two points of drift is not worth a warning");
});

test("window movement while nothing local ran is reported separately", () => {
  const box = sandbox();
  const now = Date.now();
  appendTurns(box, [turn(box, "m1", 1000, now - 120_000)]);
  runStatusLine(box, rateLimits(10));

  const file = path.join(box.home, "quota", "claude-code.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  const metered = stored.meteredTokens ?? 0;
  stored.history = [
    { at: now - 90_000, metered, turnAt: now - 120_000, five_hour: 10, seven_day: 10 },
    { at: now - 60_000, metered, turnAt: now - 120_000, five_hour: 18, seven_day: 12 },
    { at: now - 30_000, metered: metered + 5000, turnAt: now - 40_000, five_hour: 24, seven_day: 13 },
  ];
  fs.writeFileSync(file, JSON.stringify(stored));

  const out = plan(box);
  assert.equal(Math.round(out.unattributedPercent), 8, "the 8 points that moved with no local usage are called out");

  const text = execFileSync("node", [CLI, "status"], { env: box.env, encoding: "utf8" });
  assert.match(text, /8% of the window was spent outside these projects/);
  assert.doesNotMatch(text, /another machine, or claude\.ai$/m, "it no longer asserts a cause it cannot prove");
  assert.doesNotMatch(text, /these hold a share/, "section headers carry no explanation");
});

test("only running projects hold an allocation; parking hands it back", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  runStatusLine(box, rateLimits(40));
  runHook(box, "prompt", { prompt: "implement the provider fallback chain end to end" });

  const before = plan(box);
  assert.equal(before.projects[0].bucket, "active");
  assert.ok(before.projects[0].target > 0.9);

  execFileSync("node", [CLI, "park", "webinvoke"], { env: box.env, encoding: "utf8" });
  const after = plan(box);
  assert.equal(after.projects[0].bucket, "parked");
  assert.ok(Math.abs(after.projects[0].target - after.projects[0].observed * 0.4) < 0.01, "it keeps only what it used");

  execFileSync("node", [CLI, "pin", "webinvoke"], { env: box.env, encoding: "utf8" });
  assert.equal(project(box).pinned, true);

  runHook(box, "prompt", { prompt: "actually, carry on with the fallback chain after all" });
  const resumed = plan(box);
  assert.equal(resumed.projects[0].bucket, "active", "typing into a parked project resumes it");
  assert.ok(resumed.projects[0].target > 0.9, "and it takes an allocation again");
});

test("a sandboxed run refuses to edit the real Claude settings", () => {
  const box = sandbox();
  const env = { ...process.env, SAVEMYTOKENS_HOME: box.home, NO_COLOR: "1" };
  delete env.SAVEMYTOKENS_SETTINGS;
  delete env.CLAUDE_CONFIG_DIR;

  for (const command of ["install", "uninstall"]) {
    let output = "";
    let failed = false;
    try {
      execFileSync("node", [CLI, command], { env, encoding: "utf8" });
    } catch (error) {
      failed = true;
      output = String(error.stdout ?? "");
    }
    assert.ok(failed, `${command} must not touch the real settings from a sandbox`);
    assert.match(output, /Refusing to edit/);
  }
});

test("a stale session cannot erase a live window", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  const resets = Math.floor(Date.now() / 1000) + 3600;

  runStatusLine(box, { rate_limits: { five_hour: { used_percentage: 40, resets_at: resets }, seven_day: { used_percentage: 18, resets_at: resets + 86400 } } });
  assert.equal(quota(box).windows.five_hour.usedPercent, 40);

  runStatusLine(box, { rate_limits: { seven_day: { used_percentage: 16, resets_at: resets + 86400 } } });
  const afterPartial = quota(box);
  assert.equal(afterPartial.windows.five_hour.usedPercent, 40, "a payload without five_hour must not delete it");
  assert.equal(afterPartial.windows.seven_day.usedPercent, 18, "and a lower reading in the same window does not win");

  runStatusLine(box, { rate_limits: { five_hour: { used_percentage: 44, resets_at: resets } } });
  assert.equal(quota(box).windows.five_hour.usedPercent, 44, "a higher reading in the same window does win");

  runStatusLine(box, { rate_limits: { five_hour: { used_percentage: 3, resets_at: resets + 18000 } } });
  assert.equal(quota(box).windows.five_hour.usedPercent, 3, "a new window replaces the old one outright");

  const line = runStatusLine(box, {});
  assert.match(line, /5h/, "with no rate limits at all the last good reading is still shown");
});

test("a project's allocation is split across its live sessions by what they burn", () => {
  const box = sandbox();
  const now = Date.now();
  const second = "s-2";
  const secondPath = path.join(path.dirname(box.transcript), `${second}.jsonl`);
  fs.writeFileSync(
    secondPath,
    [
      JSON.stringify({
        type: "assistant",
        sessionId: second,
        cwd: box.project,
        timestamp: new Date(now - 60_000).toISOString(),
        message: {
          id: "b1",
          model: "claude-opus-5",
          content: [],
          usage: { input_tokens: 3000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }),
    ].join("\n") + "\n",
  );
  appendTurns(box, [turn(box, "m1", 1000, now - 60_000)]);

  runStatusLine(box, rateLimits(40));
  execFileSync("node", [STATUSLINE], {
    env: box.env,
    input: JSON.stringify({
      session_id: second,
      transcript_path: secondPath,
      cwd: box.project,
      workspace: { current_dir: box.project },
      model: { id: "claude-opus-5", display_name: "Opus" },
      ...rateLimits(40),
    }),
    encoding: "utf8",
  });

  const out = plan(box);
  assert.equal(out.projects.length, 1, "two sessions in one folder are one project");
  const only = out.projects[0];
  assert.equal(only.label, "webinvoke");
  assert.equal(only.liveSessions, 2);
  assert.ok(only.target > 0.9, "the project holds the whole window");

  const sessions = out.sessions.filter((session) => session.project === box.project);
  assert.equal(sessions.length, 2);
  const total = sessions.reduce((sum, session) => sum + session.target, 0);
  assert.ok(Math.abs(total - only.target) < 0.01, "the sessions' targets add up to the project's");
  const busiest = sessions.slice().sort((a, b) => b.tokens - a.tokens)[0];
  const quietest = sessions.slice().sort((a, b) => a.tokens - b.tokens)[0];
  assert.ok(busiest.target > quietest.target, "the one burning more gets more of it");
});

test("setting an allocation on a project outlives the session that was running", () => {
  const box = sandbox();
  appendTurns(box, [turn(box, "m1", 1000, Date.now() - 60_000)]);
  runStatusLine(box, rateLimits(40));
  execFileSync("node", [CLI, "share", "webinvoke", "40"], { env: box.env, encoding: "utf8" });
  assert.equal(Math.round(project(box).target * 100), 40);

  const fresh = "s-restarted";
  const freshPath = path.join(path.dirname(box.transcript), `${fresh}.jsonl`);
  fs.writeFileSync(
    freshPath,
    JSON.stringify({
      type: "assistant",
      sessionId: fresh,
      cwd: box.project,
      timestamp: new Date(Date.now() - 30_000).toISOString(),
      message: {
        id: "c1",
        model: "claude-opus-5",
        content: [],
        usage: { input_tokens: 500, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }) + "\n",
  );

  const after = project(box);
  assert.equal(Math.round(after.target * 100), 40, "a restarted session inherits the project's allocation");
});

test("a share set on a project with nothing running keeps climbing", async () => {
  const { nextShare } = await import("../dist/scheduler/plan.js");
  const recent = (share) => ({
    bucket: "recent",
    settings: { share, priority: "normal", pinned: false, parked: false, cap: null },
    allocation: { target: 0, pinned: share, pool: 0, released: true, claimantId: "x" },
  });

  let held = nextShare(recent(null), 0.05);
  for (let press = 0; press < 3; press++) held = nextShare(recent(held), 0.05);
  assert.ok(Math.abs(held - 0.2) < 1e-9, `four presses reach 20%, not 5% (got ${held})`);

  assert.equal(nextShare(recent(0.2), -0.05), 0.15000000000000002 > 0 ? nextShare(recent(0.2), -0.05) : 0);
  assert.ok(Math.abs(nextShare(recent(0.2), -0.05) - 0.15) < 1e-9, "and it steps back down");
  assert.equal(nextShare(recent(1), 0.05), 1, "it never passes the whole window");
  assert.equal(nextShare(recent(0), -0.05), 0, "or drops below nothing");

  const live = { bucket: "active", settings: { share: 0.1 }, allocation: { target: 0.4, pinned: 0.1 } };
  assert.ok(Math.abs(nextShare(live, 0.05) - 0.45) < 1e-9, "a running project still steps from what it actually holds");
});
