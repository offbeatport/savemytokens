import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterId } from "../core/types.js";
import type { Adapter } from "./types.js";

function pendingAdapter(id: AdapterId, label: string, dataDir: string): Adapter {
  return {
    id,
    label,
    supported: false,
    dataDir,
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

export const codexAdapter = pendingAdapter("codex", "Codex", path.join(os.homedir(), ".codex", "sessions"));
export const geminiAdapter = pendingAdapter("gemini", "Gemini CLI", path.join(os.homedir(), ".gemini", "tmp"));
