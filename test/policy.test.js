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
  assert.ok(HUD_LAYOUTS.length >= 4, `expected some shapes to render, found ${HUD_LAYOUTS.length}`);
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
    assert.ok(framed.some((line) => line.includes("[ Install ]")), "the default choice is visible");
    assert.ok(framed.some((line) => line.includes("Install SaveMyTokens?")), "and it names the product, not one of its parts");
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

test("the plan is one list: what is in it, and what you can add", async () => {
  const { workingSet, inPlan } = await import("../dist/scheduler/plan.js");
  const now = Date.now();
  const make = (id, bucket, minsAgo, settings = {}) => ({
    project: `/tmp/${id}`,
    label: id,
    settings: { project: `/tmp/${id}`, label: id, share: null, priority: "normal", cap: null, pinned: false, parked: false, inPlan: null, joinedAt: 0, ...settings },
    sessions: [],
    allocation: { claimantId: id, target: 0, pinned: false, pool: 0, released: true },
    observed: 0,
    usage: { tokens: 0, weighted: 0, requests: 0 },
    lastSeen: now - minsAgo * 60000,
    bucket,
    attributedPercent: 0,
    pressure: { value: 0, basis: "share" },
    prompt: "",
    liveSessions: bucket === "active" ? 1 : 0,
  });

  const live = make("live", "active", 0);
  const joined = make("joined", "recent", 30, { inPlan: true });
  const held = make("held", "recent", 90, { share: 0.2 });
  const pinned = make("pinned", "recent", 120, { pinned: true });
  const removed = make("removed", "recent", 5, { inPlan: false, share: 0.5 });
  const seen = Array.from({ length: 20 }, (_, i) => make(`seen${i}`, "recent", 60 * 24 * (i + 1)));

  assert.equal(inPlan(live), true, "an open session is always in the plan");
  assert.equal(inPlan(joined), true, "so is one you added");
  assert.equal(inPlan(held), true, "or one holding a share");
  assert.equal(inPlan(pinned), true, "or a pinned one");
  assert.equal(inPlan(removed), false, "taking one out wins over anything it still holds");
  assert.equal(inPlan(seen[0]), false, "merely having been seen is not membership");

  const set = workingSet({ projects: [...seen, removed, pinned, held, joined, live] }, false);
  assert.deepEqual(
    set.members.map((view) => view.label),
    ["live", "pinned", "held", "joined"],
    "one list: open first, then pinned, then by the share each holds",
  );
  assert.equal(set.candidates.length, 12, "the picker offers a screenful");
  assert.equal(set.hidden, 9, "the rest wait behind m");
  assert.ok(set.candidates.some((view) => view.label === "removed"), "a project you removed can be added back");

  const full = workingSet({ projects: [...seen, removed, pinned, held, joined, live] }, true);
  assert.equal(full.candidates.length, 21);
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
  assert.deepEqual(headers, ["COLUMNS", "THEME", "STATUS LINE", "WHEN IT GETS TIGHT"]);

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
  assert.ok(painted.some((line) => line.includes("‹") && line.includes("nord")), "the chosen theme is shown with a cycler");
  assert.ok(
    painted.some((line) => /‹ \w+ *› +\d+\/\d+/.test(line)),
    "and its position in the list, rather than every name at once",
  );
});

test("bars grow with the terminal, and no row overflows it", async () => {
  const { planRows } = await import("../dist/report/views.js");
  const { loadTheme } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();

  const project = (label, live, prompt) => ({
    project: `/Users/you/${label}`,
    label,
    settings: { project: `/Users/you/${label}`, label, share: 0.4, priority: "high", cap: null, pinned: true, parked: false },
    sessions: [],
    allocation: { claimantId: label, target: 0.4, pinned: true, pool: 0, released: !live },
    observed: 0.35,
    usage: { tokens: 1234567, weighted: 999999, requests: 42 },
    lastSeen: now - 60000,
    bucket: live ? "active" : "recent",
    attributedPercent: 18,
    pressure: { value: 0.45, basis: "budget" },
    prompt,
    liveSessions: live ? 2 : 0,
  });

  const long = "Implement the provider fallback chain end to end and then rewrite the parser, checking every edge case along the way";
  const control = {
    provider: { id: "claude-code", label: "Claude Code" },
    resources: [
      {
        id: "claude-code:five_hour",
        adapter: "claude-code",
        label: "5h",
        unit: "observed_usage",
        window: { kind: "rolling", ms: 18000000, resetsAt: Math.floor(now / 1000) + 3600 },
        capacity: { amount: 100, confidence: "published" },
        usedPercent: 42,
      },
    ],
    enforcement: ["advise"],
    unattributed: null,
    deferred: [],
    others: [],
    schedule: {
      adapter: "claude-code",
      key: "five_hour",
      now,
      quota: null,
      live: { usedPercent: 42, resetsAt: Math.floor(now / 1000) + 3600 },
      bounds: { from: now - 18000000, to: now + 3600000, anchored: true },
      windowId: 1,
      unusedPool: 0.05,
      totalWeighted: 1000,
      lockouts: [],
      projects: [
        project("a-very-long-project-name-here", true, long),
        project("webinvoke", true, long),
        project("reposhine", false, long),
      ],
      claimants: [],
    },
  };

  const widest = new Map();
  const columnSets = [
    ["allocation", "used", "priority", "last prompt"],
    ["allocation", "used", "share", "tokens", "priority", "last prompt"],
    ["allocation", "last prompt"],
    ["last prompt"],
  ];

  for (const columns of columnSets) {
    for (const width of [70, 80, 100, 120, 160]) {
      control.config = {
        columns,
        policy: "finish",
        policyFor: {},
        preserveFor: {},
        customAdvice: {},
        theme: { tui: "default", hud: "default" },
        layout: { hud: "allocation" },
        hud: { segments: [] },
      };
      const context = {
        theme: loadTheme("default"),
        color: false,
        columns: width,
        rows: 40,
        selected: 0,
        interactive: true,
        expanded: true,
        labels: new Map(control.schedule.projects.map((p) => [p.project, p.label])),
      };
      const lines = planRows(control, context);
      for (const line of lines) {
        assert.ok(
          line.length <= width,
          `${columns.join("+")} at ${width} columns overflowed by ${line.length - width}: ${JSON.stringify(line.slice(0, 60))}`,
        );
      }
      if (columns.includes("used")) {
        const glyphs = context.theme.tui;
        const cell = new RegExp(`[${glyphs.fill}${glyphs.empty}${glyphs.over}]+`, "u");
        const head = lines.findIndex((line) => line.includes("PROJECT"));
        const bar = lines.slice(head + 1).map((line) => cell.exec(line)?.[0] ?? "").filter(Boolean)[0] ?? "";
        widest.set(width, Math.max(widest.get(width) ?? 0, bar.length));
      }
    }
  }

  assert.ok((widest.get(160) ?? 0) > (widest.get(80) ?? 0), "a wide terminal gets a wider bar");
  assert.ok((widest.get(80) ?? 0) >= 8, "even a narrow one keeps a readable bar");
});

test("an allocation never keeps floating point dust", async () => {
  const { cleanShare } = await import("../dist/scheduler/plan.js");
  assert.equal(cleanShare(1.3877787807814457e-17), 0, "dust from repeated subtraction becomes zero");
  assert.equal(cleanShare(0.30000000000000004), 0.3);
  assert.equal(cleanShare(0.4999), 0.5);
  assert.equal(cleanShare(1.4), 1);
  assert.equal(cleanShare(-0.2), 0);
  assert.equal(cleanShare(null), null);
  assert.equal(cleanShare(Number.NaN), null);
});

test("left and right change things on the settings screen", () => {
  const step = 0.05;
  assert.deepEqual(actionFor("\u001b[C", "prefs", step), { kind: "share", delta: step }, "right changes a choice");
  assert.deepEqual(actionFor("\u001b[D", "prefs", step), { kind: "share", delta: -step }, "left changes it back");
  assert.deepEqual(actionFor("\u001b[A", "prefs", step), { kind: "up" });
  assert.deepEqual(actionFor(" ", "prefs", step), { kind: "toggleCurrent" });
});

test("the tight section shows the real text, when it fires, and where you are", async () => {
  const { renderSettings, settingsRows, selectableRows } = await import("../dist/report/settings.js");
  const { loadTheme, POLICIES } = await import("../dist/runtime/kernel.mjs");
  const now = Date.now();

  const config = {
    version: 1,
    createdAt: 1,
    preferencesSetAt: 0,
    offeredInstallAt: 0,
    theme: { tui: "default", hud: "default" },
    layout: { hud: "allocation" },
    columns: ["allocation", "used", "priority", "last prompt"],
    hud: { segments: ["project", "5h"] },
    policy: "finish",
    policyFor: {},
    preserveFor: { default: ["tests"] },
    customAdvice: {},
    wrappedStatusLine: null,
    contribute: false,
  };
  const tight = {
    label: "webinvoke",
    target: 0.5,
    usedPoints: 20,
    pressure: 0.4,
    ratePerHour: 10,
    now,
    preserve: ["tests"],
    custom: "",
  };
  const preview = { label: "webinvoke", target: 0.5, observed: 0.4, used: 20, pressure: 0.4, priority: "high", quota: {}, now };

  const rows = settingsRows(config);
  const stageRows = rows.filter((row) => row.kind === "stage");
  assert.equal(stageRows.length, POLICIES.finish.stages.length, "one row per stage of the chosen policy");

  const selectable = selectableRows(rows);
  const firstStage = selectable.find((index) => rows[index].kind === "stage");
  const painted = renderSettings(config, rows, firstStage, false, "", preview, loadTheme("default"), false, tight, 100);
  const text = painted.join("\n");

  assert.match(text, /Stay on completion of what was asked/, "the selected stage shows the words Claude will get");
  assert.match(text, /webinvoke is at 40% of its allocation/, "and where this project sits right now");
  assert.match(text, /80%\s+~\d\d:\d\d\s+narrow/, "each stage carries when it lands at the current burn");
  for (const line of text.split("\n")) {
    const stage = /^ {2}(.) (.) +(\d+)%/.exec(line);
    if (stage) assert.equal(line.indexOf("%"), text.split("\n").find((other) => /^ {2}. . +\d+%/.test(other))?.indexOf("%"), "every stage row lines up");
  }

  const idle = renderSettings(
    config,
    rows,
    firstStage,
    false,
    "",
    preview,
    loadTheme("default"),
    false,
    { ...tight, ratePerHour: 0 },
    100,
  );
  assert.match(idle.join("\n"), /not burning/, "with nothing burning it says so rather than inventing a time");

  const columns = renderSettings(config, rows, selectable[0], false, "", preview, loadTheme("default"), false, tight, 100);
  assert.match(columns.join("\n"), /allocation.*the share of the window/, "columns explain themselves");
  assert.match(columns.join("\n"), /5h.*the 5-hour window Anthropic publishes/, "so do status line segments");
});

test("every theme dresses the control centre as well as the status line", async () => {
  const { builtinThemes, loadTheme } = await import("../dist/runtime/kernel.mjs");
  const { smallBar } = await import("../dist/report/graphs.js");
  const seen = new Set();
  for (const name of builtinThemes()) {
    const theme = loadTheme(name);
    seen.add(`${theme.tui.cursor}${theme.tui.fill}${theme.tui.empty}${theme.tui.active}`);
    const bar = smallBar(0.5, 8, theme, false, "ok");
    assert.ok(bar.includes(theme.tui.fill), `${name} draws its bar with its own character`);
    assert.ok(bar.includes(theme.tui.empty), `${name} draws the empty half with its own character`);
    const over = smallBar(1.4, 8, theme, false, "ok");
    assert.ok(over.includes(theme.tui.over), `${name} marks an overrun with its own character`);
  }
  assert.ok(seen.size >= 6, `expected the themes to look different, found ${seen.size} distinct glyph sets`);
});

test("themes exist for both surfaces, and dracula is now violet", async () => {
  const { builtinThemes, loadTheme, renderHud } = await import("../dist/runtime/kernel.mjs");
  const names = builtinThemes();

  assert.ok(names.length >= 10, `expected at least ten themes, found ${names.length}`);
  assert.ok(!names.includes("dracula"), "the old name is gone");
  assert.ok(names.includes("violet"), "and replaced");
  assert.equal(loadTheme("dracula").name, "violet", "anyone who set dracula keeps their colours");

  const now = Date.now();
  const view = {
    label: "webinvoke",
    target: 0.5,
    observed: 0.4,
    used: 20,
    pressure: 0.4,
    priority: "high",
    quota: { five_hour: { usedPercent: 42, resetsAt: Math.floor(now / 1000) + 3600 } },
    now,
  };

  for (const name of names) {
    const theme = loadTheme(name);
    for (const role of ["fg", "dim", "accent", "ok", "warn", "danger", "track"]) {
      assert.match(theme.colors[role] ?? "", /^#[0-9a-f]{6}$/i, `${name} is missing a ${role} colour`);
    }
    for (const glyph of ["full", "empty", "sep"]) {
      assert.ok((theme.glyphs[glyph] ?? "").length > 0, `${name} is missing its ${glyph} glyph`);
    }
    for (const glyph of ["cursor", "pin", "active", "done", "blocked", "idle", "fill", "empty", "over", "meter", "track"]) {
      assert.ok((theme.tui[glyph] ?? "").length > 0, `${name} is missing its ${glyph} character for the control centre`);
    }
    const line = renderHud(["project", "5h"], view, theme, true);
    assert.ok(line.includes("webinvoke"), `${name} renders a status line`);
  }
});

test("every theme is readable, measured not asserted", async () => {
  const { builtinThemes, loadTheme } = await import("../dist/runtime/kernel.mjs");

  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = (hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const contrast = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  for (const name of builtinThemes()) {
    const theme = loadTheme(name);
    const background = name === "paper" ? "#ffffff" : "#1e1e1e";
    for (const role of ["fg", "accent", "ok", "warn", "danger"]) {
      const ratio = contrast(theme.colors[role], background);
      assert.ok(ratio >= 4.5, `${name}'s ${role} is ${ratio.toFixed(1)}:1 against the terminal, WCAG AA wants 4.5`);
    }
    const dim = contrast(theme.colors.dim, background);
    assert.ok(dim >= 2.5, `${name}'s dim text is ${dim.toFixed(1)}:1, too faint to read`);
    const track = contrast(theme.colors.track, background);
    assert.ok(track >= 1.15, `${name}'s empty bar is ${track.toFixed(2)}:1, invisible`);
    assert.ok(track <= 4, `${name}'s empty bar is ${track.toFixed(2)}:1, too loud for a background element`);
  }
});

test("the status line offers shapes before pieces", async () => {
  const { HUD_PRESETS, HUD_PRESET_ABOUT, presetMatching, presetSegments, DEFAULT_HUD_SEGMENTS, renderHud, loadTheme } =
    await import("../dist/runtime/kernel.mjs");

  const names = Object.keys(HUD_PRESETS);
  assert.ok(names.length >= 4 && names.length <= 6, `expected a handful of shapes, found ${names.length}`);
  for (const name of names) {
    assert.ok((HUD_PRESET_ABOUT[name] ?? "").length > 0, `${name} does not say what it is for`);
    assert.equal(presetMatching(HUD_PRESETS[name]), name, `${name} is recognised from its own segments`);
  }

  assert.deepEqual(
    DEFAULT_HUD_SEGMENTS,
    ["pair", "5h", "reset"],
    "the default is three things, and the project name is not one: you are already in it",
  );
  assert.equal(presetMatching(DEFAULT_HUD_SEGMENTS), "default", "and it is one of the named shapes");
  assert.equal(presetMatching(["project", "spark"]), null, "an arrangement of your own is not mislabelled");

  for (const old of ["allocation", "compact", "global", "blocks", "runway", "spark"]) {
    assert.ok(presetSegments(old), `${old} still resolves, so an old savemytokens hud <name> keeps working`);
  }

  const now = Date.now();
  const view = {
    label: "webinvoke",
    target: 0.5,
    observed: 0.44,
    used: 21,
    pressure: 0.42,
    priority: "high",
    quota: { five_hour: { usedPercent: 42, resetsAt: Math.floor(now / 1000) + 3600 } },
    now,
  };
  const line = renderHud("default", view, loadTheme("default"), false);
  assert.match(line, /21%\/50%/, "what this session has spent of what it was given");
  assert.match(line, /5h 42%/, "and where the window is");
  assert.match(line, /in 1h/, "and when it comes back");
  assert.doesNotMatch(line, /webinvoke/, "not the project name: the line is drawn inside that project");
  assert.doesNotMatch(line, /HIGH/, "priority is not in the default, it rarely changes");
  assert.match(renderHud("everything", view, loadTheme("default"), false), /webinvoke/, "but it is one keystroke away");
});

test("a theme you write yourself is checked, not just accepted", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "smt-theme-"));
  const env = { ...process.env, SAVEMYTOKENS_HOME: home, NO_COLOR: "1" };
  const cli = new URL("../dist/cli.js", import.meta.url).pathname;

  execFileSync("node", [cli, "theme", "new", "mine", "nord"], { env, encoding: "utf8" });
  const file = path.join(home, "themes", "mine.json");
  assert.ok(fs.existsSync(file), "it scaffolds a file to edit");

  const clean = execFileSync("node", [cli, "theme", "check", "mine"], { env, encoding: "utf8" });
  assert.match(clean, /Readable everywhere/);

  const theme = JSON.parse(fs.readFileSync(file, "utf8"));
  theme.colors.danger = "#6b2020";
  theme.colors.accent = "not-a-colour";
  fs.writeFileSync(file, JSON.stringify(theme));

  let output = "";
  try {
    output = execFileSync("node", [cli, "theme", "check", "mine"], { env, encoding: "utf8" });
  } catch (error) {
    output = String(error.stdout ?? "");
  }
  assert.match(output, /not a #rrggbb colour/, "it names a colour it cannot parse");
  assert.match(output, /wants at least 4.5:1/, "and one too dark to read");
  assert.match(output, /2 problems to fix/);
});

test("the help page fits, and every key it lists is a key that works", async () => {
  const { helpOverlay } = await import("../dist/report/views.js");
  const { buildPlan, visibleRows } = await import("../dist/scheduler/plan.js");
  const { loadTheme } = await import("../dist/runtime/kernel.mjs");
  const { keyActions } = await import("../dist/scheduler/keys.js");
  const control = buildPlan(Date.now(), false);

  for (const columns of [60, 80, 100, 140]) {
    const lines = helpOverlay(control, {
      theme: loadTheme("default"),
      color: false,
      columns,
      rows: 40,
      selected: 0,
      interactive: true,
      expanded: false,
      labels: visibleRows(control.schedule).reduce((map, view) => map.set(view.project, view.label), new Map()),
    });
    for (const line of lines) {
      assert.ok(line.length <= columns, `${columns} columns overflowed by ${line.length - columns}: ${JSON.stringify(line)}`);
    }
  }

  const listed = helpOverlay(control, {
    theme: loadTheme("default"),
    color: false,
    columns: 140,
    rows: 40,
    selected: 0,
    interactive: true,
    expanded: false,
    labels: new Map(),
  }).join("\n");
  for (const key of ["u", "e", "p", "f", "x", "d", "b", "a", "n", "m", "P", "r", "q"]) {
    assert.ok(listed.includes(key), `${key} is documented`);
    assert.ok(keyActions(key).length > 0, `${key} actually does something`);
  }
});

test("no em dash anywhere in the source or the docs", async () => {
  const EM_DASH = String.fromCharCode(0x2014);
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const skip = new Set(["node_modules", "dist", ".git", "assets"]);
  const wanted = /\.(ts|mjs|js|md|html|json)$/;
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (wanted.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes(EM_DASH)) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "use a comma, a colon or a full stop instead");
});
