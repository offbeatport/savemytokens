import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let clock = Date.parse("2026-08-01T10:00:00.000Z");

function stamp() {
  clock += 1_000;
  return new Date(clock).toISOString();
}

const base = {
  isSidechain: false,
  userType: "external",
  entrypoint: "cli",
  cwd: "/tmp/demo",
  version: "2.1.0",
  gitBranch: "main",
};

export function humanPrompt(sessionId, promptId, text) {
  return {
    ...base,
    type: "user",
    sessionId,
    promptId,
    uuid: `u-${promptId}`,
    timestamp: stamp(),
    origin: { kind: "human" },
    promptSource: "typed",
    message: { role: "user", content: text },
  };
}

export function assistantTurn(sessionId, messageId, usage, content, extra = {}) {
  return {
    ...base,
    ...extra,
    type: "assistant",
    sessionId,
    uuid: `a-${messageId}-${Math.random().toString(16).slice(2, 8)}`,
    requestId: `req-${messageId}`,
    timestamp: stamp(),
    message: {
      id: messageId,
      role: "assistant",
      model: extra.model ?? "claude-opus-5",
      content,
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
      },
    },
  };
}

export function toolUse(id, name, input) {
  return { type: "tool_use", id, name, input };
}

export function toolResult(sessionId, toolUseId, content, toolUseResult, isError = false) {
  return {
    ...base,
    type: "user",
    sessionId,
    timestamp: stamp(),
    uuid: `r-${toolUseId}`,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }] },
    ...(toolUseResult ? { toolUseResult } : {}),
  };
}

export function hookAttachment(sessionId, hookName, stdout) {
  return {
    ...base,
    type: "attachment",
    sessionId,
    timestamp: stamp(),
    uuid: `h-${Math.random().toString(16).slice(2, 8)}`,
    attachment: { type: "hook_success", hookName, hookEvent: "PostToolUse", content: "", stdout, stderr: "", exitCode: 0 },
  };
}

export function writeFixture(name, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-test-"));
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, file };
}
