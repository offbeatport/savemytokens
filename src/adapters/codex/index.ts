import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionEvidence } from "../../core/types.js";
import type { Adapter, DiscoverOptions, SessionRef } from "../types.js";
import { parseCodexSession } from "./parse.js";

const DATA_DIR = path.join(os.homedir(), ".codex", "sessions");
const MAX_DEPTH = 5;

function walk(dir: string, depth: number, since: number, out: SessionRef[]): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth + 1, since, out);
      continue;
    }
    if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size === 0 || stat.mtimeMs < since) continue;
    out.push({ adapter: "codex", file: full, size: stat.size, mtimeMs: stat.mtimeMs, projectKey: "" });
  }
}

export const codexAdapter: Adapter = {
  id: "codex",
  label: "Codex",
  supported: true,
  dataDir: DATA_DIR,

  detect(): boolean {
    try {
      return fs.statSync(DATA_DIR).isDirectory();
    } catch {
      return false;
    }
  },

  discover(options: DiscoverOptions): SessionRef[] {
    const refs: SessionRef[] = [];
    walk(DATA_DIR, 0, options.since, refs);
    if (!options.project) return refs;
    return refs.filter((ref) => {
      try {
        const head = fs.readFileSync(ref.file, "utf8").slice(0, 4_000);
        return head.includes(`"cwd":"${options.project}"`);
      } catch {
        return false;
      }
    });
  },

  async parse(ref: SessionRef): Promise<SessionEvidence | null> {
    try {
      return await parseCodexSession(ref.file, fs.statSync(ref.file));
    } catch {
      return null;
    }
  },
};
