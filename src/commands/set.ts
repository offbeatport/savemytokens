import type { Options } from "../cli-options.js";
import type { ClaimantState, Priority } from "../core/resource.js";
import { buildPlan, resolveClaimant, setParked, setPinned, setPriority, setShare, setState } from "../scheduler/plan.js";
import { bold, dim, green, yellow } from "../util/ansi.js";

const PRIORITIES: Priority[] = ["high", "normal", "low"];
const STATES: Record<string, ClaimantState> = {
  done: "done",
  blocked: "blocked",
  active: "active",
  "needs-more": "needs-more",
};

function fail(message: string): void {
  process.stdout.write(`\n${message}\n\n`);
  process.exitCode = 1;
}

function percentOf(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function runSet(options: Options): void {
  const [target, value] = options.args;
  const command = options.command;

  if (!target) {
    fail(`Which session? ${dim(`try: npx savemytokens ${command} <project|session id> ${command === "release" ? "" : "<value>"}`)}`);
    return;
  }

  const control = buildPlan(Date.now(), true, options.window, options.adapter);
  const found = resolveClaimant(control.schedule, target);
  if (!found) {
    const known = control.schedule.claimants.map((view) => view.claimant.label).filter(Boolean);
    fail(`No session matching ${bold(target)}. ${known.length > 0 ? dim(`Known: ${[...new Set(known)].join(", ")}`) : ""}`);
    return;
  }
  const { view, matches } = found;
  const note = matches > 1 ? dim(`  (${matches} matched, took the busiest)`) : "";

  if (command === "share") {
    if (!value) {
      fail(`What share? ${dim("try: npx savemytokens share webinvoke 50, or `auto` to unpin it")}`);
      return;
    }
    if (value === "auto" || value === "even") {
      setShare(view.claimant.id, null, control.provider.id);
      process.stdout.write(`\n${green("Unpinned")} ${bold(view.claimant.label)} — it takes an even split again${note}\n\n`);
      return;
    }
    const percent = Number(String(value).replace("%", ""));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      fail(`${bold(String(value))} is not a percentage between 0 and 100.`);
      return;
    }
    setShare(view.claimant.id, percent / 100, control.provider.id);
    const after = buildPlan(Date.now(), false, options.window, options.adapter);
    const updated = after.schedule.claimants.find((row) => row.claimant.id === view.claimant.id);
    const actual = updated ? percentOf(updated.allocation.target) : `${Math.round(percent)}%`;
    const clamped = updated && Math.abs(updated.allocation.target * 100 - percent) > 0.5;
    process.stdout.write(
      `\n${green("Set")} ${bold(view.claimant.label)} target to ${bold(actual)}${note}\n${
        clamped ? yellow(`  asked for ${Math.round(percent)}%, but the window is already committed elsewhere\n`) : ""
      }\n`,
    );
    return;
  }

  if (command === "pin" || command === "park") {
    const on = String(value ?? "on").toLowerCase() !== "off";
    if (command === "pin") setPinned(view.claimant.id, on, control.provider.id);
    else setParked(view.claimant.id, on, control.provider.id);
    process.stdout.write(
      `\n${green(on ? (command === "pin" ? "Pinned" : "Parked") : "Cleared")} ${bold(view.claimant.label)}${note}\n${dim(command === "pin" ? "  it stays visible even when it goes quiet" : "  it drops out of the working set until you resume it")}\n\n`,
    );
    return;
  }

  if (command === "priority") {
    const priority = String(value ?? "").toLowerCase() as Priority;
    if (!PRIORITIES.includes(priority)) {
      fail(`Priority is one of ${PRIORITIES.join(", ")}.`);
      return;
    }
    setPriority(view.claimant.id, priority, control.provider.id);
    process.stdout.write(`\n${green("Set")} ${bold(view.claimant.label)} to ${bold(priority.toUpperCase())}${note}\n\n`);
    return;
  }

  const state = STATES[String(value ?? "done").toLowerCase()];
  if (!state) {
    fail(`State is one of ${Object.keys(STATES).join(", ")}.`);
    return;
  }
  setState(view.claimant.id, state, control.provider.id);
  const released = state === "done" || state === "blocked";
  process.stdout.write(
    `\n${green("Marked")} ${bold(view.claimant.label)} ${bold(state)}${note}\n${
      released ? dim("  its unused share goes back to the pool\n") : ""
    }\n`,
  );
}
