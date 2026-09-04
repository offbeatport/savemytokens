import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionEvidence } from "../../core/types.js";
import type { Adapter, DiscoverOptions, SessionRef } from "../types.js";
import { mergeSidechain } from "./merge.js";
import { parseClaudeSession } from "./parse.js";

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const DATA_DIR = path.join(CLAUDE_HOME, "projects");
const MAX_SUBAGENT_DEPTH = 4;

export function encodeProject(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-");
}

function collectNested(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_SUBAGENT_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectNested(full, depth + 1, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
}

function scanProject(projectDir: string, projectKey: string, options: DiscoverOptions, out: SessionRef[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return;
  }
  const directories = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const main = path.join(projectDir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(main);
    } catch {
      continue;
    }
    if (stat.size === 0) continue;

    const sessionId = entry.name.slice(0, -".jsonl".length);
    const extras: string[] = [];
    if (directories.has(sessionId)) collectNested(path.join(projectDir, sessionId), 1, extras);

    let size = stat.size;
    let mtimeMs = stat.mtimeMs;
    for (const extra of extras) {
      try {
        const extraStat = fs.statSync(extra);
        size += extraStat.size;
        if (extraStat.mtimeMs > mtimeMs) mtimeMs = extraStat.mtimeMs;
      } catch {
        continue;
      }
    }
    if (mtimeMs < options.since) continue;

    out.push({ adapter: "claude-code", file: main, size, mtimeMs, projectKey, extraFiles: extras });
  }
}

export const claudeCodeAdapter: Adapter = {
  id: "claude-code",
  label: "Claude Code",
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
    let projects: fs.Dirent[];
    try {
      projects = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    } catch {
      return refs;
    }
    const wanted = options.project ? encodeProject(options.project) : null;
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      if (wanted && project.name !== wanted) continue;
      scanProject(path.join(DATA_DIR, project.name), project.name, options, refs);
    }
    return refs;
  },

  async parse(ref: SessionRef): Promise<SessionEvidence | null> {
    let evidence: SessionEvidence | null = null;
    try {
      evidence = await parseClaudeSession(ref.file, fs.statSync(ref.file));
    } catch {
      return null;
    }
    if (!evidence) return null;

    for (const extra of ref.extraFiles ?? []) {
      try {
        const sub = await parseClaudeSession(extra, fs.statSync(extra));
        if (sub) mergeSidechain(evidence, sub);
      } catch {
        continue;
      }
    }

    evidence.sourceSize = ref.size;
    evidence.sourceMtimeMs = ref.mtimeMs;
    return evidence;
  },
};
