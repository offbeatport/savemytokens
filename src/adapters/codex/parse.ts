import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { LifetimeCost } from "../../core/cost.js";
import { usd } from "../../core/pricing.js";
import { addUsage, emptyUsage, estimateTokens, weigh } from "../../core/tokens.js";
import {
  EVIDENCE_SCHEMA,
  type ModelUse,
  type SessionEvidence,
  type TaskSummary,
  type Usage,
} from "../../core/types.js";
import {
  DEAD_CARRY_MIN_TURNS,
  DEAD_CARRY_TOKENS,
  HIGH_CONTEXT_TOKENS,
  LARGE_OUTPUT_CHARS,
  USEFUL_OUTPUT_CHARS,
  commandLabel,
  isSelfContained,
} from "../claude-code/parse.js";

const MAX_BUCKETS = 24;
const MECHANICAL_TOOLS = new Set(["exec_command", "shell", "read_file", "web_search"]);

interface Bucket {
  key: string;
  tool: string;
  count: number;
  chars: number;
  maxChars: number;
  edits: number;
  wastedChars: number;
  wastedCount: number;
  cost: LifetimeCost;
}

interface TaskState extends TaskSummary {
  modelSet: Set<string>;
  fileSet: Set<string>;
}

function bucket(map: Map<string, Bucket>, key: string, tool: string): Bucket {
  let b = map.get(key);
  if (!b) {
    b = { key, tool, count: 0, chars: 0, maxChars: 0, edits: 0, wastedChars: 0, wastedCount: 0, cost: new LifetimeCost() };
    map.set(key, b);
  }
  return b;
}

function topBuckets(map: Map<string, Bucket>, ends: number[]) {
  return [...map.values()]
    .map((b) => ({ ...b, weighted: b.cost.resolve(ends) }))
    .sort((a, b) => b.weighted - a.weighted || b.chars - a.chars)
    .slice(0, MAX_BUCKETS);
}

function displayPath(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd + path.sep)) return filePath.slice(cwd.length + 1);
  const home = process.env.HOME ?? "";
  if (home && filePath.startsWith(home + path.sep)) return "~/" + filePath.slice(home.length + 1);
  return filePath;
}

export function patchedFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    const match = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line.trim());
    if (match?.[1]) files.push(match[1].trim());
  }
  return files;
}

function commandOf(args: unknown): string {
  if (typeof args !== "string") return "";
  try {
    const parsed = JSON.parse(args);
    if (typeof parsed?.cmd === "string") return parsed.cmd;
    if (Array.isArray(parsed?.command)) return parsed.command.join(" ");
    if (typeof parsed?.command === "string") return parsed.command;
  } catch {
    return "";
  }
  return "";
}

export async function parseCodexSession(file: string, stat: fs.Stats): Promise<SessionEvidence | null> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });

  const usage = emptyUsage();
  const models = new Map<string, ModelUse>();
  const outputs = new Map<string, Bucket>();
  const writes = new Map<string, Bucket>();
  const failures = new Map<string, Bucket>();
  const pending = new Map<string, { name: string; command: string; turn: number }>();
  const tasks: TaskState[] = [];
  const contexts: number[] = [];

  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let agentVersion = "";
  let model = "gpt-5";
  let startedAt = 0;
  let endedAt = 0;
  let turn = 0;
  let humanPrompts = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let interruptions = 0;
  let peakContext = 0;
  let bloatTurns = 0;
  let bloatTokens = 0;
  let bloatWeighted = 0;
  let quotaPeakPercent = 0;
  let lastUsageSignature = "";
  let current: TaskState | null = null;
  let pendingMechanical = false;

  const openTask = (ts: number, prompt: string): TaskState => {
    const task: TaskState = {
      id: `${sessionId}-${tasks.length}`,
      sessionId,
      project: cwd,
      prompt: prompt.replace(/\s+/g, " ").trim().slice(0, 120),
      startedAt: ts,
      endedAt: ts,
      promptChars: prompt.length,
      turns: 0,
      toolCalls: 0,
      models: [],
      modelSet: new Set<string>(),
      fileSet: new Set<string>(),
      usage: emptyUsage(),
      weighted: 0,
      usd: 0,
      peakContext: 0,
      carriedContext: 0,
      carriedUsd: 0,
      carriedIsDead: false,
      touchedPriorFiles: false,
      selfContained: isSelfContained(prompt),
      outcome: "completed",
      toolErrors: 0,
    };
    tasks.push(task);
    return task;
  };

  for await (const line of rl) {
    if (!line || line.charCodeAt(0) !== 123) continue;
    let record: Record<string, any>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (ts > endedAt) endedAt = ts;
      if (current) current.endedAt = ts;
    }

    const payload = record.payload ?? {};

    if (record.type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.cli_version === "string") agentVersion = payload.cli_version;
      continue;
    }

    if (record.type === "turn_context") {
      if (typeof payload.cwd === "string" && !cwd) cwd = payload.cwd;
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }

    if (record.type !== "event_msg" && record.type !== "response_item") continue;

    switch (payload.type) {
      case "user_message": {
        const text = typeof payload.message === "string" ? payload.message : "";
        if (!text || text.startsWith("<")) break;
        const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 120);
        if (current && current.turns === 0 && current.prompt === trimmed) break;
        humanPrompts++;
        current = openTask(Number.isFinite(ts) ? ts : 0, text);
        break;
      }

      case "token_count": {
        const info = payload.info;
        const quota = payload.rate_limits?.primary?.used_percent;
        if (typeof quota === "number" && quota > quotaPeakPercent) quotaPeakPercent = quota;
        if (!info?.last_token_usage) break;
        const last = info.last_token_usage;
        const signature = JSON.stringify(last);
        if (signature === lastUsageSignature) break;
        lastUsageSignature = signature;

        const cached = last.cached_input_tokens ?? 0;
        const turnUsage: Usage = {
          input: Math.max(0, (last.input_tokens ?? 0) - cached),
          output: last.output_tokens ?? 0,
          cacheWrite: 0,
          cacheRead: cached,
        };
        const context = last.input_tokens ?? 0;
        if (context <= 0 && turnUsage.output <= 0) break;

        turn++;
        contexts.push(context);
        if (context > peakContext) peakContext = context;
        if (context > HIGH_CONTEXT_TOKENS) {
          bloatTurns++;
          const excess = context - HIGH_CONTEXT_TOKENS;
          bloatTokens += excess;
          bloatWeighted += excess * 0.1;
        }
        addUsage(usage, turnUsage);

        let entry = models.get(model);
        if (!entry) {
          entry = { model, turns: 0, usage: emptyUsage(), weighted: 0, trivialTurns: 0, trivialWeighted: 0 };
          models.set(model, entry);
        }
        const turnWeighted = weigh(turnUsage);
        entry.turns++;
        addUsage(entry.usage, turnUsage);
        entry.weighted += turnWeighted;
        if (pendingMechanical && turnUsage.output < 600) {
          entry.trivialTurns++;
          entry.trivialWeighted += turnWeighted;
        }
        pendingMechanical = false;

        if (current) {
          if (current.turns === 0) current.carriedContext = context;
          current.turns++;
          addUsage(current.usage, turnUsage);
          current.weighted += turnWeighted;
          current.usd += usd(model, turnUsage);
          current.modelSet.add(model);
          if (context > current.peakContext) current.peakContext = context;
        }
        break;
      }

      case "function_call": {
        toolCalls++;
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const command = commandOf(payload.arguments);
        if (MECHANICAL_TOOLS.has(name)) pendingMechanical = true;
        if (typeof payload.call_id === "string") pending.set(payload.call_id, { name, command, turn });
        if (current) current.toolCalls++;
        break;
      }

      case "custom_tool_call": {
        toolCalls++;
        const patch = typeof payload.input === "string" ? payload.input : "";
        const files = patchedFiles(patch);
        for (const raw of files) {
          const key = displayPath(raw, cwd);
          if (current) current.fileSet.add(raw);
          const b = bucket(writes, key, "apply_patch");
          b.count++;
          const chars = Math.round(patch.length / Math.max(1, files.length));
          b.chars += chars;
          if (b.count > 1) {
            b.wastedCount++;
            b.wastedChars += chars;
            b.cost.add(0, turn, estimateTokens(chars));
          }
        }
        if (current) current.toolCalls++;
        break;
      }

      case "function_call_output":
      case "custom_tool_call_output": {
        const meta = typeof payload.call_id === "string" ? pending.get(payload.call_id) : undefined;
        if (typeof payload.call_id === "string") pending.delete(payload.call_id);
        const output = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? "");
        const chars = output.length;
        const failed = /Process exited with code [1-9]/.test(output);
        const label = meta?.command ? commandLabel(meta.command) : (meta?.name ?? "tool");
        const at = meta?.turn ?? turn;

        if (failed) {
          toolErrors++;
          if (current) current.toolErrors++;
          const b = bucket(failures, label, meta?.name ?? "tool");
          b.count++;
          b.chars += chars;
          b.wastedChars += chars;
          b.wastedCount++;
          b.cost.add(0, at, estimateTokens(chars));
        }

        if (chars > LARGE_OUTPUT_CHARS) {
          const b = bucket(outputs, label, meta?.name === "apply_patch" ? "apply_patch" : "Bash");
          b.count++;
          b.chars += chars;
          if (chars > b.maxChars) b.maxChars = chars;
          const excess = chars - USEFUL_OUTPUT_CHARS;
          b.wastedChars += excess;
          b.wastedCount++;
          b.cost.add(0, at, estimateTokens(excess));
        }
        break;
      }

      case "turn_aborted": {
        interruptions++;
        if (current && current.outcome === "completed") current.outcome = "interrupted";
        break;
      }

      default:
        break;
    }
  }

  if (turn === 0) return null;
  const ends = [turn];

  const seenFiles = new Set<string>();
  const finishedTasks: TaskSummary[] = tasks.map((t) => {
    const { modelSet, fileSet, ...rest } = t;
    const taskModels = [...modelSet];
    const touchedPriorFiles = [...fileSet].some((f) => seenFiles.has(f));
    for (const f of fileSet) seenFiles.add(f);
    const carriedUsd = usd(taskModels[0] ?? model, {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: rest.carriedContext * rest.turns,
    });
    const carriedIsDead =
      rest.carriedContext >= DEAD_CARRY_TOKENS &&
      rest.turns >= DEAD_CARRY_MIN_TURNS &&
      rest.selfContained &&
      !touchedPriorFiles;
    return { ...rest, models: taskModels, touchedPriorFiles, carriedUsd, carriedIsDead, project: cwd };
  });

  const sorted = [...contexts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return {
    schema: EVIDENCE_SCHEMA,
    adapter: "codex",
    sessionId,
    project: cwd || "unknown",
    sourceFile: file,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    agentVersion,
    startedAt,
    endedAt,
    turns: turn,
    humanPrompts,
    usage,
    weighted: weigh(usage),
    peakContext,
    contextP50: sorted.length ? (sorted[mid] ?? 0) : 0,
    compactions: 0,
    coldStart: turn <= 3 && usage.cacheRead === 0,
    bloatTurns,
    bloatTokens,
    bloatWeighted,
    apiErrors: 0,
    rateLimitHits: quotaPeakPercent >= 100 ? 1 : 0,
    interruptions,
    toolCalls,
    toolErrors,
    sidechainTurns: 0,
    sidechainWeighted: 0,
    searchChars: 0,
    models: [...models.values()],
    tasks: finishedTasks,
    reads: [],
    outputs: topBuckets(outputs, ends).map((b) => ({
      label: b.key,
      tool: b.tool,
      calls: b.count,
      chars: b.chars,
      maxChars: b.maxChars,
      excessChars: b.wastedChars,
      excessWeighted: b.weighted,
    })),
    hooks: [],
    attachments: [],
    writes: topBuckets(writes, ends).map((b) => ({
      path: b.key,
      writes: b.count,
      edits: b.edits,
      rewrittenChars: b.wastedChars,
      rewrittenWeighted: b.weighted,
    })),
    failures: topBuckets(failures, ends).map((b) => ({
      label: b.key,
      tool: b.tool,
      failures: b.count,
      chars: b.chars,
      weighted: b.weighted,
    })),
  };
}
