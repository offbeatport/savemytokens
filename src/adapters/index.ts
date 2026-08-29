import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter, geminiAdapter } from "./pending.js";
import type { Adapter } from "./types.js";

export const adapters: Adapter[] = [claudeCodeAdapter, codexAdapter, geminiAdapter];

export function activeAdapters(): Adapter[] {
  return adapters.filter((a) => a.supported && a.detect());
}

export function pendingDetected(): Adapter[] {
  return adapters.filter((a) => !a.supported && a.detect());
}

export type { Adapter, SessionRef } from "./types.js";
