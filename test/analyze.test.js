import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../dist/analyze/index.js";
import { combinedWaste } from "../dist/analyze/combine.js";
import { LifetimeCost } from "../dist/core/cost.js";
import { parseArgs } from "../dist/cli-options.js";
import { weigh } from "../dist/core/tokens.js";

function session(overrides = {}) {
  return {
    schema: 3,
    adapter: "claude-code",
    sessionId: "s1",
    project: "/tmp/demo",
    sourceFile: "/tmp/demo/s1.jsonl",
    sourceSize: 1,
    sourceMtimeMs: 1,
    agentVersion: "2.1.0",
    startedAt: 1,
    endedAt: 2,
    turns: 100,
    humanPrompts: 4,
    usage: { input: 1_000, output: 10_000, cacheWrite: 100_000, cacheRead: 5_000_000 },
    weighted: weigh({ input: 1_000, output: 10_000, cacheWrite: 100_000, cacheRead: 5_000_000 }),
    peakContext: 200_000,
    contextP50: 90_000,
    compactions: 0,
    coldStart: false,
    bloatTurns: 0,
    bloatTokens: 0,
    bloatWeighted: 0,
    apiErrors: 0,
    interruptions: 0,
    toolCalls: 50,
    toolErrors: 0,
    sidechainTurns: 0,
    sidechainWeighted: 0,
    searchChars: 0,
    models: [],
    tasks: [],
    reads: [],
    outputs: [],
    hooks: [],
    attachments: [],
    writes: [],
    failures: [],
    ...overrides,
  };
}

function corpus(sessions) {
  return {
    scope: { adapters: ["claude-code"], days: 7, project: null, sessions: sessions.length, from: 0, to: 1 },
    sessions,
  };
}

test("lifetime cost charges one cache write plus a read per later turn", () => {
  const cost = new LifetimeCost();
  cost.add(0, 10, 1_000);
  assert.equal(cost.resolve([10]), 1_000 * 1.25);
  const later = new LifetimeCost();
  later.add(0, 10, 1_000);
  assert.equal(later.resolve([30]), 1_000 * 1.25 + 1_000 * 0.1 * 20);
});

test("an empty corpus produces no findings and a full score", () => {
  const audit = analyze(corpus([]));
  assert.equal(audit.findings.length, 0);
  assert.equal(audit.score, 100);
  assert.equal(audit.wasteRatio, 0);
});

test("findings below the noise floor are dropped", () => {
  const audit = analyze(
    corpus([
      session({
        reads: [{ path: "src/tiny.ts", signature: "x", reads: 2, chars: 200, redundantReads: 1, redundantChars: 100, redundantWeighted: 30 }],
      }),
    ]),
  );
  assert.equal(audit.findings.length, 0);
});

test("a real repeated read surfaces with a specific fix", () => {
  const audit = analyze(
    corpus([
      session({
        reads: [
          { path: "docs/BRIEF.md", signature: "x", reads: 40, chars: 800_000, redundantReads: 39, redundantChars: 780_000, redundantWeighted: 400_000 },
        ],
      }),
    ]),
  );
  const finding = audit.findings.find((f) => f.id === "repeated-reads");
  assert.ok(finding, "expected repeated-reads finding");
  assert.match(finding.fix, /BRIEF\.md/);
  assert.equal(finding.confidence, "estimated");
  assert.ok(finding.wasteRatio > 0 && finding.wasteRatio < 1);
});

test("combined waste discounts overlapping findings and stays capped", () => {
  const findings = [
    { wasteRatio: 0.3 },
    { wasteRatio: 0.2 },
    { wasteRatio: 0.1 },
  ];
  assert.ok(Math.abs(combinedWaste(findings) - 0.45) < 1e-9);
  assert.equal(combinedWaste([{ wasteRatio: 0.9 }, { wasteRatio: 0.9 }]), 0.45);
  assert.equal(combinedWaste([]), 0);
});

test("uplift is derived from the combined waste ratio", () => {
  const audit = analyze(
    corpus([
      session({
        bloatTurns: 50,
        bloatTokens: 20_000_000,
        bloatWeighted: 2_000_000,
      }),
    ]),
  );
  const expected = 1 / (1 - audit.wasteRatio) - 1;
  assert.ok(Math.abs(audit.upliftRatio - expected) < 1e-9);
  assert.ok(audit.score < 100);
});

test("argument parsing covers commands, windows and scopes", () => {
  assert.equal(parseArgs([]).command, "audit");
  assert.equal(parseArgs([]).days, 7);
  assert.equal(parseArgs(["watch", "--interval", "30"]).command, "watch");
  assert.equal(parseArgs(["--days", "30"]).days, 30);
  assert.equal(parseArgs(["--days", "-4"]).days, 7);
  assert.equal(parseArgs(["--here"]).project, process.cwd());
  assert.equal(parseArgs(["--project", "/tmp/x"]).project, "/tmp/x");
  assert.equal(parseArgs(["--json", "--no-save"]).save, false);
  assert.equal(parseArgs(["-h"]).help, true);
});
