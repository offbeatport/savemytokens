import type { ClaimantState } from "../core/resource.js";

export type Action =
  | { kind: "none" }
  | { kind: "quit" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "share"; delta: number }
  | { kind: "unpin" }
  | { kind: "priority" }
  | { kind: "equalize" }
  | { kind: "state"; state: ClaimantState }
  | { kind: "refresh" }
  | { kind: "toggle"; index: number }
  | { kind: "save" }
  | { kind: "skip" }
  | { kind: "preferences" }
  | { kind: "toggleCurrent" }
  | { kind: "edit" }
  | { kind: "help" }
  | { kind: "expand" }
  | { kind: "back" }
  | { kind: "pin" }
  | { kind: "park" }
  | { kind: "resume" };

const ESC = "\u001b";
const FINAL = /[@-~]/;

export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    const char = chunk[index] ?? "";
    if (char !== ESC) {
      keys.push(char);
      index++;
      continue;
    }
    const next = chunk[index + 1];
    if (next !== "[" && next !== "O") {
      keys.push(ESC);
      index++;
      continue;
    }
    let end = index + 2;
    while (end < chunk.length && !FINAL.test(chunk[end] ?? "")) end++;
    keys.push(chunk.slice(index, end + 1));
    index = end + 1;
  }
  return keys;
}

export function actionFor(key: string, mode: "plan" | "prefs", step: number): Action {
  if (key === "\u0003") return { kind: "quit" };

  if (mode === "prefs") {
    if (key === "\r" || key === "\n") return { kind: "save" };
    if (key === ESC || key === "q") return { kind: "skip" };
    if (key === `${ESC}[A` || key === "k") return { kind: "up" };
    if (key === `${ESC}[B` || key === "j") return { kind: "down" };
    if (key === `${ESC}[C` || key === "l") return { kind: "share", delta: step };
    if (key === `${ESC}[D` || key === "h") return { kind: "share", delta: -step };
    if (key === " ") return { kind: "toggleCurrent" };
    if (key === "e") return { kind: "edit" };
    if (key === "s") return { kind: "save" };
    const index = Number(key) - 1;
    if (Number.isInteger(index) && index >= 0 && index <= 8) return { kind: "toggle", index };
    return { kind: "none" };
  }

  switch (key) {
    case "q":
      return { kind: "quit" };
    case ESC:
      return { kind: "back" };
    case `${ESC}[A`:
    case "k":
      return { kind: "up" };
    case `${ESC}[B`:
    case "j":
      return { kind: "down" };
    case `${ESC}[C`:
    case "l":
      return { kind: "share", delta: step };
    case `${ESC}[D`:
    case "h":
      return { kind: "share", delta: -step };
    case "p":
      return { kind: "priority" };
    case "e":
      return { kind: "equalize" };
    case "u":
      return { kind: "unpin" };
    case "d":
      return { kind: "state", state: "done" };
    case "b":
      return { kind: "state", state: "blocked" };
    case "a":
      return { kind: "state", state: "active" };
    case "n":
      return { kind: "state", state: "needs-more" };
    case "r":
      return { kind: "refresh" };
    case "P":
      return { kind: "preferences" };
    case "?":
      return { kind: "help" };
    case "f":
      return { kind: "pin" };
    case "x":
      return { kind: "park" };
    case "m":
      return { kind: "expand" };
    case "\r":
    case "\n":
      return { kind: "resume" };
    default:
      return { kind: "none" };
  }
}

export function keyActions(chunk: string, mode: "plan" | "prefs", step: number): Action[] {
  return splitKeys(chunk)
    .map((key) => actionFor(key, mode, step))
    .filter((action) => action.kind !== "none");
}
