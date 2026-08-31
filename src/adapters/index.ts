import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import { pendingAdapters, type PendingAdapter } from "./pending.js";
import type { Adapter } from "./types.js";

export const adapters: Adapter[] = [claudeCodeAdapter, codexAdapter, ...pendingAdapters];

export function activeAdapters(): Adapter[] {
  return adapters.filter((a) => a.supported && a.detect());
}

export function pendingDetected(): PendingAdapter[] {
  return pendingAdapters.filter((a) => a.detect());
}

export type { Adapter, SessionRef } from "./types.js";
