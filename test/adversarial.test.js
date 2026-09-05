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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-adv-"));
  const home = path.join(dir, "home");
  const claude = path.join(dir, "claude");
  const project = path.join(dir, "proj");
  const projectDir = path.join(claude, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(projectDir, { recursive: true });
  return {
    dir,
    home,
    claude,
    project,
    transcript: path.join(projectDir, "s-1.jsonl"),
    env: {
      ...process.env,
      SAVEMYTOKENS_HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      SAVEMYTOKENS_SETTINGS: path.join(dir, "settings.json"),
      NO_COLOR: "1",
    },
  };
}

function turnLine(box, id, tokens, at) {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s-1",
    cwd: box.project,
    timestamp: new Date(at).toISOString(),
    message: {
      id,
      model: "claude-opus-5",
      content: [],
      usage: { input_tokens: tokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
}

function hook(box, event, payload) {
  return execFileSync("node", [HOOK, event], {
    env: box.env,
    input: JSON.stringify({ session_id: "s-1", transcript_path: box.transcript, cwd: box.project, ...payload }),
    encoding: "utf8",
  });
}

function statusline(box, payload) {
  return execFileSync("node", [STATUSLINE], {
    env: box.env,
    input: JSON.stringify({
      session_id: "s-1",
      transcript_path: box.transcript,
      cwd: box.project,
      workspace: { current_dir: box.project },
      model: { id: "claude-opus-5", display_name: "Opus" },
      ...payload,
    }),
    encoding: "utf8",
  });
}

function plan(box) {
  return JSON.parse(execFileSync("node", [CLI, "status", "--json"], { env: box.env, encoding: "utf8" }));
}

test("a truncated or rotated transcript is re-read, not skipped", () => {
  const box = sandbox();
  const now = Date.now();
  fs.writeFileSync(box.transcript, [turnLine(box, "a1", 5000, now - 60_000)].join("\n") + "\n");
  hook(box, "prompt", { prompt: "start the work on the parser and keep going" });
  assert.equal(plan(box).sessions[0].tokens, 5000);

  fs.writeFileSync(box.transcript, [turnLine(box, "b1", 700, now - 30_000)].join("\n") + "\n");
  hook(box, "prompt", { prompt: "and now continue with something else entirely" });
  assert.equal(plan(box).sessions[0].tokens, 700, "a shorter file is read from the start again");
});

test("corrupt lines and half-written records never break metering", () => {
  const box = sandbox();
  const now = Date.now();
  fs.writeFileSync(
    box.transcript,
    [
      "not json at all",
      '{"type":"assistant","message":{"id":"x","usage":{"input_tokens":',
      turnLine(box, "good", 1000, now - 60_000),
      "",
      '{"type":"assistant"}',
      '{"type":"assistant","message":{"id":"y","usage":{}}}',
    ].join("\n") + "\n",
  );
  hook(box, "prompt", { prompt: "read the file even though it is a mess in places" });
  assert.equal(plan(box).sessions[0].tokens, 1000, "the one good record is counted, the rest ignored");
});

test("a session with no project still gets a row", () => {
  const box = sandbox();
  fs.writeFileSync(box.transcript, turnLine(box, "a1", 900, Date.now() - 60_000) + "\n");
  const out = hook(box, "prompt", { cwd: "", prompt: "work with no working directory at all here" });
  assert.equal(typeof out, "string");
  const view = plan(box);
  assert.ok(view.projects.length >= 1, "it is grouped under something rather than dropped");
});

test("a wrapped status line that fails does not take ours down", () => {
  const box = sandbox();
  fs.mkdirSync(box.home, { recursive: true });
  fs.writeFileSync(
    path.join(box.home, "config.json"),
    JSON.stringify({ version: 1, wrappedStatusLine: "exit 3", theme: { tui: "default", hud: "default" } }),
  );
  fs.writeFileSync(box.transcript, turnLine(box, "a1", 900, Date.now() - 60_000) + "\n");
  const line = statusline(box, {});
  assert.ok(line.length > 0, "ours still prints when theirs exits non-zero");
  assert.doesNotMatch(line, /Error/);
});

test("hooks and the status line survive nonsense payloads", () => {
  const box = sandbox();
  const nonsense = [
    "{}",
    '{"session_id":null}',
    '{"session_id":"s-1","transcript_path":12345}',
    '{"session_id":"s-1","rate_limits":{"five_hour":{"used_percentage":"lots"}}}',
    '{"session_id":"s-1","rate_limits":{"five_hour":{"used_percentage":42,"resets_at":"soon"}}}',
    `{"session_id":"s-1","prompt":"${"x".repeat(5000)}"}`,
  ];
  for (const input of nonsense) {
    for (const event of ["session-start", "prompt", "stop", "session-end"]) {
      execFileSync("node", [HOOK, event], { env: box.env, input, encoding: "utf8" });
    }
    execFileSync("node", [STATUSLINE], { env: box.env, input, encoding: "utf8" });
  }
});

test("a window whose reset has passed is not used", () => {
  const box = sandbox();
  fs.writeFileSync(box.transcript, turnLine(box, "a1", 1000, Date.now() - 60_000) + "\n");
  statusline(box, {
    rate_limits: { five_hour: { used_percentage: 90, resets_at: Math.floor(Date.now() / 1000) - 60 } },
  });
  const out = plan(box);
  const five = out.resources.find((resource) => resource.id.endsWith("five_hour"));
  assert.equal(five.usedPercent, null, "an expired reading is void, not stale-but-usable");
  assert.equal(five.capacity.confidence, "unknown");
});

test("deferred work does not pile up without limit", () => {
  const box = sandbox();
  const now = Date.now();
  const lines = [turnLine(box, "a1", 500, now - 120_000)];
  for (let i = 0; i < 30; i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: "s-1",
        cwd: box.project,
        timestamp: new Date(now - 60_000 + i * 100).toISOString(),
        message: { id: `d${i}`, model: "claude-opus-5", content: [{ type: "text", text: `SMT: DEFER item number ${i}` }] },
      }),
    );
  }
  fs.writeFileSync(box.transcript, lines.join("\n") + "\n");
  hook(box, "prompt", { prompt: "do a great many things and defer most of them please" });
  hook(box, "stop", {});
  const listed = execFileSync("node", [CLI, "defer"], { env: box.env, encoding: "utf8" });
  const items = listed.split("\n").filter((line) => line.trim().startsWith("· item number"));
  assert.ok(items.length <= 12, `kept ${items.length} deferred items, expected at most 12`);
});

test("a settings file that is not valid JSON is never overwritten", () => {
  const box = sandbox();
  fs.writeFileSync(box.env.SAVEMYTOKENS_SETTINGS, "{ this is not json ");
  let output = "";
  try {
    output = execFileSync("node", [CLI, "install"], { env: box.env, encoding: "utf8" });
  } catch (error) {
    output = String(error.stdout ?? "");
  }
  const after = fs.readFileSync(box.env.SAVEMYTOKENS_SETTINGS, "utf8");
  assert.equal(after, "{ this is not json ", "their broken file is left exactly as it was");
  assert.match(output, /could not be read|not valid JSON|Refusing/i);
});

test("two hooks writing at once do not lose each other's work", () => {
  const box = sandbox();
  const now = Date.now();
  fs.writeFileSync(box.transcript, turnLine(box, "a1", 1000, now - 60_000) + "\n");
  const second = path.join(path.dirname(box.transcript), "s-2.jsonl");
  fs.writeFileSync(
    second,
    JSON.stringify({
      type: "assistant",
      sessionId: "s-2",
      cwd: box.project,
      timestamp: new Date(now - 60_000).toISOString(),
      message: { id: "b1", model: "claude-opus-5", content: [], usage: { input_tokens: 2000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }) + "\n",
  );

  const run = (id, transcript) =>
    execFileSync("node", [HOOK, "prompt"], {
      env: box.env,
      input: JSON.stringify({ session_id: id, transcript_path: transcript, cwd: box.project, prompt: "a prompt that is long enough to count" }),
      encoding: "utf8",
    });
  run("s-1", box.transcript);
  run("s-2", second);

  const sessions = plan(box).sessions;
  assert.equal(sessions.length, 2, "both sessions survive concurrent writes");
  assert.equal(sessions.reduce((sum, session) => sum + session.tokens, 0), 3000);
});

test("an implausible reset time is refused, not stored forever", () => {
  const box = sandbox();
  const now = Math.floor(Date.now() / 1000);
  const good = now + 7200;

  const send = (resetsAt) =>
    execFileSync("node", [STATUSLINE], {
      env: box.env,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "poison",
        transcript_path: "/does/not/exist",
        cwd: process.cwd(),
        rate_limits: { five_hour: { used_percentage: 42, resets_at: resetsAt } },
      }),
    });

  for (const bad of [9_999_999_999, good * 1000, 0, -5, Number.NaN]) {
    send(bad);
    const line = send(good);
    assert.match(line, /in 1h5\d|in 2h/, `resets_at ${bad} must not survive a good reading: ${line}`);
  }

  const stored = JSON.parse(fs.readFileSync(path.join(box.home, "quota", "claude-code.json"), "utf8"));
  assert.ok(
    stored.windows.five_hour.resetsAt * 1000 - Date.now() <= 11 * 3600_000,
    "nothing beyond a 5-hour window plus slack is ever written",
  );
});

test("a window that has rolled over says so instead of vanishing", async () => {
  const { planRows } = await import("../dist/report/views.js");
  const { loadTheme } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();
  const resource = (key, usedPercent, rolledOver) => ({
    id: `claude-code:${key}`,
    adapter: "claude-code",
    label: key,
    unit: "observed_usage",
    window: { kind: "rolling", ms: 18000000 },
    capacity: { amount: 100, confidence: rolledOver ? "unknown" : "published" },
    usedPercent,
    rolledOver,
  });
  const control = {
    provider: { id: "claude-code", label: "Claude Code" },
    installed: true,
    resources: [resource("five_hour", null, true), resource("seven_day", 21, false)],
    enforcement: ["advise"],
    unattributed: 0,
    deferred: [],
    others: [],
    config: { columns: ["allocation"] },
    schedule: { now, key: "five_hour", bounds: { from: now - 1, to: now + 1 }, quota: null, unusedPool: 0, claimants: [], projects: [] },
  };
  const context = {
    theme: loadTheme("default"),
    color: false,
    columns: 100,
    rows: 30,
    selected: 0,
    interactive: true,
    expanded: false,
    labels: new Map(),
  };
  const line = planRows(control, context)[0] ?? "";
  assert.match(line, /5h [\u2591\u2588]+\s+0%/, "the bar stays, at zero, because a window that just reset is empty");
  assert.match(line, /window just reset/, "and says why the countdown is missing");
  assert.match(line, /7d .*21%/, "the one still live is unaffected");
  assert.doesNotMatch(line, /5h.*4\d%/, "no stale percentage from a window that has ended");
});
