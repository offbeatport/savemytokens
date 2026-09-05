import assert from "node:assert/strict";
import test from "node:test";
import { allocate, pressureFor, stageFor } from "../dist/runtime/kernel.mjs";

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function shares(result) {
  const out = {};
  for (const [id, allocation] of result.targets) out[id] = round(allocation.target);
  return out;
}

test("three unpinned sessions split the window evenly", () => {
  const result = allocate([
    { id: "a", share: null, priority: "normal", state: "active", consumed: 0.1 },
    { id: "b", share: null, priority: "normal", state: "active", consumed: 0.2 },
    { id: "c", share: null, priority: "normal", state: "active", consumed: 0 },
  ]);
  assert.deepEqual(shares(result), { a: 0.333, b: 0.333, c: 0.333 });
  assert.equal(round(result.unusedPool), 0);
});

test("pinned shares are honoured exactly", () => {
  const result = allocate([
    { id: "web", share: 0.5, priority: "high", state: "active", consumed: 0.2 },
    { id: "buy", share: 0.35, priority: "normal", state: "active", consumed: 0.1 },
    { id: "scratch", share: 0.15, priority: "low", state: "active", consumed: 0 },
  ]);
  assert.deepEqual(shares(result), { web: 0.5, buy: 0.35, scratch: 0.15 });
});

test("a finished session releases only what it did not consume, to the top tier first", () => {
  const result = allocate([
    { id: "web", share: 0.5, priority: "high", state: "done", consumed: 0.32 },
    { id: "buy", share: 0.35, priority: "normal", state: "active", consumed: 0.1 },
    { id: "scratch", share: 0.15, priority: "low", state: "active", consumed: 0.05 },
  ]);
  const result2 = shares(result);
  assert.equal(result2.web, 0.32, "the finished session keeps what it actually used");
  assert.equal(result2.buy, 0.53, "the 18 points it did not use go to the higher tier");
  assert.equal(result2.scratch, 0.15, "the lower tier is unchanged while the tier above can still take more");
  assert.equal(round(result.unusedPool), 0);
});

test("spare capacity reaches a lower tier once the tier above is capped", () => {
  const result = allocate([
    { id: "web", share: 0.5, priority: "high", state: "done", consumed: 0.2 },
    { id: "buy", share: 0.3, priority: "normal", state: "active", consumed: 0.1, cap: 0.4 },
    { id: "scratch", share: 0.2, priority: "low", state: "active", consumed: 0 },
  ]);
  const targets = shares(result);
  assert.equal(targets.buy, 0.4, "capped at its ceiling");
  assert.equal(targets.scratch, 0.4, "the rest spills to the tier below");
});

test("a blocked session stops receiving allocation", () => {
  const result = allocate([
    { id: "a", share: null, priority: "normal", state: "blocked", consumed: 0.25 },
    { id: "b", share: null, priority: "normal", state: "active", consumed: 0.25 },
  ]);
  assert.deepEqual(shares(result), { a: 0.25, b: 0.75 });
});

test("pins over 100% are scaled down instead of overcommitting", () => {
  const result = allocate([
    { id: "a", share: 0.8, priority: "normal", state: "active", consumed: 0 },
    { id: "b", share: 0.8, priority: "normal", state: "active", consumed: 0 },
  ]);
  assert.deepEqual(shares(result), { a: 0.5, b: 0.5 });
});

test("with nothing running the whole window is spare", () => {
  const result = allocate([{ id: "a", share: null, priority: "normal", state: "done", consumed: 0.2 }]);
  assert.equal(round(result.unusedPool), 0.8);
});

test("an unpinned project that finished under an even share hands the difference to the top tier", () => {
  const result = allocate([
    { id: "done", share: null, priority: "normal", state: "done", consumed: 0.2 },
    { id: "release", share: null, priority: "high", state: "active", consumed: 0.1 },
    { id: "experiment", share: null, priority: "low", state: "active", consumed: 0.1 },
  ]);
  const targets = shares(result);
  assert.equal(targets.done, 0.2, "it keeps what it actually used");
  assert.equal(targets.release, 0.467, "the 13 points it did not use go to the only high tier project");
  assert.equal(targets.experiment, 0.333, "the low tier keeps its even share and no more");
});

test("priority does nothing until capacity is actually released", () => {
  const result = allocate([
    { id: "release", share: null, priority: "high", state: "active", consumed: 0.4 },
    { id: "experiment", share: null, priority: "low", state: "active", consumed: 0.1 },
  ]);
  assert.deepEqual(shares(result), { release: 0.5, experiment: 0.5 });
});

test("projects that have not run this window hold no claim to hand back", () => {
  const busy = allocate([
    { id: "release", share: null, priority: "high", state: "active", consumed: 0.4 },
    { id: "experiment", share: null, priority: "low", state: "active", consumed: 0.1 },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `cold${index}`,
      share: null,
      priority: "normal",
      state: "done",
      consumed: 0,
    })),
  ]);
  const targets = shares(busy);
  assert.equal(targets.release, 0.5, "an idle project that spent nothing cannot starve the low tier");
  assert.equal(targets.experiment, 0.5);
});

test("a quiet session beside a busy one is judged on its project's ratio, not on a rounding error", () => {
  const project = pressureFor(0.2, 0.5, 40);
  const quiet = pressureFor(0.2 * 0.005, 0.5 * 0.005, 40);
  assert.equal(round(quiet.value), round(project.value));
  assert.equal(quiet.basis, "budget");
  assert.ok(stageFor(quiet.value) < 90, "it must not be handed the wind-down meant for an overrun");
});

test("consuming with no allocation at all is still the top of the scale", () => {
  assert.equal(pressureFor(0.2, 0, 40).value, 9.99);
  assert.equal(pressureFor(0, 0, 40).value, 0);
});

test("pressure is measured against the published window when there is one", () => {
  const withQuota = pressureFor(0.5, 0.4, 40);
  assert.equal(withQuota.basis, "budget");
  assert.equal(round(withQuota.value), 0.5);

  const withoutQuota = pressureFor(0.5, 0.4, null);
  assert.equal(withoutQuota.basis, "share");
  assert.equal(round(withoutQuota.value), 1.25);
});

test("advice stages fire at 50, 80 and 90 percent of target", () => {
  assert.equal(stageFor(0.49), 0);
  assert.equal(stageFor(0.5), 50);
  assert.equal(stageFor(0.79), 50);
  assert.equal(stageFor(0.8), 80);
  assert.equal(stageFor(0.95), 90);
});
