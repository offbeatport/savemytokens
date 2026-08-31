import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterId } from "../core/types.js";
import type { Adapter } from "./types.js";

export interface PendingAdapter extends Adapter {
  reason: string;
}

function pendingAdapter(id: AdapterId, label: string, dataDir: string, reason: string): PendingAdapter {
  return {
    id,
    label,
    supported: false,
    dataDir,
    reason,
    detect(): boolean {
      try {
        return fs.statSync(dataDir).isDirectory();
      } catch {
        return false;
      }
    },
    discover(): [] {
      return [];
    },
    async parse(): Promise<null> {
      return null;
    },
  };
}

export const geminiAdapter = pendingAdapter(
  "gemini",
  "Gemini CLI",
  path.join(os.homedir(), ".gemini"),
  "it logs prompts but no token counts, so there is nothing to measure",
);

export const grokAdapter = pendingAdapter(
  "grok",
  "Grok",
  path.join(os.homedir(), ".grok"),
  "its local store is a title/cwd search index with no token counts",
);

export const pendingAdapters: PendingAdapter[] = [geminiAdapter, grokAdapter];
