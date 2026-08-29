import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { commandLabel, parseClaudeSession } from "../dist/adapters/claude-code/parse.js";
import { assistantTurn, hookAttachment, humanPrompt, toolResult, toolUse, writeFixture } from "./fixture.js";

const SESSION = "s1";
const FILE_BODY = "export const a = 1;\n".repeat(600);

function buildSession() {
  const records = [humanPrompt(SESSION, "p1", "add a feature")];

  records.push(
    assistantTurn(SESSION, "m1", { input: 2, output: 100, cacheWrite: 20_000, cacheRead: 0 }, [
      { type: "thinking", thinking: "" },
    ]),
  );
  records.push(
    assistantTurn(SESSION, "m1", { input: 2, output: 100, cacheWrite: 20_000, cacheRead: 0 }, [
      toolUse("t1", "Read", { file_path: "/tmp/demo/src/app.ts" }),
    ]),
  );
  records.push(
    toolResult(SESSION, "t1", FILE_BODY, { type: "text", file: { filePath: "/tmp/demo/src/app.ts", content: FILE_BODY, startLine: 1, numLines: 600, totalLines: 600 } }),
  );

  for (let i = 2; i <= 6; i++) {
    records.push(
      assistantTurn(SESSION, `m${i}`, { input: 2, output: 120, cacheWrite: 1_000, cacheRead: 40_000 }, [
        toolUse(`t${i}`, "Read", { file_path: "/tmp/demo/src/app.ts" }),
      ]),
    );
    records.push(
      toolResult(SESSION, `t${i}`, FILE_BODY, { type: "text", file: { filePath: "/tmp/demo/src/app.ts", content: FILE_BODY, startLine: 1, numLines: 600, totalLines: 600 } }),
    );
    records.push(hookAttachment(SESSION, "PostToolUse:Read", "notify: same payload every time"));
  }

  records.push(
    assistantTurn(SESSION, "m7", { input: 2, output: 300, cacheWrite: 2_000, cacheRead: 60_000 }, [
      toolUse("t7", "Bash", { command: "cd /tmp/demo && pnpm build --verbose" }),
    ]),
  );
  records.push(toolResult(SESSION, "t7", "x".repeat(120_000), { stdout: "x".repeat(120_000), stderr: "", interrupted: false }));

  records.push(
    assistantTurn(SESSION, "m8", { input: 2, output: 80, cacheWrite: 1_000, cacheRead: 70_000 }, [
      toolUse("t8", "Bash", { command: "pnpm test" }),
    ]),
  );
  records.push(toolResult(SESSION, "t8", "FAIL: 3 tests failed", { stdout: "", stderr: "boom", interrupted: false }, true));

  return records;
}

test("token usage is deduped by message id", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  assert.equal(evidence.turns, 8);
  assert.equal(evidence.usage.cacheWrite, 20_000 + 5 * 1_000 + 2_000 + 1_000);
  assert.equal(evidence.usage.output, 100 + 5 * 120 + 300 + 80);
});

test("identical re-reads are counted as redundant, the first read is not", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  const read = evidence.reads.find((r) => r.path === "src/app.ts");
  assert.ok(read, "expected a read bucket for src/app.ts");
  assert.equal(read.reads, 6);
  assert.equal(read.redundantReads, 5);
  assert.ok(read.redundantWeighted > 0);
});

test("oversized output is bucketed under a readable command label", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  const output = evidence.outputs.find((o) => o.label === "pnpm build");
  assert.ok(output, `expected pnpm build bucket, got ${evidence.outputs.map((o) => o.label).join(", ")}`);
  assert.equal(output.calls, 1);
  assert.equal(output.maxChars, 120_000);
});

test("repeated hook output is redundant after the first event", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  const hook = evidence.hooks.find((h) => h.name === "PostToolUse:Read");
  assert.ok(hook);
  assert.equal(hook.events, 5);
  assert.ok(hook.weighted > 0);
});

test("failed tool calls are recorded with their command label", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  assert.equal(evidence.toolErrors, 1);
  assert.ok(evidence.failures.some((f) => f.label === "pnpm test"));
});

test("tasks are grouped by prompt and keep an outcome", async () => {
  const { file } = writeFixture(SESSION, buildSession());
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  assert.equal(evidence.tasks.length, 1);
  assert.equal(evidence.tasks[0].turns, 8);
  assert.equal(evidence.tasks[0].outcome, "completed");
});

test("commandLabel skips shell noise and flags", () => {
  assert.equal(commandLabel("cd /tmp/demo && pnpm build --verbose"), "pnpm build");
  assert.equal(commandLabel("SP=/tmp/x cat file.txt"), "cat file.txt");
  assert.equal(commandLabel("git status --short"), "git status");
  assert.equal(commandLabel("export PATH=/x:$PATH"), "shell command");
  assert.equal(commandLabel("node /very/long/path/to/script.mjs"), "node script.mjs");
});

test("sessions with no assistant turns are skipped", async () => {
  const { file } = writeFixture("empty", [humanPrompt("empty", "p1", "hello")]);
  assert.equal(await parseClaudeSession(file, fs.statSync(file)), null);
});

test("a self-contained prompt after unrelated work is flagged as dead carry", async () => {
  const records = [
    humanPrompt("s2", "p1", "refactor the auth module to use the new session store"),
    assistantTurn("s2", "m1", { input: 2, output: 200, cacheWrite: 90_000, cacheRead: 0 }, [
      toolUse("t1", "Edit", { file_path: "/tmp/demo/src/auth.ts", old_string: "a", new_string: "b" }),
    ]),
    toolResult("s2", "t1", "ok", { filePath: "/tmp/demo/src/auth.ts" }),
    humanPrompt("s2", "p2", "add a dark mode toggle to the settings page header"),
  ];
  for (let i = 2; i <= 8; i++) {
    records.push(
      assistantTurn("s2", `m${i}`, { input: 2, output: 150, cacheWrite: 1_000, cacheRead: 120_000 }, [
        toolUse(`t${i}`, "Edit", { file_path: "/tmp/demo/src/settings.tsx", old_string: "a", new_string: "b" }),
      ]),
    );
    records.push(toolResult("s2", `t${i}`, "ok", { filePath: "/tmp/demo/src/settings.tsx" }));
  }
  const { file } = writeFixture("s2", records);
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  const [first, second] = evidence.tasks;
  assert.equal(first.carriedIsDead, false, "the first task carries nothing");
  assert.equal(second.selfContained, true);
  assert.equal(second.touchedPriorFiles, false);
  assert.equal(second.carriedIsDead, true);
  assert.ok(second.carriedUsd > 0);
  assert.ok(second.usd > 0);
});

test("a follow-up prompt is never counted as dead carry", async () => {
  const records = [
    humanPrompt("s3", "p1", "refactor the auth module to use the new session store"),
    assistantTurn("s3", "m1", { input: 2, output: 200, cacheWrite: 90_000, cacheRead: 0 }, [
      toolUse("t1", "Edit", { file_path: "/tmp/demo/src/auth.ts", old_string: "a", new_string: "b" }),
    ]),
    toolResult("s3", "t1", "ok", { filePath: "/tmp/demo/src/auth.ts" }),
    humanPrompt("s3", "p2", "ok now do the same for the other ones, all of them please"),
  ];
  for (let i = 2; i <= 8; i++) {
    records.push(
      assistantTurn("s3", `m${i}`, { input: 2, output: 150, cacheWrite: 1_000, cacheRead: 120_000 }, [
        toolUse(`t${i}`, "Edit", { file_path: "/tmp/demo/src/other.ts", old_string: "a", new_string: "b" }),
      ]),
    );
    records.push(toolResult("s3", `t${i}`, "ok", { filePath: "/tmp/demo/src/other.ts" }));
  }
  const { file } = writeFixture("s3", records);
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  const second = evidence.tasks[1];
  assert.equal(second.selfContained, false, "anaphoric prompts depend on prior context");
  assert.equal(second.carriedIsDead, false);
});

test("usage-limit lockouts are counted once per episode", async () => {
  const limit = (id) =>
    assistantTurn("s4", id, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, [
      { type: "text", text: "You've hit your session limit · resets 1pm" },
    ], { isApiErrorMessage: true, model: "<synthetic>" });
  const { file } = writeFixture("s4", [
    humanPrompt("s4", "p1", "build the thing"),
    assistantTurn("s4", "m1", { input: 2, output: 100, cacheWrite: 10_000, cacheRead: 0 }, [{ type: "text", text: "ok" }]),
    limit("e1"),
    limit("e2"),
    limit("e3"),
  ]);
  const evidence = await parseClaudeSession(file, fs.statSync(file));
  assert.equal(evidence.apiErrors, 3);
  assert.equal(evidence.rateLimitHits, 1, "three retries of one lockout are one episode");
});
