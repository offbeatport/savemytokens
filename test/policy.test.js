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
  signalIn,
  stageFor,
  trailingSignals,
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

test("the preferences screen is reachable on demand, and navigable", () => {
  assert.deepEqual(actionFor("P", "plan", 0.05), { kind: "preferences" });
  assert.deepEqual(actionFor("\u001b[A", "prefs", 0.05), { kind: "up" });
  assert.deepEqual(actionFor("\u001b[B", "prefs", 0.05), { kind: "down" });
  assert.deepEqual(actionFor(" ", "prefs", 0.05), { kind: "toggleCurrent" });
  assert.deepEqual(actionFor("e", "prefs", 0.05), { kind: "edit" });
  assert.deepEqual(actionFor("3", "prefs", 0.05), { kind: "toggle", index: 2 });
  assert.deepEqual(actionFor("\u001b", "prefs", 0.05), { kind: "skip" });
});

test("your own line is injected with the advice", () => {
  const withCustom = adviceFor(80, {
    target: 0.4,
    observed: 0.5,
    pressure: 0.85,
    basis: "budget",
    preserve: ["tests"],
    custom: "Always run pnpm test and push before you stop.",
  });
  assert.match(withCustom, /Always run pnpm test and push before you stop\.$/);
  assert.doesNotMatch(adviceFor(80, { target: 0.4, pressure: 0.85, basis: "budget", preserve: [] }), /pnpm test/);
});

test("the release signal only counts as the last line, not mid-sentence", () => {
  const prose = [{ type: "text", text: "You can override any of it with SMT: DONE in a sentence." }];
  assert.equal(signalIn(prose), null, "writing about the protocol must not trigger it");

  const doc = [{ type: "text", text: "The table lists SMT: DONE, SMT: NEEDS_MORE and SMT: BLOCKED.\nStill working." }];
  assert.equal(signalIn(doc), null);

  const real = [{ type: "text", text: "Shipped the parser and the tests pass.\n\nSMT: DONE" }];
  assert.equal(signalIn(real), "DONE");
  assert.equal(signalIn([{ type: "text", text: "blocked on creds\n\nSMT: BLOCKED\n" }]), "BLOCKED");
});

test("deferred lines must start their own line", () => {
  assert.deepEqual(defersIn([{ type: "text", text: "write it as SMT: DEFER something to skip it" }]), []);
  assert.deepEqual(defersIn([{ type: "text", text: "  SMT: DEFER wire the retry path\nSMT: DONE" }]), [
    "wire the retry path",
  ]);
});

test("only the run of SMT lines at the very end counts", () => {
  const prose = [
    {
      type: "text",
      text: "You write it as `SMT: DEFER <one line>` and it is captured per project.\n\nThat is the whole feature.",
    },
  ];
  assert.deepEqual(defersIn(prose), [], "documenting the syntax must not queue work");
  assert.equal(signalIn(prose), null);

  const real = [
    { type: "text", text: "Shipped the parser.\n\nSMT: DEFER wire the retry path\nSMT: DEFER add an e2e\nSMT: NEEDS_MORE" },
  ];
  const parsed = trailingSignals(real);
  assert.deepEqual(parsed.defers, ["wire the retry path", "add an e2e"]);
  assert.equal(parsed.signal, "NEEDS_MORE");

  const interrupted = [{ type: "text", text: "SMT: DEFER something\n\nBut actually I kept going and did it." }];
  assert.deepEqual(defersIn(interrupted), [], "a defer line followed by more work is not a report");
});

test("every hud layout renders on one line", async () => {
  const { HUD_LAYOUTS, renderHud, loadTheme } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();
  assert.equal(HUD_LAYOUTS.length, 10);
  for (const layout of HUD_LAYOUTS) {
    const line = renderHud(
      layout,
      {
        label: "webinvoke",
        target: 0.4,
        observed: 0.6,
        used: 25,
        pressure: 0.6,
        priority: "high",
        quota: { five_hour: { usedPercent: 42, resetsAt: Math.floor(now / 1000) + 3600 } },
        history: [10, 20, 30, 42],
        rate: 8,
        from: now - 18000000,
        to: now + 3600000,
        now,
      },
      loadTheme("default"),
      false,
    );
    assert.ok(line.length > 0, `${layout} rendered nothing`);
    assert.ok(!line.includes("\n"), `${layout} must stay on one line`);
  }
});

test("the preferences screen is reachable on demand, and navigable", () => {
  assert.deepEqual(actionFor("P", "plan", 0.05), { kind: "preferences" });
  assert.deepEqual(actionFor("\u001b[A", "prefs", 0.05), { kind: "up" });
  assert.deepEqual(actionFor("\u001b[B", "prefs", 0.05), { kind: "down" });
  assert.deepEqual(actionFor(" ", "prefs", 0.05), { kind: "toggleCurrent" });
  assert.deepEqual(actionFor("e", "prefs", 0.05), { kind: "edit" });
  assert.deepEqual(actionFor("3", "prefs", 0.05), { kind: "toggle", index: 2 });
  assert.deepEqual(actionFor("\u001b", "prefs", 0.05), { kind: "skip" });
});

test("your own line is injected with the advice", () => {
  const withCustom = adviceFor(80, {
    target: 0.4,
    observed: 0.5,
    pressure: 0.85,
    basis: "budget",
    preserve: ["tests"],
    custom: "Always run pnpm test and push before you stop.",
  });
  assert.match(withCustom, /Always run pnpm test and push before you stop\.$/);
  assert.doesNotMatch(adviceFor(80, { target: 0.4, pressure: 0.85, basis: "budget", preserve: [] }), /pnpm test/);
});

test("the release signal only counts as the last line, not mid-sentence", () => {
  const prose = [{ type: "text", text: "You can override any of it with SMT: DONE in a sentence." }];
  assert.equal(signalIn(prose), null, "writing about the protocol must not trigger it");

  const doc = [{ type: "text", text: "The table lists SMT: DONE, SMT: NEEDS_MORE and SMT: BLOCKED.\nStill working." }];
  assert.equal(signalIn(doc), null);

  const real = [{ type: "text", text: "Shipped the parser and the tests pass.\n\nSMT: DONE" }];
  assert.equal(signalIn(real), "DONE");
  assert.equal(signalIn([{ type: "text", text: "blocked on creds\n\nSMT: BLOCKED\n" }]), "BLOCKED");
});

test("deferred lines must start their own line", () => {
  assert.deepEqual(defersIn([{ type: "text", text: "write it as SMT: DEFER something to skip it" }]), []);
  assert.deepEqual(defersIn([{ type: "text", text: "  SMT: DEFER wire the retry path\nSMT: DONE" }]), [
    "wire the retry path",
  ]);
});

test("only the run of SMT lines at the very end counts", () => {
  const prose = [
    {
      type: "text",
      text: "You write it as `SMT: DEFER <one line>` and it is captured per project.\n\nThat is the whole feature.",
    },
  ];
  assert.deepEqual(defersIn(prose), [], "documenting the syntax must not queue work");
  assert.equal(signalIn(prose), null);

  const real = [
    { type: "text", text: "Shipped the parser.\n\nSMT: DEFER wire the retry path\nSMT: DEFER add an e2e\nSMT: NEEDS_MORE" },
  ];
  const parsed = trailingSignals(real);
  assert.deepEqual(parsed.defers, ["wire the retry path", "add an e2e"]);
  assert.equal(parsed.signal, "NEEDS_MORE");

  const interrupted = [{ type: "text", text: "SMT: DEFER something\n\nBut actually I kept going and did it." }];
  assert.deepEqual(defersIn(interrupted), [], "a defer line followed by more work is not a report");
});

test("the working set sorts itself into active, recent and parked", async () => {
  const { bucketFor } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();
  const base = { state: "active", endedAt: null, pinned: false, parked: false };

  const beating = { ...base, heartbeat: now - 5_000, lastSeen: now - 5_000 };
  assert.equal(bucketFor(beating, now, true), "active", "a live session holds a share");

  const quiet = { ...base, heartbeat: now - 10 * 60_000, lastSeen: now - 2 * 60 * 60_000 };
  assert.equal(bucketFor(quiet, now, true), "recent", "worked on today, nothing running");

  const old = { ...base, heartbeat: 0, lastSeen: now - 6 * 24 * 60 * 60_000 };
  assert.equal(bucketFor(old, now, true), "parked");

  const parkedByHand = { ...base, parked: true, heartbeat: 0, lastSeen: now - 60_000 };
  assert.equal(bucketFor(parkedByHand, now, true), "parked", "parking wins over recency");

  const parkedButBeating = { ...base, parked: true, heartbeat: now - 5_000, lastSeen: now - 5_000 };
  assert.equal(bucketFor(parkedButBeating, now, true), "parked", "parking holds until you resume it deliberately");
});

test("the first-run dialog fits any terminal it is drawn in", async () => {
  const { boxed, setupScreen } = await import("../dist/commands/control.js");
  const { loadTheme } = await import("../dist/runtime/kernel.mjs");
  const theme = loadTheme("default");

  for (const columns of [40, 60, 80, 100, 140]) {
    const body = setupScreen(true, theme, false, columns);
    const framed = boxed(body, theme, false, columns);
    for (const line of framed) {
      assert.ok(line.length <= columns, `a ${columns}-column terminal overflowed: ${line.length} chars`);
    }
    const top = framed[0] ?? "";
    const bottom = framed[framed.length - 1] ?? "";
    assert.equal(top.length, bottom.length, "the box closes at the same width it opened");
    assert.ok(framed.some((line) => line.includes("[ Yes ]")), "the default choice is visible");
  }
});

test("the cursor follows the session, not the row it happened to be on", async () => {
  const { selectionIndex } = await import("../dist/scheduler/plan.js");

  assert.equal(selectionIndex(["a", "b", "c"], "b", 1), 1, "unchanged list keeps its place");
  assert.equal(selectionIndex(["c", "b", "a"], "b", 0), 1, "a re-sort moves the cursor with the session");
  assert.equal(selectionIndex(["b", "c"], "b", 2), 0, "rows above disappearing does not lose it");
  assert.equal(selectionIndex(["x", "y"], "gone", 1), 1, "a vanished session falls back to the same row");
  assert.equal(selectionIndex(["x"], "gone", 5), 0, "and is clamped to the list");
  assert.equal(selectionIndex([], "gone", 3), 0, "an empty list selects nothing");
});

test("m lifts the caps, not just the screen budget", async () => {
  const { workingSet } = await import("../dist/scheduler/plan.js");
  const now = Date.now();
  const make = (id, bucket, minsAgo) => ({
    claimant: { id, label: id, project: `/tmp/${id}`, pinned: false, parked: false, lastSeen: now - minsAgo * 60000, startedAt: now - 7200000, priority: "normal", prompt: "" },
    allocation: { claimantId: id, target: 0, pinned: false, pool: 0, released: true },
    usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, requests: 0, tokens: 0, weighted: 0 },
    observed: 0,
    state: "done",
    bucket,
    stale: true,
    pressure: { value: 0, basis: "share" },
    attributedPercent: 0,
  });

  const claimants = [
    ...Array.from({ length: 9 }, (_, i) => make(`recent${i}`, "recent", i + 1)),
    ...Array.from({ length: 7 }, (_, i) => {
      const view = make(`parked${i}`, "parked", 60 * 24 * (i + 2));
      view.claimant.parked = true;
      return view;
    }),
  ];
  const plan = { claimants };

  const collapsed = workingSet(plan, false);
  assert.equal(collapsed.recent.length, 6, "idle sessions are trimmed to six");
  assert.equal(collapsed.parked.length, 0, "parked ones are out of the way entirely");
  assert.equal(collapsed.hidden, 10, "three idle and seven parked are waiting behind m");

  const full = workingSet(plan, true);
  assert.equal(full.recent.length, 9);
  assert.equal(full.parked.length, 7, "expanding brings the parked ones back");
  assert.equal(full.hidden, 0);
});

test("a session is never marked seen later than its newest turn", async () => {
  const { bucketFor } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();
  const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
  const claimant = { state: "active", endedAt: null, pinned: false, parked: false, heartbeat: 0, lastSeen: sixDaysAgo };
  assert.equal(bucketFor(claimant, now, false), "parked", "an old session cannot look active");
});

test("the settings screen models columns, segments and their order", async () => {
  const { settingsRows, selectableRows, withToggled, withMoved, renderSettings } = await import("../dist/report/settings.js");
  const { loadTheme } = await import("../dist/runtime/kernel.mjs");

  const config = {
    version: 1,
    createdAt: 1,
    preferencesSetAt: 0,
    offeredInstallAt: 0,
    theme: { tui: "default", hud: "nord" },
    layout: { hud: "allocation" },
    columns: ["target", "used", "last prompt"],
    hud: { segments: ["project", "target", "5h"] },
    policy: "finish",
    policyFor: {},
    preserveFor: { default: ["tests"] },
    customAdvice: {},
    wrappedStatusLine: null,
    contribute: false,
  };

  const rows = settingsRows(config);
  const headers = rows.filter((row) => row.kind === "header").map((row) => row.label);
  assert.deepEqual(headers, ["COLUMNS", "PALETTE", "STATUS LINE", "WHEN IT GETS TIGHT"]);

  const selectable = selectableRows(rows);
  for (const index of selectable) {
    assert.ok(!["header", "blank", "preview"].includes(rows[index].kind), "headers are never selectable");
  }

  assert.deepEqual(withToggled(["a", "b"], "b"), ["a"], "toggling off removes it");
  assert.deepEqual(withToggled(["a"], "b"), ["a", "b"], "toggling on appends it");
  assert.deepEqual(withMoved(["a", "b", "c"], "c", -1), ["a", "c", "b"], "moving left swaps with its neighbour");
  assert.deepEqual(withMoved(["a", "b", "c"], "a", -1), ["a", "b", "c"], "the first cannot move further left");
  assert.deepEqual(withMoved(["a", "b", "c"], "c", 1), ["a", "b", "c"], "nor the last further right");
  assert.deepEqual(withMoved(["a", "b"], "zz", 1), ["a", "b"], "an absent segment is left alone");

  const preview = {
    label: "webinvoke",
    target: 0.5,
    observed: 0.4,
    used: 20,
    pressure: 0.4,
    priority: "high",
    quota: { five_hour: { usedPercent: 42, resetsAt: Math.floor(Date.now() / 1000) + 3600 } },
    now: Date.now(),
  };
  const painted = renderSettings(config, rows, selectable[0], false, "", preview, loadTheme("default"), false);
  assert.ok(painted.some((line) => line.includes("❯")), "the cursor is drawn");
  assert.ok(painted.some((line) => line.includes("webinvoke")), "the status line is previewed on real data");
  assert.ok(painted.some((line) => line.includes("[nord]")), "the chosen palette is marked");
});
