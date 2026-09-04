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
    rateLimitHits: 0,
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

function task(overrides = {}) {
  return {
    id: "t1",
    sessionId: "s1",
    project: "/tmp/demo",
    prompt: "add rate limiting to the invoice export endpoint",
    startedAt: 1,
    endedAt: 2,
    promptChars: 48,
    turns: 40,
    toolCalls: 20,
    models: ["claude-opus-5"],
    usage: { input: 0, output: 2_000, cacheWrite: 20_000, cacheRead: 8_000_000 },
    weighted: 0,
    usd: 12,
    peakContext: 400_000,
    carriedContext: 300_000,
    carriedUsd: 6,
    carriedIsDead: true,
    touchedPriorFiles: false,
    selfContained: true,
    outcome: "completed",
    toolErrors: 0,
    ...overrides,
  };
}

test("dead carry is reported with per-task receipts and money", () => {
  const audit = analyze(corpus([session({ tasks: [task(), task({ id: "t2" })] })]));
  const finding = audit.findings.find((f) => f.id === "dead-carry");
  assert.ok(finding, "expected dead-carry finding");
  assert.equal(finding.confidence, "measured");
  assert.equal(finding.receipts.length, 2);
  assert.match(finding.receipts[0], /invoice export/);
  assert.ok(finding.wastedUsd > 0);
});

test("tasks that reopened earlier files are not counted as dead carry", () => {
  const live = { ...task(), carriedIsDead: false, touchedPriorFiles: true };
  const audit = analyze(corpus([session({ tasks: [live] })]));
  assert.equal(audit.findings.find((f) => f.id === "dead-carry"), undefined);
});

test("totals and top tasks come from the task layer", () => {
  const audit = analyze(corpus([session({ tasks: [task({ usd: 3 }), task({ id: "t2", usd: 40 })] })]));
  assert.equal(audit.totals.tasks, 2);
  assert.equal(Math.round(audit.totals.usd), 43);
  assert.equal(audit.topTasks[0].usd, 40);
  assert.equal(audit.projects[0].name, "demo");
});

test("uplift is derived from the combined waste ratio", () => {
  const audit = analyze(corpus([session({ tasks: [task(), task({ id: "t2" })] })]));
  const expected = 1 / (1 - audit.wasteRatio) - 1;
  assert.ok(Math.abs(audit.upliftRatio - expected) < 1e-9);
  assert.ok(audit.score < 100);
});

test("argument parsing covers commands, windows and scopes", () => {
  assert.equal(parseArgs([]).command, "control");
  assert.equal(parseArgs(["audit"]).command, "audit");
  assert.deepEqual(parseArgs(["theme", "tui", "nord"]).args, ["tui", "nord"]);
  assert.equal(parseArgs([]).days, 7);
  assert.equal(parseArgs(["watch", "--interval", "30"]).command, "watch");
  assert.equal(parseArgs(["--days", "30"]).days, 30);
  assert.equal(parseArgs(["--days", "-4"]).days, 7);
  assert.equal(parseArgs(["--here"]).project, process.cwd());
  assert.equal(parseArgs(["--project", "/tmp/x"]).project, "/tmp/x");
  assert.equal(parseArgs(["--json", "--no-save"]).save, false);
  assert.equal(parseArgs(["-h"]).help, true);
});
