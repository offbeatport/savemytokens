import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseCodexSession, patchedFiles } from "../dist/adapters/codex/parse.js";
import { rateFor, usd } from "../dist/core/pricing.js";
import { writeFixture } from "./fixture.js";

let clock = Date.parse("2026-08-01T10:00:00.000Z");
const stamp = () => new Date((clock += 1_000)).toISOString();

const meta = () => ({
  timestamp: stamp(),
  type: "session_meta",
  payload: { id: "019e-codex", cwd: "/tmp/demo", cli_version: "0.130.0", originator: "codex-tui" },
});
const context = () => ({ timestamp: stamp(), type: "turn_context", payload: { cwd: "/tmp/demo", model: "gpt-5.5" } });
const userMessage = (message) => ({ timestamp: stamp(), type: "event_msg", payload: { type: "user_message", message } });
const tokens = (input, cached, output, quota = 12) => ({
  timestamp: stamp(),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output },
      model_context_window: 272_000,
    },
    rate_limits: { primary: { used_percent: quota, window_minutes: 300 } },
  },
});
const call = (id, cmd) => ({
  timestamp: stamp(),
  type: "response_item",
  payload: { type: "function_call", name: "exec_command", call_id: id, arguments: JSON.stringify({ cmd, workdir: "/tmp/demo" }) },
});
const callOutput = (id, output) => ({
  timestamp: stamp(),
  type: "response_item",
  payload: { type: "function_call_output", call_id: id, output },
});
const patch = (id, body) => ({
  timestamp: stamp(),
  type: "response_item",
  payload: { type: "custom_tool_call", name: "apply_patch", call_id: id, input: body },
});

function rollout() {
  return [
    meta(),
    context(),
    userMessage("audit the pricing module and tell me what is wrong with it"),
    tokens(20_000, 8_000, 400),
    tokens(20_000, 8_000, 400),
    call("c1", "cd /tmp/demo && pnpm build --verbose"),
    callOutput("c1", "Process exited with code 0\nOutput:\n" + "x".repeat(60_000)),
    tokens(40_000, 30_000, 300),
    call("c2", "pnpm test"),
    callOutput("c2", "Process exited with code 1\nFAIL src/pricing.test.ts"),
    tokens(45_000, 35_000, 200),
    patch("c3", "*** Begin Patch\n*** Update File: src/pricing.ts\n+const a = 1;\n"),
    patch("c4", "*** Begin Patch\n*** Update File: src/pricing.ts\n+const b = 2;\n"),
    tokens(50_000, 40_000, 900),
    { timestamp: stamp(), type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } },
  ];
}

test("codex usage is deduped the way codex itself totals it", async () => {
  const { file } = writeFixture("rollout-test", rollout());
  const evidence = await parseCodexSession(file, fs.statSync(file));
  assert.equal(evidence.adapter, "codex");
  assert.equal(evidence.turns, 4, "the repeated token_count event is not double counted");
  assert.equal(evidence.usage.cacheRead, 8_000 + 30_000 + 35_000 + 40_000);
  assert.equal(evidence.usage.input, 12_000 + 10_000 + 10_000 + 10_000, "cached tokens are excluded from fresh input");
  assert.equal(evidence.usage.output, 400 + 300 + 200 + 900);
});

test("codex tasks, tools, failures and patches are captured", async () => {
  const { file } = writeFixture("rollout-test", rollout());
  const evidence = await parseCodexSession(file, fs.statSync(file));
  assert.equal(evidence.tasks.length, 1);
  assert.equal(evidence.tasks[0].turns, 4);
  assert.ok(evidence.tasks[0].usd > 0);
  assert.equal(evidence.interruptions, 1);
  assert.equal(evidence.toolErrors, 1);
  assert.ok(evidence.failures.some((f) => f.label === "pnpm test"));
  assert.ok(evidence.outputs.some((o) => o.label === "pnpm build"));
  const write = evidence.writes.find((w) => w.path === "src/pricing.ts");
  assert.ok(write, "apply_patch targets become write buckets");
  assert.equal(write.writes, 2);
});

test("apply_patch headers are parsed into file paths", () => {
  const files = patchedFiles("*** Begin Patch\n*** Add File: a/b.ts\n*** Update File: c.ts\n*** Delete File: d.ts\n+x");
  assert.deepEqual(files, ["a/b.ts", "c.ts", "d.ts"]);
});

test("openai and anthropic rates are both known, unknown models fall back", () => {
  assert.deepEqual(rateFor("gpt-5.5"), { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 });
  assert.deepEqual(rateFor("claude-opus-5"), { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.equal(rateFor("gpt-5.6-luna").output, 1.2);
  assert.equal(usd("gpt-5.5", { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }), 5);
  assert.equal(usd("gpt-5.5", { input: 0, output: 0, cacheWrite: 0, cacheRead: 1_000_000 }), 0.5);
  assert.equal(rateFor("some-unreleased-model").input, 5);
});
