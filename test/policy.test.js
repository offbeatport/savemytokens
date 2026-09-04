import assert from "node:assert/strict";
import test from "node:test";
import {
  POLICIES,
  actionsFor,
  adviceFor,
  defersIn,
  deferredAdvice,
  openingAdvice,
  policyFor,
  preserveText,
  stageFor,
} from "../dist/runtime/kernel.mjs";
import { actionFor, keyActions, splitKeys } from "../dist/scheduler/keys.js";

const view = (over = {}) => ({
  target: 0.4,
  observed: 0.5,
  pressure: 0.85,
  basis: "budget",
  preserve: ["tests", "end-to-end checks"],
  ...over,
});

test("the default policy narrows scope, then defers, then only verifies", () => {
  const finish = POLICIES.finish;
  assert.equal(stageFor(0.2, finish), 0);
  assert.equal(stageFor(0.5, finish), 50);
  assert.equal(stageFor(0.85, finish), 80);
  assert.equal(stageFor(0.95, finish), 90);
  assert.deepEqual(actionsFor(50, finish), ["focus"]);
  assert.deepEqual(actionsFor(80, finish), ["narrow", "defer"]);
  assert.deepEqual(actionsFor(90, finish), ["verify", "defer", "handoff"]);
});

test("strict does the same moves earlier, relaxed later, off never", () => {
  assert.equal(stageFor(0.4, POLICIES.strict), 35);
  assert.equal(stageFor(0.65, POLICIES.strict), 60);
  assert.equal(stageFor(0.4, POLICIES.relaxed), 0);
  assert.equal(stageFor(0.85, POLICIES.relaxed), 80);
  assert.equal(stageFor(0.99, POLICIES.off), 0);
});

test("a project policy overrides the global one", () => {
  const config = { policy: "relaxed", policyFor: { "/work/webinvoke": "strict" } };
  assert.equal(policyFor(config, "/work/webinvoke").name, "strict");
  assert.equal(policyFor(config, "/work/other").name, "relaxed");
  assert.equal(policyFor(null, "/work/other").name, "finish");
  assert.equal(policyFor({ policy: "nonsense" }, "/x").name, "finish");
});

test("advice tells Claude to do less, and to record what it drops", () => {
  const narrow = adviceFor(80, view());
  assert.match(narrow, /85% of your 40% target share/);
  assert.match(narrow, /Narrow the scope to the smallest version that is genuinely done/);
  assert.match(narrow, /start nothing new/);
  assert.match(narrow, /tests and end-to-end checks/);
  assert.match(narrow, /SMT: DEFER/);

  const last = adviceFor(90, view({ pressure: 0.95 }));
  assert.match(last, /Verification and finalisation only/);
  assert.match(last, /SMT: DONE/);
});

test("advice says which basis it used", () => {
  assert.match(adviceFor(50, view()), /85% of your 40% target share of this Claude window is spent/);
  assert.match(
    adviceFor(50, view({ basis: "share" })),
    /you are at 50% of measured usage against a 40% target/,
  );
});

test("the opening message states the share and what happens when it runs out", () => {
  const opening = openingAdvice({ target: 0.5, preserve: ["tests"], policy: POLICIES.finish });
  assert.match(opening, /target share of the current Claude window is 50%/);
  assert.match(opening, /Past 50% of it, tighten up/);
  assert.match(opening, /SMT: BLOCKED/);
});

test("deferred lines are parsed out of assistant text and read back", () => {
  const content = [
    { type: "text", text: "Done the parser.\n\nSMT: DEFER wire the retry path into the CLI\nSMT: DEFER add an e2e for the reset boundary\n\nSMT: NEEDS_MORE" },
  ];
  assert.deepEqual(defersIn(content), [
    "wire the retry path into the CLI",
    "add an e2e for the reset boundary",
  ]);
  assert.deepEqual(defersIn([{ type: "text", text: "nothing here" }]), []);

  const advice = deferredAdvice([{ at: 1, text: "wire the retry path", session: "s", project: "p" }]);
  assert.match(advice, /Deferred earlier in this project/);
  assert.match(advice, /· wire the retry path/);
});

test("preserve text reads like a sentence", () => {
  assert.equal(preserveText([]), "testing and finalisation");
  assert.equal(preserveText(["tests"]), "tests");
  assert.equal(preserveText(["tests", "docs"]), "tests and docs");
  assert.equal(preserveText(["a", "b", "c"]), "a, b and c");
});

test("a coalesced key chunk is split into separate keys", () => {
  assert.deepEqual(splitKeys("\u001b[A\u001b[B"), ["\u001b[A", "\u001b[B"]);
  assert.deepEqual(splitKeys("\u001b[Cq"), ["\u001b[C", "q"]);
  assert.deepEqual(splitKeys("pp"), ["p", "p"]);
  assert.deepEqual(splitKeys("\u001b"), ["\u001b"]);
});

test("keys map to actions, and repeated arrows all count", () => {
  assert.deepEqual(actionFor("\u001b[C", "plan", 0.05), { kind: "share", delta: 0.05 });
  assert.deepEqual(actionFor("\u001b[D", "plan", 0.05), { kind: "share", delta: -0.05 });
  assert.deepEqual(actionFor("p", "plan", 0.05), { kind: "priority" });
  assert.deepEqual(actionFor("d", "plan", 0.05), { kind: "state", state: "done" });
  assert.deepEqual(actionFor("\u0003", "plan", 0.05), { kind: "quit" });
  assert.deepEqual(actionFor("2", "prefs", 0.05), { kind: "toggle", index: 1 });
  assert.deepEqual(actionFor("\r", "prefs", 0.05), { kind: "save" });

  const actions = keyActions("\u001b[C\u001b[C\u001b[C", "plan", 0.05);
  assert.equal(actions.length, 3, "three arrow presses in one chunk are three moves");
});
